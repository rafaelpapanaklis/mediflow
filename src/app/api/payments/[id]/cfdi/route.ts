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
import { liveReadinessBlock } from "@/lib/invoices/cfdi-readiness";
import { isCfdiClaim } from "@/lib/invoices/cfdi-vigente";
import { pudoHaberTimbrado } from "@/lib/invoices/cfdi-timbre-incierto";
import { isFacturapiLive, facturapiEnv } from "@/lib/facturapi-env";
import { isUsableWhereId } from "@/lib/validations";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";
import { derivePaymentForm, resolveTaxMode, round2, cfdiStampedCheck, type CfdiTaxMode } from "@/lib/invoice-totals";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { facturaAdmiteCfdiPorPago, conceptoDePago, excedeElTotalDelCaso } from "@/lib/invoices/cfdi-pago-concepto";
import { FUENTE_EXCEDENTE } from "@/lib/patient-credit-core";
import { USOS_CFDI } from "@/lib/cfdi-catalogs";
import {
  bloqueoPorRetencion, usoCfdiPorRegimen, errorFormaDePagoRequerida,
  LIMITE_TIMBRADO_POR_HORA, VENTANA_TIMBRADO_MS, llaveLimiteTimbrado, errorLimiteTimbrado,
} from "@/lib/invoices/cfdi-reglas";
import { formaDeAnticipoDelPaciente } from "@/lib/invoices/forma-anticipo.server";
// ws1-t4 (F-05) + ws1-t8 (F-22): el cliente de Facturapi sale del receptor, nacional o extranjero.
import { clienteFacturapiDelReceptor, errorDeReceptorExtranjero, esReceptorExtranjero, USO_EXTRANJERO } from "@/lib/cfdi/extranjero";
import { normalizarRfc } from "@/lib/invoices/cfdi-reglas";
import { llaveIdempotencia } from "@/lib/invoices/cfdi-identidad";
import { marcarAmbiente } from "@/lib/invoices/cfdi-ambiente.server";
import { resolverConcepto, hayIvaMixto, errorIvaMixtoPorPago, CFDI_IVA_MIXTO_POR_PAGO } from "@/lib/cfdi/fiscal-concepto";
import { catalogoFiscal } from "@/lib/cfdi/fiscal-concepto.server";
import { tasasDeRetencion, errorRetencionPorPago, CFDI_RETENCION_POR_PAGO } from "@/lib/cfdi/retenciones";
import { retencionesEncendidas } from "@/lib/cfdi/retenciones.server";
import { avisoMesDeCobro, explicarRechazoPac } from "@/lib/cfdi/avisos-timbrado";
import { tipoDePersona } from "@/lib/invoices/cfdi-reglas";

/** ws1-t4 — ¿este Payment es el excedente de un cobro de ortodoncia que pasó al saldo a favor? */
async function pasoAlSaldoAFavor(clinicId: string, paymentId: string): Promise<boolean> {
  try {
    const fila = await prisma.patientCredit.findFirst({
      where: { clinicId, paymentId, source: FUENTE_EXCEDENTE },
      select: { id: true },
    });
    return !!fila;
  } catch (e: any) {
    // Sin las columnas del libro (SQL aún no aplicado) no puede existir ese excedente.
    if (e?.code === "P2021" || e?.code === "P2022") return false;
    throw e;
  }
}
import {
  claimDePago, apartarCfdiDePago, confirmarCfdiDePago, soltarCfdiDePago,
  buscarCfdiDePago, sumaCfdiValidaDeFactura, columnaPagoListaParaCfdi,
} from "@/lib/invoices/cfdi-pago-db";

// POST /api/payments/[id]/cfdi — CFDI de UN pago de una factura a plazos
// (ws1-t1, sep-2026: mensualidades de ortodoncia y cualquier tratamiento a
// plazos). Decisión de Rafael: "como se factura la suscripción del plan" —
// un CFDI PUE por cada pago, por el monto pagado (api/admin/payments/[id]/
// cfdi/route.ts es el precedente). Mismo criterio de seguridad que
// api/cfdi/route.ts (apartado atómico antes de llamar a Facturapi, "no se
// sabe si timbró" nunca suelta el apartado, cuadre de totales) pero por PAGO
// en vez de por FACTURA — ver lib/invoices/cfdi-pago-db.ts.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const paymentId = params.id;
  if (!isUsableWhereId(paymentId)) {
    return NextResponse.json({ error: "Falta indicar qué pago se va a timbrar." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { receptor: receptorCrudo, usoCfdi, paymentForm, taxMode: taxModeIn } = body;
  // El RFC como lo lee el SAT (mayúsculas, sin espacios) y nombre/CP sin espacios de más (ws1-t4, F-05).
  const receptor = receptorCrudo && typeof receptorCrudo === "object"
    ? { ...receptorCrudo, rfc: normalizarRfc(receptorCrudo.rfc), nombre: typeof receptorCrudo.nombre === "string" ? receptorCrudo.nombre.trim() : receptorCrudo.nombre, cp: typeof receptorCrudo.cp === "string" ? receptorCrudo.cp.trim() : receptorCrudo.cp }
    : receptorCrudo;
  if (!receptor?.rfc || !receptor?.nombre || !receptor?.regimenFiscal || !receptor?.cp) {
    return NextResponse.json({
      error: "Datos del receptor incompletos. Se requiere RFC, nombre, régimen fiscal y código postal.",
    }, { status: 400 });
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: {
      facturApiOrgId: true, facturApiEnabled: true, name: true, rfcEmisor: true,
      plan: true, timezone: true, cfdiTaxMode: true, csdUploaded: true, locale: true,
      regimenFiscal: true,
    },
  });
  if (!clinic?.facturApiEnabled || !clinic.facturApiOrgId) {
    return NextResponse.json({
      error: "Configura tu RFC y certificados en Configuración → Facturación antes de timbrar",
    }, { status: 400 });
  }
  // ws1-t4, tanda 0: límite por CLÍNICA (el mismo cupo que la factura
  // completa), candado de retenciones y uso del CFDI según el régimen.
  if (!rateLimitKey(llaveLimiteTimbrado(ctx!.clinicId), LIMITE_TIMBRADO_POR_HORA, VENTANA_TIMBRADO_MS)) {
    return NextResponse.json(errorLimiteTimbrado(clinic.locale), { status: 429 });
  }
  const retencion = bloqueoPorRetencion({ regimenEmisor: clinic.regimenFiscal, rfcReceptor: receptor.rfc, locale: clinic.locale });
  if (retencion) {
    // F-01 (ws1-t4, vuelta 2): con «Facturar a empresas con retención»
    // encendido la factura COMPLETA sí lleva la retención; el CFDI de un pago
    // suelto con retención todavía no existe.
    const encendidas = tasasDeRetencion({ regimenEmisor: clinic.regimenFiscal, rfcReceptor: receptor.rfc })
      && await retencionesEncendidas(prisma, ctx!.clinicId);
    if (encendidas) return NextResponse.json({ error: errorRetencionPorPago(clinic.locale), code: CFDI_RETENCION_POR_PAGO }, { status: 409 });
    return NextResponse.json(retencion, { status: 409 });
  }
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
  const uso: string = extranjero
    ? USO_EXTRANJERO
    : typeof usoCfdi === "string" && usoCfdi
      ? usoCfdi
      : usoCfdiPorRegimen(receptor.regimenFiscal, receptor.rfc);
  if (isFacturapiLive()) {
    const blocked = await liveReadinessBlock(clinic.facturApiOrgId, clinic.csdUploaded);
    if (blocked) return blocked;
  }

  // Sin sql/cfdi-pagos-a-plazos.sql aplicado, este endpoint no puede
  // garantizar el candado contra doble timbrado (vive en el índice único
  // parcial de esa migración) — se corta ANTES de tocar Facturapi.
  if (!(await columnaPagoListaParaCfdi())) {
    return NextResponse.json({
      error: "Falta aplicar sql/cfdi-pagos-a-plazos.sql antes de poder facturar pagos individuales. Avisa a soporte.",
      code:  "CFDI_POR_PAGO_SIN_SQL",
    }, { status: 503 });
  }

  const payment = await prisma.payment.findFirst({
    where:   { id: paymentId, invoice: { clinicId: ctx!.clinicId } },
    include: {
      invoice: {
        include: {
          patient:  { select: { firstName: true, lastName: true, email: true } },
          payments: true,
        },
      },
    },
  });
  if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  const invoice = payment.invoice;

  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, {
      userId: ctx!.userId, role: ctx!.role, clinicId: ctx!.clinicId,
    });
    if (denied) return denied;
  }

  if (payment.method === "refund") {
    return NextResponse.json({ error: "Un reembolso no se factura: no es un cobro." }, { status: 400 });
  }
  // ws1-t4 (saldo a favor en Ortodoncia): lo cobrado de más que pasó al saldo a
  // favor del paciente no es un pago de ESTA factura. Se factura cuando se use
  // (como «Anticipo (saldo a favor)»); timbrarlo aquí lo duplicaría ante el SAT.
  if (await pasoAlSaldoAFavor(ctx!.clinicId, payment.id)) {
    return NextResponse.json({
      error: "Este cobro pasó al saldo a favor del paciente: se factura cuando el saldo se use, no aquí.",
      code: "PAGO_A_SALDO_A_FAVOR",
    }, { status: 400 });
  }
  if (invoice.status === "DRAFT") {
    return NextResponse.json({ error: "La factura está en borrador; confírmala antes de timbrar." }, { status: 400 });
  }
  if (invoice.status === "CANCELLED") {
    return NextResponse.json({ error: "No se puede timbrar el pago de una factura cancelada." }, { status: 400 });
  }
  // Timbrar la factura completa (o un timbrado a medias de la factura
  // completa) ya cubrió este dinero ante el SAT — facturar el pago además lo
  // duplicaría.
  if (invoice.cfdiUuid) {
    return NextResponse.json({
      error: isCfdiClaim(invoice.cfdiUuid)
        ? "Esta factura se está timbrando completa justo ahora; espera a que termine antes de facturar pagos sueltos."
        : "Esta factura ya tiene un CFDI de la factura completa. No se puede facturar además un pago suelto: se duplicaría ante el SAT.",
      code: "CFDI_FACTURA_COMPLETA_VIGENTE",
    }, { status: 409 });
  }

  const { porFactura } = await leerCondicionesDeFacturas(prisma, { clinicId: ctx!.clinicId, invoiceIds: [invoice.id] });
  const condiciones = porFactura.get(invoice.id) ?? null;
  if (!facturaAdmiteCfdiPorPago(condiciones)) {
    return NextResponse.json({
      error: "Esta factura no es a plazos (enganche + mensualidades): factúrala completa con el botón de siempre.",
      code:  "CFDI_POR_PAGO_NO_APLICA",
    }, { status: 400 });
  }

  const existente = await buscarCfdiDePago(prisma, { clinicId: ctx!.clinicId, paymentId });
  if (existente) {
    return NextResponse.json({
      error: existente.status === "valid"
        ? `Este pago ya tiene CFDI timbrado (UUID ${existente.uuid}).`
        : "Este pago se está facturando justo ahora (o un intento anterior no terminó de guardarse). No lo vuelvas a intentar todavía.",
      code: existente.status === "valid" ? "CFDI_PAGO_YA_TIMBRADO" : "CFDI_PAGO_EN_CURSO",
    }, { status: 409 });
  }

  // ── El concepto: a qué cuota corresponde este pago ─────────────────────────
  const items0 = Array.isArray(invoice.items) ? (invoice.items as any[]) : [];
  const descripcionBase = (typeof items0[0]?.description === "string" && items0[0].description.trim()) || "Tratamiento";
  // F-11 / F-08: el catálogo con la clave SAT y el IVA de cada procedimiento.
  const catalogoDeLaClinica = await catalogoFiscal(prisma, ctx!.clinicId);
  const pagosOrdenados = [...invoice.payments].sort((a, b) => {
    const t = new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
  const idx = pagosOrdenados.findIndex((p) => p.id === payment.id);
  const pagosAnteriores = idx >= 0 ? pagosOrdenados.slice(0, idx) : [];
  const concepto = conceptoDePago({
    condiciones,
    totalFactura: invoice.total,
    descripcionBase,
    pagosAnteriores: pagosAnteriores.map((p) => ({ amount: p.amount, method: p.method, paidAt: p.paidAt })),
    pago: { amount: payment.amount, method: payment.method, paidAt: payment.paidAt },
  });

  // ── Candado: la suma de los CFDI nunca pasa del total del caso ─────────────
  const yaTimbrado = await sumaCfdiValidaDeFactura(prisma, { clinicId: ctx!.clinicId, invoiceId: invoice.id });
  if (excedeElTotalDelCaso({ yaTimbrado, montoDelPago: payment.amount, totalFactura: invoice.total })) {
    return NextResponse.json({
      error: `Facturar este pago ($${payment.amount.toFixed(2)}) dejaría timbrado más de lo que vale el caso ($${invoice.total.toFixed(2)}); ya hay $${yaTimbrado.toFixed(2)} timbrado en otros CFDI de esta factura. Revisa los CFDI existentes antes de seguir.`,
      code: "CFDI_POR_PAGO_EXCEDE_TOTAL",
    }, { status: 409 });
  }
  if (!(round2(payment.amount) > 0)) {
    return NextResponse.json({ error: "El monto a timbrar debe ser mayor a $0." }, { status: 400 });
  }

  // ── Impuestos: mismo criterio que la factura completa (exento o IVA 16%) ───
  if (taxModeIn !== undefined && taxModeIn !== null && taxModeIn !== ""
      && taxModeIn !== "iva16" && taxModeIn !== "exento") {
    return NextResponse.json({
      error: `Modo de impuestos inválido: ${String(taxModeIn)}. Se espera "exento" o "iva16".`,
    }, { status: 400 });
  }
  const taxModeFactura: CfdiTaxMode = taxModeIn === "iva16" || taxModeIn === "exento"
    ? taxModeIn
    : resolveTaxMode(invoice, clinic.cfdiTaxMode);
  // ws1-t4, vuelta 2 (F-11 / F-08): clave e IVA de los conceptos de la factura.
  // El CFDI de un pago es UN concepto: lleva la clave del principal (el
  // primero) y el IVA que tienen todos. Si mezclan exento y 16%, todavía no se
  // sabe repartir el pago entre ellos: se dice y no se timbra.
  const fiscalesFactura = items0.length > 0
    ? items0.map((it: any) => resolverConcepto(it, catalogoDeLaClinica, taxModeFactura))
    : [resolverConcepto({ description: descripcionBase }, catalogoDeLaClinica, taxModeFactura)];
  if (hayIvaMixto(fiscalesFactura)) {
    return NextResponse.json({ error: errorIvaMixtoPorPago(clinic.locale), code: CFDI_IVA_MIXTO_POR_PAGO }, { status: 409 });
  }
  const taxMode: CfdiTaxMode = fiscalesFactura[0].ivaModo;
  // ws1-t4, vuelta 2 (F-07): un PAGO es dinero ya recibido, con el IVA DENTRO.
  // Antes se copiaba `invoice.taxIncluded`: con una factura de «IVA agregado» el
  // CFDI sumaba el 16% ENCIMA del pago (pago de $1,160 → CFDI de $1,345.60).
  const taxIncludedCfdi = taxMode !== "exento";

  // La forma de ESTE pago; un «anticipo» hereda la del dinero que formó el
  // saldo a favor. Si no se sabe (Mercado Pago…), hay que escogerla.
  const formaDeAnticipo = payment.method === "anticipo"
    ? await formaDeAnticipoDelPaciente(prisma, { clinicId: ctx!.clinicId, patientId: invoice.patientId })
    : null;
  const payForm: string | null = typeof paymentForm === "string" && paymentForm.trim()
    ? paymentForm.trim()
    : derivePaymentForm([payment], null, formaDeAnticipo);
  if (!payForm) return NextResponse.json(errorFormaDePagoRequerida(clinic.locale), { status: 400 });
  if (!FORMAS_PAGO_SAT.some((f) => f.clave === payForm)) {
    return NextResponse.json({ error: `Forma de pago SAT inválida: ${payForm}` }, { status: 400 });
  }

  const claim = claimDePago(paymentId);
  let apartadaId: string | null = null;
  let timbrado: InvoiceResult | null = null;

  try {
    // ── Candado contra el doble timbrado (por PAGO) ───────────────────────────
    // Se aparta la fila ANTES de pedir el timbre: el índice único parcial sobre
    // "paymentId" (sql/cfdi-pagos-a-plazos.sql) hace que solo UNA petición para
    // este pago consiga la fila, igual que el UPDATE … WHERE "cfdiUuid" IS NULL
    // de la factura completa. Detalle en lib/invoices/cfdi-pago-db.ts.
    const apartado = await apartarCfdiDePago(prisma, {
      clinicId: ctx!.clinicId, invoiceId: invoice.id, paymentId, claim, monto: payment.amount,
    });
    if (apartado.ok && apartado.id) {
      apartadaId = apartado.id;
    } else {
      const sinColumna = apartado.motivo === "sinColumna";
      return NextResponse.json({
        error: sinColumna
          ? "Falta aplicar sql/cfdi-pagos-a-plazos.sql antes de poder facturar pagos individuales."
          : "Este pago ya se está timbrando, o ya tiene CFDI. Cierra y vuelve a abrir la factura en unos segundos.",
        code: sinColumna ? "CFDI_POR_PAGO_SIN_SQL" : "CFDI_PAGO_EN_CURSO",
      }, { status: sinColumna ? 503 : 409 });
    }

    const orgApiKey = await getOrgApiKey(clinic.facturApiOrgId);

    // La lista negra EFOS es de RFC mexicanos: no aplica al genérico de extranjero.
    const rfcValidation = extranjero ? { ok: true } : await validateRfc(orgApiKey, receptor.rfc);
    if (!rfcValidation.ok) {
      await soltarCfdiDePago(prisma, { id: apartadaId, claim });
      apartadaId = null;
      return NextResponse.json({ error: `El RFC ${receptor.rfc} aparece en la lista negra del SAT (EFOS, art. 69-B); no es posible facturarle.` }, { status: 400 });
    }

    // F-05: el cliente se busca por su tax_id exacto (codificado) y se ACTUALIZA con
    // los datos de este timbrado; para un extranjero, con su país (ws1-t8).
    const customerId = await createOrUpdateCustomer(orgApiKey, clienteFacturapiDelReceptor(receptor, invoice.patient.email));

    const itemTaxes = taxMode === "exento"
      ? [{ type: "IVA", factor: "Exento", rate: 0 }]
      : [{ type: "IVA", rate: 0.16 }];
    const items = [{
      quantity: 1,
      product: {
        description:  concepto.descripcion,
        product_key:  fiscalesFactura[0].claveSat,
        unit_key:     UNIDAD_SAT,
        price:        round2(payment.amount),
        tax_included: taxIncludedCfdi,
        taxes:        itemTaxes,
      },
      discount: 0,
    }];

    const result = await createInvoice({
      orgApiKey,
      customerId,
      usoCfdi:     uso,
      paymentForm: payForm,
      items,
      exigirUuid: true,
      // F-12 / F-19 (ws1-t4, vuelta 2): la llave sale del apartado del pago y el
      // external_id es el pago (la serie y el folio se quedan en los de Facturapi:
      // todos los pagos de una factura repetirían el mismo folio).
      idempotencyKey: llaveIdempotencia(claim),
      externalId: paymentId,
    });
    timbrado = result;

    // F-07: lo que el SAT timbró DE VERDAD contra lo que se cobró. El CFDI ya
    // existe: esto nunca corta, deja constancia y avisa si no es redondeo
    // (mismo criterio que la factura completa). 1¢ de tolerancia: con el IVA
    // dentro, Facturapi saca la base dividiendo entre 1.16 y redondea.
    const stamped = cfdiStampedCheck(result.total, payment.amount, 0.01);
    const totalMismatch = stamped.level === "match" || stamped.level === "unknown"
      ? null
      : { paymentAmount: round2(payment.amount), stampedTotal: stamped.stampedTotal, diff: stamped.diff, level: stamped.level };
    if (totalMismatch) {
      (stamped.level === "material" ? console.error : console.warn)("CFDI por pago: el total timbrado difiere del pago:", { paymentId, uuid: result.uuid, ...totalMismatch });
    }

    // F-21: ¿este pago entró en otro mes que el del CFDI? Solo se avisa.
    const avisoMes = avisoMesDeCobro({ pagos: [payment], ahora: new Date(), timeZone: clinic.timezone, locale: clinic.locale });

    const guardado = await confirmarCfdiDePago(prisma, {
      id: apartadaId, claim, uuid: result.uuid, facturapiId: result.id,
      // F-18: el uso del CFDI viaja con el receptor.
      receptor: { ...receptor, usoCfdi: uso }, conceptos: items, total: result.total,
      xmlUrl: result.xml_url ?? null, pdfUrl: result.pdf_url ?? null,
    });
    if (!guardado) {
      // El timbre YA existe ante el SAT (`timbrado` no es null) y algo falló
      // guardándolo — se cae al mismo catch de abajo para no perder el rastro.
      throw new Error("No se pudo confirmar la fila del CFDI por pago tras el timbrado.");
    }

    // F-14 (ws1-t4, vuelta 2): en qué ambiente se timbró. Nunca lanza.
    await marcarAmbiente(prisma, { clinicId: ctx!.clinicId, uuid: result.uuid, ambiente: facturapiEnv() });

    // Metering del cupo CFDI: mismo contador que la factura completa.
    const period = cfdiPeriodFor(new Date(), clinic.timezone);
    const usage = await prisma.cfdiUsage.upsert({
      where:  { clinicId_period: { clinicId: ctx!.clinicId, period } },
      create: { clinicId: ctx!.clinicId, period, stamped: 1 },
      update: { stamped: { increment: 1 } },
    });
    const plan = await getResolvedPlan(clinic.plan);
    const q = cfdiOverage(usage.stamped, plan.cfdiMonthly, plan.cfdiOverageCents);

    await logMutation({
      texto: "Timbró el CFDI de un pago",
      req, clinicId: ctx!.clinicId, userId: ctx!.userId,
      // No hay "payment" en AuditEntityType (audit.ts): se audita contra la
      // FACTURA, igual que el timbrado completo, con el paymentId adentro.
      entityType: "invoice", entityId: invoice.id, action: "update",
      before: { cfdiUuid: null },
      after:  {
        paymentId, cfdiUuid: result.uuid,
        // F-18 (ws1-t4, vuelta 2): con qué se timbró, sin el RFC del paciente.
        facturapiId: result.id,
        receptor: { regimen: receptor.regimenFiscal, tipoPersona: tipoDePersona(receptor.rfc), extranjero },
        ...(avisoMes ? { mesDeCobro: avisoMes.mesesDeCobro, mesDelCfdi: avisoMes.mesDelCfdi } : {}),
        cfdi: { total: result.total, paymentForm: payForm, usoCfdi: uso, taxMode, claveSat: items[0].product.product_key, concepto: concepto.descripcion, ...(totalMismatch ? { totalMismatch } : {}) },
      },
    });

    return NextResponse.json({
      cfdiId:      guardado.id,
      uuid:        result.uuid,
      pdfUrl:      result.pdf_url,
      xmlUrl:      result.xml_url,
      descripcion: concepto.descripcion,
      ...(avisoMes ? { avisoMes: avisoMes.mensaje } : {}),
      quota: { used: q.used, included: q.included, overage: q.overage, overagePriceCents: q.overageCents },
      ...(totalMismatch?.level === "material" && totalMismatch.stampedTotal !== null ? {
        warning: {
          code: "CFDI_STAMPED_TOTAL_DIFFERS",
          paymentAmount: totalMismatch.paymentAmount,
          stampedTotal: totalMismatch.stampedTotal,
          message: `El CFDI de este pago se timbró por $${totalMismatch.stampedTotal.toFixed(2)} y el pago fue de $${totalMismatch.paymentAmount.toFixed(2)}. El comprobante YA está emitido: revísalo antes de entregarlo.`,
        },
      } : {}),
    });

  } catch (err: any) {
    console.error("CFDI por pago, error:", err);
    if (!timbrado) {
      if (apartadaId && pudoHaberTimbrado(err)) {
        // 🔴 EL APARTADO SE QUEDA, A PROPÓSITO — mismo criterio que la factura
        // completa (lib/invoices/cfdi-timbre-incierto.ts): ante la duda, no se
        // suelta, para no arriesgar un segundo CFDI del mismo pago.
        console.error("CFDI por pago: no se sabe si el timbre salió — el apartado se QUEDA:", {
          clinicId: ctx!.clinicId, paymentId, invoiceId: invoice.id, claim, motivo: err?.message,
        });
        return NextResponse.json({
          error: "La conexión con Facturapi se cortó y NO se sabe si el CFDI de este pago llegó a timbrarse. Queda apartado a propósito: no lo vuelvas a intentar. Escríbenos a soporte con el folio de la factura.",
          code:  "CFDI_TIMBRE_INCIERTO",
        }, { status: 503 });
      }
      if (apartadaId) {
        await soltarCfdiDePago(prisma, { id: apartadaId, claim });
      }
      return NextResponse.json({ error: explicarRechazoPac(err.message ?? "Error al timbrar CFDI del pago", clinic.locale) }, { status: 500 });
    }
    // El CFDI YA existe ante el SAT: no se puede perder el rastro aunque la
    // confirmación de la fila haya fallado. Se deja el log con lo necesario
    // para rehacerla a mano (mismo patrón que api/cfdi/route.ts).
    console.error("CFDI por pago timbrado ante el SAT pero no confirmado en la fila:", {
      clinicId: ctx!.clinicId, paymentId, invoiceId: invoice.id, uuid: timbrado.uuid, facturapiId: timbrado.id, total: timbrado.total, apartadaId,
    });
    return NextResponse.json({
      error: `El CFDI de este pago SÍ se timbró (UUID ${timbrado.uuid}), pero algo falló después. No lo vuelvas a timbrar: escríbenos a soporte con este UUID.`,
      code:  "CFDI_TIMBRADO_SIN_GUARDAR",
      uuid:  timbrado.uuid,
    }, { status: 500 });
  }
}

// GET /api/payments/[id]/cfdi — el CFDI (vigente o apartado) de un pago, si lo hay.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const paymentId = params.id;
  const payment = await prisma.payment.findFirst({
    where:  { id: paymentId, invoice: { clinicId: ctx.clinicId } },
    select: { invoice: { select: { patientId: true } } },
  });
  if (!payment) return NextResponse.json(null);
  if (payment.invoice.patientId) {
    const visDenied = await assertPatientVisible(payment.invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  const cfdi = await buscarCfdiDePago(prisma, { clinicId: ctx.clinicId, paymentId });
  return NextResponse.json(cfdi);
}
