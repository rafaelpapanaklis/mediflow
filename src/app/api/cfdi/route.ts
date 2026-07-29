import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import {
  createInvoice, createOrUpdateCustomer, getOrgApiKey, getOrganizationStatus,
  validateRfc, CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT,
} from "@/lib/facturapi";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";
import {
  expectedCfdiTotal, spreadInvoiceDiscount,
  derivePaymentForm, resolveTaxMode, itemQuantity, itemUnitPrice,
  itemDiscount, round2, type CfdiTaxMode,
} from "@/lib/invoice-totals";

/**
 * Gate de producción. Con FACTURAPI_ENV=live el CFDI se timbra ante el SAT y ya
 * no se puede "deshacer": si la organización de la clínica todavía no puede
 * emitir, JAMÁS se intenta timbrar — se devuelve 409 con el paso que falta.
 *
 * La fuente de verdad es la organización en Facturapi (`is_production_ready` /
 * `pending_steps`). El boolean local `csdUploaded` solo se usa como respaldo
 * cuando Facturapi no responde — así un CSD subido fuera de MediFlow no bloquea,
 * y un `csdUploaded` viejo tampoco.
 */
async function liveReadinessBlock(orgId: string, csdUploaded: boolean): Promise<NextResponse | null> {
  let status;
  try {
    status = await getOrganizationStatus(orgId);
  } catch {
    // Facturapi no respondió: se cae al único dato local que hay. Sin CSD no hay
    // timbrado posible en Live; con CSD se deja pasar (no se bloquea una
    // operación válida por una falla ajena y el timbrado es el juez final).
    if (!csdUploaded) {
      return NextResponse.json({
        error: "Falta subir tus certificados CSD (.cer y .key del SAT) en Configuración → Facturación antes de timbrar con validez fiscal.",
        code:  "CFDI_LIVE_NOT_READY",
      }, { status: 409 });
    }
    return null;
  }

  // A partir de aquí manda Facturapi, NO el boolean local: si la org está lista
  // para producción se timbra aunque `csdUploaded` esté desactualizado (p. ej. el
  // CSD se subió desde el panel de Facturapi).
  if (!status.exists) {
    return NextResponse.json({
      error: "Tu organización fiscal ya no existe en Facturapi. Vuelve a guardar tu configuración fiscal en Configuración → Facturación.",
      code:  "CFDI_LIVE_NOT_READY",
    }, { status: 409 });
  }
  if (status.isProductionReady) return null;

  const faltan: string[] = [];
  if (status.hasLegal       === false) faltan.push("Completa tus datos fiscales (razón social, régimen y código postal).");
  if (status.hasCertificate === false) faltan.push("Falta subir tus certificados CSD.");
  if (status.manifestSigned === false) faltan.push("Falta firmar la Carta Manifiesto con tu e.firma.");
  if (status.hasLogo        === false) faltan.push("Falta subir el logo de tu organización en Facturapi.");
  // pending_steps puede traer un paso que no mapeamos: se muestra su propia
  // descripción antes que un mensaje vacío.
  if (faltan.length === 0) {
    faltan.push(...status.pendingSteps.map((s) => s.description || s.type).filter(Boolean));
  }
  // Facturapi dice que no está lista pero no dijo por qué: se manda al panel en vez
  // de devolver un mensaje sin contenido.
  if (faltan.length === 0) {
    faltan.push("Facturapi reporta tu organización como no lista para producción pero no detalló el motivo. Revisa Configuración → Facturación → «Listo para facturar ante el SAT».");
  }

  return NextResponse.json({
    error: `Todavía no puedes timbrar con validez fiscal. ${faltan.join(" ")}`,
    code:  "CFDI_LIVE_NOT_READY",
    pendingSteps: status.pendingSteps,
  }, { status: 409 });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const body = await req.json();
  const { invoiceId, receptor, usoCfdi, paymentForm, taxMode: taxModeIn, confirmUnpaidPue } = body;

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
      plan: true, timezone: true, cfdiTaxMode: true, csdUploaded: true,
    },
  });

  if (!clinic?.facturApiEnabled || !clinic.facturApiOrgId) {
    return NextResponse.json({
      error: "Configura tu RFC y certificados en Configuración → Facturación antes de timbrar"
    }, { status: 400 });
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
  if (invoice.cfdiUuid) return NextResponse.json({ error: "Esta factura ya tiene CFDI timbrado" }, { status: 400 });
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

  // ── GUARDA DE INTEGRIDAD total ↔ conceptos ────────────────────────────────
  // El CFDI se emite por los CONCEPTOS; si la factura interna tiene un total
  // distinto (p. ej. "Editar precio" legado que no tocaba los items), timbrar
  // emitiría un monto que el paciente NO pagó. Jamás timbrar montos que no
  // cuadren.
  const discount = round2(Math.max(0, invoice.discount ?? 0));
  const cfdiTotal = expectedCfdiTotal(invoiceItems, discount, taxMode, taxIncludedInv);
  // Con IVA agregado, Facturapi calcula el impuesto por concepto: tolera un
  // centavo de redondeo por línea; en los modos brutos la igualdad es exacta.
  const tolerance = taxMode === "iva16" && !taxIncludedInv
    ? 0.01 + 0.01 * invoiceItems.length
    : 0.01;
  // round2 en la diferencia: sin él, una diferencia legítima de exactamente
  // 1¢ excede la tolerancia por ruido de punto flotante (31.00 − 30.99 =
  // 0.010000000000001563 > 0.01) y bloquearía un caso que debe pasar.
  if (round2(Math.abs(cfdiTotal - invoice.total)) > tolerance) {
    return NextResponse.json({
      error: `El total de la factura ($${invoice.total.toFixed(2)}) no coincide con la suma de sus conceptos ($${cfdiTotal.toFixed(2)}). Corrige el precio, el descuento o los conceptos antes de timbrar — el CFDI se emitiría por un monto distinto al cobrado.`,
      code: "CFDI_TOTAL_MISMATCH",
      invoiceTotal: invoice.total,
      cfdiTotal,
    }, { status: 409 });
  }
  if (cfdiTotal <= 0) {
    return NextResponse.json({ error: "El total a timbrar debe ser mayor a $0." }, { status: 400 });
  }

  // ── PUE con saldo pendiente ───────────────────────────────────────────────
  // El CFDI sale como PUE (pago en una sola exhibición); si la factura no está
  // totalmente pagada, se exige confirmación explícita y queda en el audit log.
  const fullyPaid = invoice.paid + 0.01 >= invoice.total;
  if (!fullyPaid && confirmUnpaidPue !== true) {
    return NextResponse.json({
      error: `La factura tiene saldo pendiente ($${invoice.balance.toFixed(2)}) y el CFDI se emitiría como PUE (pago en una sola exhibición). Confirma explícitamente para timbrar de todos modos.`,
      code: "CFDI_UNPAID_PUE",
    }, { status: 409 });
  }

  // ── Forma de pago SAT ─────────────────────────────────────────────────────
  // La manda el modal (selector editable); si no viene, se deriva del método
  // de los pagos registrados (último pago manda; sin pagos → "03").
  const payForm: string = typeof paymentForm === "string" && paymentForm.trim()
    ? paymentForm.trim()
    : derivePaymentForm(invoice.payments, invoice.paymentMethod);
  if (!FORMAS_PAGO_SAT.some((f) => f.clave === payForm)) {
    return NextResponse.json({ error: `Forma de pago SAT inválida: ${payForm}` }, { status: 400 });
  }

  try {
    const orgApiKey = await getOrgApiKey(clinic.facturApiOrgId);

    // Chequeo lista negra EFOS del SAT (fail-open: solo bloquea si el SAT lo
    // marca explícito; un RFC inexistente lo rechaza el propio timbrado).
    const rfcValidation = await validateRfc(orgApiKey, receptor.rfc);
    if (!rfcValidation.ok) {
      return NextResponse.json({ error: `El RFC ${receptor.rfc} aparece en la lista negra del SAT (EFOS, art. 69-B); no es posible facturarle.` }, { status: 400 });
    }

    const customerId = await createOrUpdateCustomer(orgApiKey, {
      legal_name: receptor.nombre,
      tax_id:     receptor.rfc,
      tax_system: receptor.regimenFiscal,
      email:      receptor.email ?? invoice.patient.email ?? undefined,
      address:    { zip: receptor.cp },
    });

    // Impuestos por concepto (shapes de la referencia oficial de Facturapi):
    //   exento → taxes [{IVA, factor Exento, rate 0}] + tax_included:false
    //   iva16  → taxes [{IVA, rate 0.16}]; tax_included según el modelo interno
    //            (incluido en el precio, o agregado sobre la base).
    const itemTaxes = taxMode === "exento"
      ? [{ type: "IVA", factor: "Exento", rate: 0 }]
      : [{ type: "IVA", rate: 0.16 }];
    const taxIncludedCfdi = taxMode === "exento" ? false : taxIncludedInv;

    // Descuento a nivel factura → prorrateado como descuento por concepto
    // (antes se ignoraba y el CFDI salía por el subtotal completo).
    const extraDiscounts = spreadInvoiceDiscount(invoiceItems, discount);

    const items = invoiceItems.map((item: any, i: number) => {
      // La clave del ítem solo se usa si es una clave SAT bien formada (8
      // dígitos); "" u otra basura caían al payload tal cual ("" ?? x === "")
      // y Facturapi rechazaba: "No se encontró la clave de producto o servicio".
      const rawKey = typeof item.claveSat === "string" ? item.claveSat.trim() : "";
      return {
        quantity: itemQuantity(item),
        product: {
          description: item.description ?? "Servicio médico",
          product_key: /^\d{8}$/.test(rawKey) ? rawKey : CLAVES_SAT_MEDICOS.consulta.clave,
          unit_key:    UNIDAD_SAT,
          price:       itemUnitPrice(item),
          tax_included: taxIncludedCfdi,
          taxes:        itemTaxes,
        },
        discount: round2(itemDiscount(item) + (extraDiscounts[i] ?? 0)),
      };
    });

    const result = await createInvoice({
      orgApiKey,
      customerId,
      usoCfdi:     usoCfdi ?? "D01",
      paymentForm: payForm,
      items,
    });

    // Metering del cupo CFDI: SOLO tras timbrado exitoso. El contador del mes
    // (period en la zona horaria de la clínica) sube +1 en la MISMA transacción
    // que el CfdiRecord — jamás bloquea el timbrado; el excedente se cobra a fin
    // de mes (cron /api/cron/cfdi-overage).
    const period = cfdiPeriodFor(new Date(), clinic.timezone);
    const [cfdiRecord, , usage] = await prisma.$transaction([
      prisma.cfdiRecord.create({
        data: {
          clinicId:       ctx!.clinicId,
          invoiceId,
          facturapiId:    result.id,
          uuid:           result.uuid,
          tipoComprobante:"I",
          receptor,
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

    // Rastro en el audit log (antes el timbrado no se registraba). Incluye si
    // se confirmó explícitamente timbrar PUE con saldo pendiente.
    await logMutation({
      req,
      clinicId:   ctx!.clinicId,
      userId:     ctx!.userId,
      entityType: "invoice",
      entityId:   invoiceId,
      action:     "update",
      before: { cfdiUuid: null },
      after:  {
        cfdiUuid: result.uuid,
        cfdi: { total: result.total, paymentForm: payForm, taxMode, unpaidPueConfirmed: !fullyPaid },
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
    });

  } catch (err: any) {
    console.error("CFDI error:", err);
    return NextResponse.json({ error: err.message ?? "Error al timbrar CFDI" }, { status: 500 });
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
      select: { patientId: true },
    });
    if (!invoice) return NextResponse.json([]);
    if (invoice.patientId) {
      const denied = await assertPatientVisible(invoice.patientId, {
        userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
      });
      if (denied) return denied;
    }
    const cfdis = await prisma.cfdiRecord.findMany({
      where:   { clinicId: ctx.clinicId, invoiceId },
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
