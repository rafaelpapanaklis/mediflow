import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimitKey } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import {
  createInvoice, createOrUpdateCustomer, getOrgApiKey,
  validateRfc, UNIDAD_SAT, FORMAS_PAGO_SAT,
  type InvoiceResult,
} from "@/lib/facturapi";
import { cfdiClaimFor, isCfdiClaim, CFDI_EN_CURSO_ERROR } from "@/lib/invoices/cfdi-vigente";
import { cfdiCuadre, CFDI_TOTAL_MISMATCH } from "@/lib/invoices/cfdi-cuadre";
import { pudoHaberTimbrado, CFDI_TIMBRE_INCIERTO_ERROR } from "@/lib/invoices/cfdi-timbre-incierto";
import { liveReadinessBlock } from "@/lib/invoices/cfdi-readiness";
import { isFacturapiLive, facturapiEnv } from "@/lib/facturapi-env";
import { isUsableWhereId } from "@/lib/validations";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";
import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { fmtMXNdec } from "@/lib/format";
import {
  spreadInvoiceDiscount, cfdiStampedCheck,
  derivePaymentForm, resolveTaxMode, itemQuantity, itemUnitPrice,
  itemDiscount, round2, type CfdiTaxMode,
} from "@/lib/invoice-totals";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { esPlanAPlazos } from "@/lib/invoices/plan-de-pagos";
import { algunPagoTieneCfdiVigente } from "@/lib/invoices/cfdi-pago-db";
// ws1-t3: sustituir un CFDI (motivo 01) = timbrar el nuevo con relación 04.
import { prepararSustitucion, antesDeGuardarSustituto, registrarSustituto } from "@/lib/invoices/cfdi-cancelacion.server";
import { USOS_CFDI } from "@/lib/cfdi-catalogs";
import {
  bloqueoPorRetencion, bloqueoPorSaldo, usoCfdiPorRegimen, errorFormaDePagoRequerida,
  LIMITE_TIMBRADO_POR_HORA, VENTANA_TIMBRADO_MS, llaveLimiteTimbrado, errorLimiteTimbrado,
} from "@/lib/invoices/cfdi-reglas";
import { formaDeAnticipoDelPaciente } from "@/lib/invoices/forma-anticipo.server";
// ws1-t4 (F-05) + ws1-t8 (F-22): el cliente de Facturapi sale del receptor, nacional o extranjero.
import { clienteFacturapiDelReceptor, errorDeReceptorExtranjero, esReceptorExtranjero, USO_EXTRANJERO } from "@/lib/cfdi/extranjero";
import { normalizarRfc } from "@/lib/invoices/cfdi-reglas";
import { errorDeReceptor, esPublicoEnGeneral, receptorDePublicoEnGeneral, USO_PUBLICO_EN_GENERAL } from "@/lib/cfdi/receptor";
import { llaveIdempotencia, serieYFolio } from "@/lib/invoices/cfdi-identidad";
import { hayIvaMixto, errorIvaMixtoAgregado, CFDI_IVA_MIXTO_AGREGADO } from "@/lib/cfdi/fiscal-concepto";
import { conceptosFiscalesDeFactura } from "@/lib/cfdi/fiscal-concepto.server";
import { tasasDeRetencion, conceptoConRetenciones, totalesConRetenciones, avisoDeRetencion } from "@/lib/cfdi/retenciones";
import { retencionesEncendidas } from "@/lib/cfdi/retenciones.server";
import { avisoMesDeCobro, bloqueoPorGlobal, explicarRechazoPac } from "@/lib/cfdi/avisos-timbrado";
import { tipoDePersona } from "@/lib/invoices/cfdi-reglas";
import { textoSoloDuenoTimbra } from "@/lib/cfdi/mensajes";
import { ambienteDeCfdi, marcarAmbiente, retirarCfdiDePrueba } from "@/lib/invoices/cfdi-ambiente.server";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) {
    // C-57: sin «Solo administradores»; qué hacer, en palabras de la clínica.
    return ctx ? NextResponse.json({ error: textoSoloDuenoTimbra(), code: "CFDI_SOLO_DUENO" }, { status: 403 }) : err;
  }

  const body = await req.json();
  // ws1-t3: con `sustituyeCfdiId` este timbrado SUSTITUYE al CFDI vigente de la
  // factura (motivo 01): lleva relación 04 y después se cancela el viejo.
  const sustituyeCfdiId = body?.sustituyeCfdiId;
  // ws1-t4, vuelta 2 (F-12): «Reintentar» tras un «no se sabe si se timbró».
  // Reusa el MISMO apartado → la MISMA idempotency_key → Facturapi devuelve el
  // CFDI que ya emitió (si lo emitió) en vez de timbrar otro.
  const reintentarIncierto = body?.reintentarIncierto === true;
  // `confirmUnpaidPue` (el «timbrar PUE con saldo de todos modos») ya no existe
  // (ws1-t4, tanda 0): si un cliente viejo lo manda, se ignora.
  const { invoiceId, receptor: receptorCrudo, usoCfdi, paymentForm, taxMode: taxModeIn } = body;
  // El RFC como lo lee el SAT (mayúsculas, sin espacios) y nombre/CP sin espacios de más (ws1-t4, F-05).
  let receptor = receptorCrudo && typeof receptorCrudo === "object"
    ? { ...receptorCrudo, rfc: normalizarRfc(receptorCrudo.rfc), nombre: typeof receptorCrudo.nombre === "string" ? receptorCrudo.nombre.trim() : receptorCrudo.nombre, cp: typeof receptorCrudo.cp === "string" ? receptorCrudo.cp.trim() : receptorCrudo.cp }
    : receptorCrudo;

  // ── QUÉ factura se timbra ─────────────────────────────────────────────────
  // El `invoiceId` NO se validaba y con `undefined` Prisma DESCARTA la clave del
  // `where` de abajo (regla (c) de CLAUDE.md): el findFirst quedaba en
  // `{ clinicId }` y devolvía UNA FACTURA CUALQUIERA de la clínica. Si esa
  // factura pasaba las guardas se timbraba DE VERDAD ante el SAT y acto seguido
  // la $transaction reventaba en `invoice.update({ where: { id: undefined } })`:
  // CFDI emitido, sin CfdiRecord y sin `cfdiUuid` → la factura quedaba
  // re-timbrable (CFDI duplicado) y con FACTURAPI_ENV=live eso no se deshace.
  // Se corta ANTES de cualquier consulta y antes de hablar con Facturapi.
  if (!isUsableWhereId(invoiceId)) {
    return NextResponse.json({
      error: "Falta indicar qué factura se va a timbrar.",
    }, { status: 400 });
  }

  // Validate required receptor fields
  if (!receptor?.rfc || !receptor?.nombre || !receptor?.regimenFiscal || !receptor?.cp) {
    return NextResponse.json({
      error: "Datos del receptor incompletos. Se requiere RFC, nombre, régimen fiscal y código postal."
    }, { status: 400 });
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: {
      facturApiOrgId: true, facturApiEnabled: true, name: true, rfcEmisor: true,
      plan: true, timezone: true, cfdiTaxMode: true, csdUploaded: true, locale: true,
      regimenFiscal: true, cpEmisor: true,
    },
  });

  if (!clinic?.facturApiEnabled || !clinic.facturApiOrgId) {
    return NextResponse.json({
      error: "Configura tu RFC y certificados en Configuración → Facturación antes de timbrar"
    }, { status: 400 });
  }

  // ── Límite por CLÍNICA (ws1-t4, tanda 0) ───────────────────────────────────
  // Antes eran 5 por hora por IP: la sexta factura de la tarde de una recepción
  // recibía 429. El cupo mensual y el apartado de la factura ya frenan abusos.
  if (!rateLimitKey(llaveLimiteTimbrado(ctx!.clinicId), LIMITE_TIMBRADO_POR_HORA, VENTANA_TIMBRADO_MS)) {
    return NextResponse.json(errorLimiteTimbrado(clinic.locale), { status: 429 });
  }

  // ── Candado de retenciones (ws1-t4, tanda 0, F-01a) ────────────────────────
  // Emisor persona física 612/626 + receptor persona moral: la empresa retiene ISR
  // y el CFDI tendría que decirlo. Mientras no haya retenciones, no se timbra.
  // C-41 (auditoría de uso): el RESICO de personas MORALES (626 con RFC de 12) no
  // lleva retención: ni candado ni retención; sin RFC guardado, candado.
  // ws1-t4, vuelta 2 (F-01): con el ajuste «Facturar a empresas con
  // retención» ENCENDIDO, el CFDI lleva la retención en vez de bloquearse.
  // Apagado (por defecto, o sin su SQL), el candado de la Tanda 0 sigue igual.
  const tasasRet = tasasDeRetencion({ regimenEmisor: clinic.regimenFiscal, rfcEmisor: clinic.rfcEmisor, rfcReceptor: receptor.rfc });
  const conRetenciones = tasasRet ? await retencionesEncendidas(prisma, ctx!.clinicId) : false;
  const retencion = conRetenciones ? null : bloqueoPorRetencion({ regimenEmisor: clinic.regimenFiscal, rfcEmisor: clinic.rfcEmisor, rfcReceptor: receptor.rfc, locale: clinic.locale });
  if (retencion) return NextResponse.json(retencion, { status: 409 });

  // Uso del CFDI: el que manda el formulario (si existe en el catálogo) o el
  // que corresponde al régimen del receptor — antes era D01 para todos, que
  // no vale para un RESICO ni para una empresa.
  if (usoCfdi !== undefined && usoCfdi !== null && usoCfdi !== ""
      && !USOS_CFDI.some((u) => u.clave === usoCfdi)) {
    return NextResponse.json({ error: `Uso de CFDI inválido: ${String(usoCfdi)}.` }, { status: 400 });
  }
  // Extranjero (XEXX010101000 + país + NumRegIdTrib, ws1-t8): se valida aquí y
  // va SIEMPRE con S01 (Anexo 20), diga lo que diga el formulario.
  const extranjero = esReceptorExtranjero(receptor);
  if (extranjero) {
    const e = errorDeReceptorExtranjero(receptor, clinic.locale);
    if (e) return NextResponse.json({ error: e, code: "CFDI_RECEPTOR_EXTRANJERO" }, { status: 400 });
  }
  // C-47 (auditoría de uso): público en general lleva el nombre, el régimen y el CP que fija el SAT.
  if (!extranjero) receptor = receptorDePublicoEnGeneral(receptor, clinic.cpEmisor);
  const uso: string = extranjero
    ? USO_EXTRANJERO
    : esPublicoEnGeneral(receptor.rfc)
      ? USO_PUBLICO_EN_GENERAL
      : typeof usoCfdi === "string" && usoCfdi
        ? usoCfdi
        : usoCfdiPorRegimen(receptor.regimenFiscal, receptor.rfc);
  // C-47: el receptor contra c_RegimenFiscal y c_UsoCFDI ANTES de hablar con Facturapi.
  if (!extranjero) {
    const e = errorDeReceptor(receptor, uso, clinic.locale);
    if (e) return NextResponse.json({ error: e, code: "CFDI_RECEPTOR_INVALIDO" }, { status: 400 });
  }

  // En PRUEBAS todo sigue permitido como hasta hoy (Facturapi timbra con sus
  // propios certificados de prueba y nada llega al SAT).
  if (isFacturapiLive()) {
    const blocked = await liveReadinessBlock(clinic.facturApiOrgId, clinic.csdUploaded);
    if (blocked) return blocked;
  }

  const invoice = await prisma.invoice.findFirst({
    where:   { id: invoiceId, clinicId: ctx!.clinicId },
    include: {
      patient:  { select: { firstName: true, lastName: true, email: true } },
      payments: true, // para derivar la forma de pago SAT del pago real
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  // Apartado de un intento anterior que no se sabe cómo terminó. Solo se
  // retoma si lo piden a propósito y si es un timbrado normal: el de una
  // sustitución (hay un ingreso vigente en la factura) se revisa a mano, porque
  // al soltarlo habría que volver al CFDI viejo y el apartado no lo dice.
  let reintento: string | null = null;
  if (isCfdiClaim(invoice.cfdiUuid)) {
    if (!reintentarIncierto || sustituyeCfdiId || !String(invoice.cfdiUuid).startsWith(`timbrando:${invoiceId}:`)) {
      return NextResponse.json({ error: CFDI_EN_CURSO_ERROR, code: "CFDI_EN_CURSO" }, { status: 409 });
    }
    const ingresoVigente = await prisma.cfdiRecord.findFirst({
      where: { clinicId: ctx!.clinicId, invoiceId, tipoComprobante: "I", status: "valid" },
      select: { id: true },
    });
    if (ingresoVigente) {
      return NextResponse.json({
        error: "Este timbrado pendiente era la sustitución de un CFDI vigente: no se reintenta solo. Revisa en «CFDI ante el SAT» o escríbenos a soporte con el folio.",
        code: "CFDI_EN_CURSO",
      }, { status: 409 });
    }
    reintento = invoice.cfdiUuid as string;
  }
  // ── Sustitución (motivo 01, ws1-t3) ─────────────────────────────────────
  // Solo se puede timbrar sobre una factura que YA tiene CFDI si se pide
  // sustituirlo: el viejo tiene que ser el vigente de esta factura, sin una
  // cancelación en curso (lib/invoices/cfdi-cancelacion.ts). El apartado de
  // abajo se toma sobre ESE uuid en vez de sobre NULL.
  const sust = sustituyeCfdiId
    ? await prepararSustitucion({ clinicId: ctx!.clinicId, invoiceId, invoiceCfdiUuid: invoice.cfdiUuid, sustituyeCfdiId })
    : null;
  if (sust && !sust.ok) return NextResponse.json({ error: sust.error, code: sust.code }, { status: sust.status });
  const cfdiPrevio: string | null = sust && sust.ok ? sust.viejo.uuid : null;
  // ── F-14 (ws1-t4, vuelta 2): un CFDI de PRUEBAS no cuenta en Live ─────────
  // La factura quedó con un CFDI timbrado en TEST (sin validez ante el SAT).
  // En Live se puede timbrar de verdad: el apartado se toma sobre ese uuid y,
  // si falla, la factura vuelve a él.
  const cfdiDePrueba: string | null =
    isFacturapiLive() && !cfdiPrevio && !reintento && invoice.cfdiUuid && !isCfdiClaim(invoice.cfdiUuid)
      && (await ambienteDeCfdi(prisma, { clinicId: ctx!.clinicId, uuid: invoice.cfdiUuid })) === "test"
      ? invoice.cfdiUuid
      : null;
  if (invoice.cfdiUuid && invoice.cfdiUuid !== cfdiPrevio && invoice.cfdiUuid !== reintento && invoice.cfdiUuid !== cfdiDePrueba) return NextResponse.json({ error: "Esta factura ya tiene CFDI timbrado" }, { status: 400 });
  if (invoice.status === "DRAFT") {
    return NextResponse.json({ error: "La factura está en borrador; confírmala antes de timbrar." }, { status: 400 });
  }
  if (invoice.status === "CANCELLED") {
    return NextResponse.json({ error: "No se puede timbrar una factura cancelada." }, { status: 400 });
  }

  const invoiceItems = Array.isArray(invoice.items) ? (invoice.items as any[]) : [];
  if (invoiceItems.length === 0) {
    return NextResponse.json({ error: "La factura no tiene conceptos" }, { status: 400 });
  }

  // ── Impuestos del CFDI ─────────────────────────────────────────────────────
  // Exento (servicios médicos, art. 15 LIVA) o IVA 16%. Sin taxes explícitos,
  // Facturapi desglosaba IVA 16% por default aunque el servicio fuera exento.
  // El modal manda el modo elegido (override manual por factura); si no viene, se
  // deriva de la factura y de la preferencia de la clínica (Clinic.cfdiTaxMode).
  //
  // Un valor DESCONOCIDO se rechaza en vez de adivinarse: la columna de la clínica
  // usa "exempt" y el modo por factura "exento", así que un "exempt" que llegara
  // aquí por un refactor caería al default y podría timbrarse con IVA 16% — lo
  // contrario de lo pedido — sin que la guarda de totales lo note.
  if (taxModeIn !== undefined && taxModeIn !== null && taxModeIn !== ""
      && taxModeIn !== "iva16" && taxModeIn !== "exento") {
    return NextResponse.json({
      error: `Modo de impuestos inválido: ${String(taxModeIn)}. Se espera "exento" o "iva16".`,
    }, { status: 400 });
  }
  const taxMode: CfdiTaxMode = taxModeIn === "iva16" || taxModeIn === "exento"
    ? taxModeIn
    : resolveTaxMode(invoice, clinic.cfdiTaxMode);
  const taxIncludedInv = invoice.taxIncluded !== false;

  // ── Clave SAT e IVA de CADA concepto (ws1-t4, vuelta 2: F-11 y F-08) ───────
  // La clave sale del procedimiento del catálogo (o la de su categoría: dental
  // 85122001, ortodoncia 85122005, cirugía/implantes 85122004) y el IVA del
  // renglón, del procedimiento o, si no dice nada, de la factura (`taxMode`).
  // C-40 (auditoría de uso): el procedimiento se busca por su id (el del renglón o el del
  // presupuesto del que salió la factura) y solo de respaldo por nombre.
  const { conceptos: conceptosFiscales } = await conceptosFiscalesDeFactura(prisma, {
    clinicId: ctx!.clinicId, invoiceId, items: invoiceItems, ivaDeLaFactura: taxMode,
  });
  const ivaMixto = hayIvaMixto(conceptosFiscales);
  // Con «IVA agregado» la factura interna suma el 16% a TODO: mezclar
  // exentos y gravados descuadraría. Con IVA incluido el precio ya es el total.
  if (ivaMixto && !taxIncludedInv) {
    return NextResponse.json({ error: errorIvaMixtoAgregado(clinic.locale), code: CFDI_IVA_MIXTO_AGREGADO }, { status: 409 });
  }
  // El cuadre con el IVA que de verdad va: mezclado (solo con IVA incluido) =
  // la suma de los precios; si no, el único modo de los conceptos.
  const taxModeCuadre: CfdiTaxMode = ivaMixto ? "iva16" : (conceptosFiscales[0]?.ivaModo ?? taxMode);

  // ── GUARDA DE INTEGRIDAD total ↔ conceptos ────────────────────────────────
  // El CFDI se emite por los CONCEPTOS; si la factura interna tiene un total
  // distinto (p. ej. "Editar precio" legado que no tocaba los items), timbrar
  // emitiría un monto que el paciente NO pagó. Jamás timbrar montos que no
  // cuadren.
  //
  // Va ANTES del apartado de `cfdiUuid` y de cualquier llamada a Facturapi: una
  // factura que no cuadra no se aparta, no se timbra y no se «arregla sola»
  // (mover el total es tocar dinero). La cuenta vive en lib/invoices/cfdi-cuadre.ts.
  const discount = round2(Math.max(0, invoice.discount ?? 0));
  const cuadre = cfdiCuadre({
    items: invoiceItems, discount, total: invoice.total, taxMode: taxModeCuadre, taxIncluded: taxIncludedInv,
  });
  const { cfdiTotal, tolerance } = cuadre;
  if (!cuadre.ok) {
    const t = makeT(getDict(clinic.locale));
    return NextResponse.json({
      error: t("billing.billingClient.cfdiTotalMismatch", {
        number:       invoice.invoiceNumber ?? "",
        invoiceTotal: fmtMXNdec(invoice.total),
        cfdiTotal:    fmtMXNdec(cfdiTotal),
      }),
      code: CFDI_TOTAL_MISMATCH,
      invoiceTotal: invoice.total,
      cfdiTotal,
    }, { status: 409 });
  }
  if (cfdiTotal <= 0) {
    return NextResponse.json({ error: "El total a timbrar debe ser mayor a $0." }, { status: 400 });
  }

  // ── Facturas a plazos (ws1-t1, sep-2026) ──────────────────────────────────
  // Decisión de Rafael: una factura a plazos (enganche + mensualidades) ya NO
  // se timbra entera de un jalón — cada pago se factura por su lado con
  // POST /api/payments/[id]/cfdi, como su propio CFDI PUE por el monto
  // pagado. Dos candados, en este orden:
  //
  //   1. Si YA hay algún pago de esta factura con CFDI vigente, timbrar la
  //      factura completa la duplicaría (el mismo dinero, dos veces ante el
  //      SAT) — se bloquea siempre, sin importar si está saldada.
  //   2. Si todavía tiene saldo, no se timbra (abajo): a plazos, se factura
  //      pago por pago.
  //
  // Sin sql/cfdi-pagos-a-plazos.sql aplicado, ambas consultas contestan
  // "no hay" (columna ausente) y esta factura sigue su camino de siempre.
  const yaTieneCfdiPorPago = await algunPagoTieneCfdiVigente(prisma, { clinicId: ctx!.clinicId, invoiceId });
  if (yaTieneCfdiPorPago) {
    return NextResponse.json({
      error: "Esta factura ya tiene uno o más pagos con su propio CFDI timbrado (enganche/mensualidades). No se puede timbrar la factura completa además: se duplicaría el importe ante el SAT. Sigue facturando pago por pago.",
      code: "CFDI_POR_PAGO_VIGENTE",
    }, { status: 409 });
  }
  const { porFactura: condicionesPorFactura } = await leerCondicionesDeFacturas(prisma, { clinicId: ctx!.clinicId, invoiceIds: [invoiceId] });
  const condicionesDeEstaFactura = condicionesPorFactura.get(invoiceId) ?? null;
  const esAPlazos = esPlanAPlazos(condicionesDeEstaFactura);

  // ── PUE con saldo pendiente (ws1-t4, tanda 0, F-04) ─────────────────────
  // El CFDI de la factura completa sale PUE («pagado en una sola exhibición»).
  // Con saldo NO se timbra: ya no hay «confirmar y timbrar igual». Si es a
  // plazos, el aviso manda a «Facturar este pago» (cada pago ya cobrado, su
  // propio CFDI PUE por lo cobrado).
  // Descuento de factura prorrateado por concepto (también lo usan las retenciones).
  const extraDiscounts = spreadInvoiceDiscount(invoiceItems, discount);
  // F-01: con retenciones, la empresa paga el NETO (bruto − ISR − IVA retenido):
  // la factura está pagada cuando entró el neto.
  const totalesRet = conRetenciones && tasasRet
    ? totalesConRetenciones(invoiceItems.map((item: any, i: number) => ({
        precio: itemUnitPrice(item),
        cantidad: itemQuantity(item),
        descuento: round2(itemDiscount(item) + (extraDiscounts[i] ?? 0)),
        ivaModo: conceptosFiscales[i].ivaModo,
        ivaIncluido: taxIncludedInv,
      })), tasasRet)
    : null;
  const saldo = bloqueoPorSaldo({ total: totalesRet ? totalesRet.neto : invoice.total, paid: invoice.paid, esAPlazos, locale: clinic.locale });
  if (saldo) return NextResponse.json(saldo, { status: 409 });

  // ── C-49 (auditoría de uso): ¿esos cobros ya fueron en la factura global? ──
  // Con cobros de un mes anterior se pide confirmar que no entraron en la global
  // de ese mes (si entraron, timbrar la nota los duplica ante el SAT). Un
  // sustituto (01) no: su dinero ya estaba amparado por el CFDI que reemplaza.
  if (!sustituyeCfdiId) {
    const global = bloqueoPorGlobal({ pagos: invoice.payments, ahora: new Date(), timeZone: clinic.timezone, confirmado: body?.confirmaFueraDeGlobal, locale: clinic.locale });
    if (global) return NextResponse.json(global, { status: 409 });
  }

  // ── Forma de pago SAT ─────────────────────────────────────────────────────
  // La manda el modal (selector editable); si no viene, la del pago de MAYOR
  // importe (Anexo 20). Si el panel no la sabe (Mercado Pago, tarjeta sin
  // tipo…), no se inventa: hay que escogerla.
  const formaDeAnticipo = invoice.payments.some((p: any) => p.method === "anticipo")
    ? await formaDeAnticipoDelPaciente(prisma, { clinicId: ctx!.clinicId, patientId: invoice.patientId })
    : null;
  const payForm: string | null = typeof paymentForm === "string" && paymentForm.trim()
    ? paymentForm.trim()
    : derivePaymentForm(invoice.payments, invoice.paymentMethod, formaDeAnticipo);
  if (!payForm) return NextResponse.json(errorFormaDePagoRequerida(clinic.locale), { status: 400 });
  if (!FORMAS_PAGO_SAT.some((f) => f.clave === payForm)) {
    return NextResponse.json({ error: `Forma de pago SAT inválida: ${payForm}` }, { status: 400 });
  }

  const claim = reintento ?? cfdiClaimFor(invoiceId);
  let apartada = false;
  let timbrado: InvoiceResult | null = null;

  try {
    const orgApiKey = await getOrgApiKey(clinic.facturApiOrgId);

    // Chequeo lista negra EFOS del SAT (fail-open: solo bloquea si el SAT lo
    // marca explícito; un RFC inexistente lo rechaza el propio timbrado).
    // La lista negra EFOS es de RFC mexicanos: no aplica al genérico de extranjero.
    const rfcValidation = extranjero ? { ok: true } : await validateRfc(orgApiKey, receptor.rfc);
    if (!rfcValidation.ok) {
      return NextResponse.json({ error: `El RFC ${receptor.rfc} aparece en la lista negra del SAT (EFOS, art. 69-B); no es posible facturarle.` }, { status: 400 });
    }

    // F-05: el cliente se busca por su tax_id exacto (codificado) y se ACTUALIZA con
    // los datos de este timbrado; para un extranjero, con su país (ws1-t8).
    const customerId = await createOrUpdateCustomer(orgApiKey, clienteFacturapiDelReceptor(receptor, invoice.patient.email));

    // Impuestos por concepto (shapes de la referencia oficial de Facturapi):
    //   exento → taxes [{IVA, factor Exento, rate 0}] + tax_included:false
    //   iva16  → taxes [{IVA, rate 0.16}]; tax_included según el modelo interno
    //            (incluido en el precio, o agregado sobre la base).

    // Descuento a nivel factura → prorrateado como descuento por concepto
    // (antes se ignoraba y el CFDI salía por el subtotal completo).

    const items = invoiceItems.map((item: any, i: number) => {
      // Clave e IVA ya resueltos por concepto (F-11 / F-08). Una clave del
      // renglón solo cuenta si es de 8 dígitos (`resolverConcepto`).
      const fiscalDelConcepto = conceptosFiscales[i];
      const exento = fiscalDelConcepto.ivaModo === "exento";
      const descuento = round2(itemDiscount(item) + (extraDiscounts[i] ?? 0));
      if (conRetenciones && tasasRet) {
        // F-01: precio y descuento SIN IVA, con el traslado y las retenciones.
        const k = conceptoConRetenciones({
          precio: itemUnitPrice(item), cantidad: itemQuantity(item), descuento,
          ivaModo: fiscalDelConcepto.ivaModo, ivaIncluido: taxIncludedInv,
        }, tasasRet);
        return {
          quantity: itemQuantity(item),
          product: {
            description: item.description ?? "Servicio médico",
            product_key: fiscalDelConcepto.claveSat,
            unit_key:    UNIDAD_SAT,
            price:       k.price,
            tax_included: false,
            taxes:        k.taxes,
          },
          discount: k.discount,
        };
      }
      return {
        quantity: itemQuantity(item),
        product: {
          description: item.description ?? "Servicio médico",
          product_key: fiscalDelConcepto.claveSat,
          unit_key:    UNIDAD_SAT,
          price:       itemUnitPrice(item),
          // Exento → sin IVA; 16% → incluido en el precio o agregado, según la factura.
          tax_included: exento ? false : taxIncludedInv,
          taxes:        exento ? [{ type: "IVA", factor: "Exento", rate: 0 }] : [{ type: "IVA", rate: 0.16 }],
        },
        discount: descuento,
      };
    });

    // ── Candado contra el doble timbrado (N2) ───────────────────────────────
    // Justo antes de pedir el timbre se APARTA la factura en `cfdiUuid`. El
    // UPDATE solo alcanza la fila si sigue sin CFDI, sin cancelar y con el total
    // que se validó arriba; en Postgres ese UPDATE … WHERE es atómico, así que de
    // dos pestañas a la vez solo una lo consigue, y una cancelación o un cambio
    // de precio que entró desde la lectura no se timbra con el dato viejo. No
    // depende de ningún índice. Va aquí y no antes para que una función cortada
    // en las llamadas previas a Facturapi no deje la factura apartada sin timbre.
    // Detalle en lib/invoices/cfdi-vigente.ts.
    // En un reintento el apartado YA es este (se comprueba con el mismo UPDATE:
    // si alguien lo soltó o lo cambió entre medias, no se sigue).
    const { count } = await prisma.invoice.updateMany({
      where: {
        id: invoiceId, clinicId: ctx!.clinicId, cfdiUuid: reintento ?? cfdiPrevio ?? cfdiDePrueba,
        status: { notIn: ["DRAFT", "CANCELLED"] }, total: invoice.total,
      },
      data: { cfdiUuid: claim },
    });
    if (count === 0) {
      return NextResponse.json({
        error: "No se timbró: la factura cambió mientras tanto o ya se está timbrando en otra pestaña. Cierra y vuelve a abrir la factura para ver cómo quedó.",
        code:  "CFDI_EN_CURSO",
      }, { status: 409 });
    }
    apartada = true;

    const result = await createInvoice({
      orgApiKey,
      customerId,
      usoCfdi:     uso,
      paymentForm: payForm,
      items,
      // ws1-t3: el sustituto lleva relación 04 al CFDI que reemplaza.
      ...(cfdiPrevio ? { relatedDocuments: [{ relationship: "04", documents: [cfdiPrevio] }] } : {}),
      // Un 200 sin UUID se trata como «no se sabe» y no como un timbre bueno:
      // la factura está apartada y hay que conservar ese apartado. Lo comprueba
      // `createInvoice` y no este tramo: aquí, ya con el CFDI emitido, no puede
      // salir ninguna excepción ni ninguna respuesta de error, o perderíamos el
      // CfdiRecord de un comprobante que ya existe ante el SAT (lo vigila
      // src/lib/__tests__/cfdi-timbrado-alerta.test.ts).
      exigirUuid: true,
      // F-12: misma llave para el mismo apartado (el reintento la repite).
      idempotencyKey: llaveIdempotencia(claim),
      // F-19: para encontrarlo en Facturapi con el número que ve la clínica.
      externalId: invoiceId,
      ...serieYFolio(invoice.invoiceNumber),
    });
    timbrado = result;

    // ── El importe REAL del SAT ───────────────────────────────────────────────
    // `result.total` es lo que Facturapi timbró DE VERDAD. Se guardaba en
    // CfdiRecord.total y ahí moría: no se comparaba jamás contra nada, así que
    // una diferencia entre lo cobrado y lo timbrado era invisible aunque la
    // guarda de arriba hubiera pasado (compara nuestra PREDICCIÓN, no el hecho).
    //
    // El timbrado ya no se deshace, así que esto NO corta el flujo NUNCA: el CFDI
    // ya existe ante el SAT y tumbar la petición solo perdería el CfdiRecord.
    // Se reparte en dos niveles, a propósito:
    //
    //   CONSTANCIA (toda diferencia ≥1¢, sin tolerancia) → audit log + log del
    //     servidor. Es lo que el DUEÑO puede consultar después en
    //     /dashboard/auditoria (admin-only) para detectar que sus CFDIs no
    //     cuadran. Sin esto la divergencia de criterio —el caso COMÚN con IVA
    //     agregado: hasta 2¢ con 8 conceptos, dentro de la tolerancia— no dejaba
    //     rastro en ninguna parte.
    //   AVISO (solo si excede la tolerancia de redondeo) → `warning` en la
    //     respuesta, que el modal convierte en toast. Se reserva para lo que un
    //     humano tiene que MIRAR antes de entregar el comprobante: a quien está
    //     en el mostrador con un paciente enfrente, un centavo de redondeo no le
    //     sirve de nada y le enseñaría un error técnico que no puede resolver.
    // Con retenciones, lo esperado es el NETO (1¢ por concepto de redondeo).
    const stamped = totalesRet
      ? cfdiStampedCheck(result.total, totalesRet.neto, tolerance + 0.01 * invoiceItems.length)
      : cfdiStampedCheck(result.total, invoice.total, tolerance);
    const stampedTotal = stamped.stampedTotal;
    const stampedRecord = stamped.level === "match"
      ? null
      : { invoiceTotal: invoice.total, stampedTotal, diff: stamped.diff, level: stamped.level };
    const totalWarning = stamped.level === "material" && stampedTotal !== null
      ? {
          code:         "CFDI_STAMPED_TOTAL_DIFFERS",
          invoiceTotal: invoice.total,
          stampedTotal,
          message: `El CFDI se timbró por $${stampedTotal.toFixed(2)} y la factura dice $${invoice.total.toFixed(2)}. El comprobante fiscal YA está emitido: revísalo antes de entregarlo.`,
        }
      : null;
    if (stampedRecord) {
      // error solo para lo accionable; el resto queda como warn para poder
      // medirlo en los logs sin gritar en el 34% de los timbrados con IVA
      // agregado, donde la diferencia es la del criterio de cálculo.
      const log = stamped.level === "material" ? console.error : console.warn;
      log("CFDI stamped total differs:", { invoiceId, uuid: result.uuid, ...stampedRecord });
    }

    // Metering del cupo CFDI: SOLO tras timbrado exitoso. El contador del mes
    // (period en la zona horaria de la clínica) sube +1 en la MISMA transacción
    // que el CfdiRecord — jamás bloquea el timbrado; el excedente se cobra a fin
    // de mes (cron /api/cron/cfdi-overage).
    // ws1-t3: el CFDI viejo pasa a 'sustituido' ANTES de guardar el nuevo (el
    // índice «un ingreso vigente por factura» no dejaría dos 'valid'). Nunca lanza.
    if (sust && sust.ok) await antesDeGuardarSustituto({ clinicId: ctx!.clinicId, viejoCfdiId: sust.viejo.id, nuevoUuid: result.uuid });
    // F-21 (ws1-t4, vuelta 2): ¿el dinero entró en otro mes? Solo se avisa.
    const avisoMes = avisoMesDeCobro({ pagos: invoice.payments, ahora: new Date(), timeZone: clinic.timezone, locale: clinic.locale });
    const period = cfdiPeriodFor(new Date(), clinic.timezone);
    const [cfdiRecord, , usage] = await prisma.$transaction([
      prisma.cfdiRecord.create({
        data: {
          clinicId:       ctx!.clinicId,
          invoiceId,
          facturapiId:    result.id,
          uuid:           result.uuid,
          tipoComprobante:"I",
          // F-18: el uso del CFDI viaja con el receptor (antes no quedaba en ningún lado).
          receptor: { ...receptor, usoCfdi: uso },
          conceptos:      items,
          total:          result.total,
          status:         "valid",
          xmlUrl:         result.xml_url ?? null,
          pdfUrl:         result.pdf_url ?? null,
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data:  { cfdiUuid: result.uuid },
      }),
      prisma.cfdiUsage.upsert({
        where:  { clinicId_period: { clinicId: ctx!.clinicId, period } },
        create: { clinicId: ctx!.clinicId, period, stamped: 1 },
        update: { stamped: { increment: 1 } },
      }),
    ]);

    // Cupo del plan vigente para avisar a la UI (used/incluidas/excedente).
    const plan = await getResolvedPlan(clinic.plan);
    const q = cfdiOverage(usage.stamped, plan.cfdiMonthly, plan.cfdiOverageCents);
    // ws1-t3: la relación 04 queda escrita (la exige cancelar el viejo con motivo 01).
    if (sust && sust.ok) await registrarSustituto({ clinicId: ctx!.clinicId, nuevoCfdiId: cfdiRecord.id, viejoUuid: sust.viejo.uuid });
    // F-14: en qué ambiente se timbró (sin el SQL no escribe nada) y, si
    // reemplazó a uno de PRUEBAS, ese deja de contar como el CFDI de la factura.
    await marcarAmbiente(prisma, { clinicId: ctx!.clinicId, uuid: result.uuid, ambiente: facturapiEnv() });
    if (cfdiDePrueba) await retirarCfdiDePrueba(prisma, { clinicId: ctx!.clinicId, uuid: cfdiDePrueba });

    // Rastro en el audit log (antes el timbrado no se registraba), con la forma
    // de pago y el uso que se mandaron.
    await logMutation({
      texto: "Timbró el CFDI de una factura",
      req,
      clinicId:   ctx!.clinicId,
      userId:     ctx!.userId,
      entityType: "invoice",
      entityId:   invoiceId,
      action:     "update",
      before: { cfdiUuid: cfdiPrevio },
      after:  {
        cfdiUuid: result.uuid,
        // F-18 (ws1-t4, vuelta 2): con qué se timbró, sin el RFC del paciente.
        facturapiId: result.id,
        ...serieYFolio(invoice.invoiceNumber),
        receptor: { regimen: receptor.regimenFiscal, tipoPersona: tipoDePersona(receptor.rfc), extranjero },
        ...(avisoMes ? { mesDeCobro: avisoMes.mesesDeCobro, mesDelCfdi: avisoMes.mesDelCfdi } : {}),
        ...(cfdiPrevio ? { sustituyeA: cfdiPrevio } : {}),
        cfdi: {
          total: result.total, paymentForm: payForm, usoCfdi: uso,
          // F-08 / F-11: el IVA y la clave SAT que llevó cada concepto.
          taxMode: ivaMixto ? "mixto" : taxModeCuadre,
          conceptos: conceptosFiscales.map((c: { claveSat: string; ivaModo: string }) => ({ claveSat: c.claveSat, iva: c.ivaModo })),
          ...(totalesRet ? { retenciones: { isr: totalesRet.isrRetenido, iva: totalesRet.ivaRetenido, neto: totalesRet.neto, bruto: totalesRet.bruto } } : {}),
          ...(stampedRecord ? { totalMismatch: stampedRecord } : {}),
        },
      },
    });

    return NextResponse.json({
      cfdiId: cfdiRecord.id, // para descargar PDF/XML vía /api/cfdi/[cfdiId]/pdf|xml
      uuid:   result.uuid,
      pdfUrl: result.pdf_url,
      xmlUrl: result.xml_url,
      quota: {
        used:              q.used,
        included:          q.included,
        overage:           q.overage,
        overagePriceCents: q.overageCents,
      },
      ...(totalWarning ? { warning: totalWarning } : {}),
      // F-21: el dinero entró en otro mes que el del CFDI.
      ...(avisoMes ? { avisoMes: avisoMes.mensaje } : {}),
      // F-01: cuánto retiene la empresa (para avisarlo al timbrar).
      ...(totalesRet ? { retencion: { ...totalesRet, mensaje: avisoDeRetencion(totalesRet, clinic.locale) } } : {}),
    });

  } catch (err: any) {
    console.error("CFDI error:", err);
    if (!timbrado) {
      // ── «Rechazó» y «no contestó» NO son lo mismo (H-8) ───────────────────
      // No tener `timbrado` solo significa que no llegó el resultado a esta
      // variable, NO que el SAT no timbrara. Si la respuesta se perdió después
      // de que Facturapi emitiera —corte de red, 504, timeout—, soltar el
      // apartado dejaba la factura re-timbrable y el reintento emitía un
      // SEGUNDO CFDI: dos timbres cobrados y dos comprobantes vigentes que en
      // dental ni siquiera se pueden cancelar desde el panel.
      //
      // Quien lo sabe es `createInvoice`, que vio la respuesta (o su ausencia)
      // y marcó el error; `pudoHaberTimbrado` lee esa marca y, si no la hay,
      // decide por el tipo de error y cae del lado seguro.
      //
      // `apartada` es la condición de entrada, y no es un detalle: el apartado
      // se escribe en la línea JUSTO ANTES de pedir el timbre, así que sin él
      // ni siquiera se llegó a pedir. Las llamadas anteriores a Facturapi
      // (getOrgApiKey, validateRfc, createOrUpdateCustomer) también pueden
      // fallar por red, y ahí NO hay nada que timbrar: tratarlas como dudosas
      // asustaría a la clínica con un «no se sabe si se timbró» por un CFDI que
      // nunca se pidió.
      if (apartada && pudoHaberTimbrado(err)) {
        // 🔴 EL APARTADO SE QUEDA, A PROPÓSITO. Mientras esté puesto,
        // `isCfdiClaim` corta cualquier reintento con 409 antes de hablar con
        // Facturapi. Desatascarla es mirar el panel de Facturapi; volver a
        // timbrar a ciegas no tiene vuelta atrás.
        console.error("CFDI: no se sabe si el timbre salió — el apartado se QUEDA:", {
          clinicId: ctx!.clinicId, invoiceId, claim, motivo: err?.message,
        });
        return NextResponse.json({
          error: CFDI_TIMBRE_INCIERTO_ERROR,
          code:  "CFDI_TIMBRE_INCIERTO",
        }, { status: 503 });
      }

      // Facturapi contestó y NO timbró: aquí no hay CFDI que proteger, así que
      // se suelta el apartado —solo si sigue siendo el de esta petición— para
      // que la factura se pueda corregir y reintentar. (En un reintento, un
      // rechazo claro con la misma llave = el intento original tampoco timbró.)
      if (apartada) {
        await prisma.invoice.updateMany({
          where: { id: invoiceId, clinicId: ctx!.clinicId, cfdiUuid: claim },
          // Con sustitución vuelve al CFDI que sigue vigente, no a NULL (ws1-t3).
          data:  { cfdiUuid: cfdiPrevio ?? cfdiDePrueba },
        }).catch((e) => console.error("CFDI: no se pudo soltar el apartado", { invoiceId, e }));
      }
      // F-24: el rechazo del PAC con lo que hay que revisar (sin esconder el original).
      return NextResponse.json({ error: explicarRechazoPac(err.message ?? "Error al timbrar CFDI", clinic.locale) }, { status: 500 });
    }
    // El CFDI YA existe ante el SAT y algo falló después (la transacción, el
    // plan…). El UUID no se puede perder: se deja en la factura en lugar del
    // apartado; si ni eso entra, el apartado se queda y bloquea el reintento.
    // El log lleva con qué rehacer el CfdiRecord a mano: el resto (receptor,
    // XML, PDF) se recupera de Facturapi con `facturapiId`, sin datos fiscales
    // del paciente en los logs.
    const hecho = timbrado;
    console.error("CFDI timbrado ante el SAT pero no guardado completo:", {
      clinicId: ctx!.clinicId, invoiceId, uuid: hecho.uuid, facturapiId: hecho.id, total: hecho.total,
    });
    await prisma.invoice.updateMany({
      where: { id: invoiceId, clinicId: ctx!.clinicId, cfdiUuid: claim },
      data:  { cfdiUuid: hecho.uuid },
    }).catch((e) => console.error("CFDI: tampoco se pudo guardar el UUID en la factura", { invoiceId, uuid: hecho.uuid, e }));
    return NextResponse.json({
      error: `El CFDI SÍ se timbró (UUID ${hecho.uuid}), pero algo falló después. No lo vuelvas a timbrar: si la factura no muestra su CFDI, escríbenos a soporte con este UUID.`,
      code:  "CFDI_TIMBRADO_SIN_GUARDAR",
      uuid:  hecho.uuid,
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Consultar CFDIs = leer facturación: exige "billing.view" (permiso granular
  // que el dueño enciende/apaga por persona en /dashboard/team). Aplica a las
  // dos ramas de abajo; timbrar (POST) sigue siendo admin-only.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");

  // ?invoiceId= devuelve el CFDI de UNA factura (lo usa el modal para resolver el
  // cfdiId de una factura timbrada). Permitido a cualquiera que PUEDA VER al
  // paciente de esa factura — misma regla que abrir la factura — para no romper el
  // flujo de recepción con pacientes NO restringidos (regresión con '{}').
  if (invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where:  { id: invoiceId, clinicId: ctx.clinicId },
      select: { patientId: true, cfdiUuid: true },
    });
    if (!invoice) return NextResponse.json([]);
    if (invoice.patientId) {
      const denied = await assertPatientVisible(invoice.patientId, {
        userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
      });
      if (denied) return denied;
    }
    // ws1-t3: el CFDI al que apunta la factura (con sustitución o notas de
    // crédito «el último» ya no es el de la factura); sin uuid, el último ingreso.
    const cfdis = await prisma.cfdiRecord.findMany({
      where:   invoice.cfdiUuid
        ? { clinicId: ctx.clinicId, invoiceId, uuid: invoice.cfdiUuid }
        : { clinicId: ctx.clinicId, invoiceId, tipoComprobante: "I" },
      orderBy: { createdAt: "desc" },
      take:    1,
    });
    return NextResponse.json(cfdis);
  }

  // Listado completo (sin invoiceId): cada CfdiRecord lleva receptor (RFC + razón
  // social = identidad fiscal) y el modelo NO tiene relación con Patient para
  // filtrar registro a registro → el padrón fiscal completo es admin-only.
  const err = requireAdmin(ctx);
  if (err) return err;
  const cfdis = await prisma.cfdiRecord.findMany({
    where:   { clinicId: ctx.clinicId },
    orderBy: { createdAt: "desc" },
    take:    50,
  });
  return NextResponse.json(cfdis);
}
