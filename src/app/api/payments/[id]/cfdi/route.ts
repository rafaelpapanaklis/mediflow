import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import {
  createInvoice, createOrUpdateCustomer, getOrgApiKey,
  validateRfc, CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT,
  type InvoiceResult,
} from "@/lib/facturapi";
import { liveReadinessBlock } from "@/lib/invoices/cfdi-readiness";
import { isCfdiClaim } from "@/lib/invoices/cfdi-vigente";
import { pudoHaberTimbrado } from "@/lib/invoices/cfdi-timbre-incierto";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { isUsableWhereId } from "@/lib/validations";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";
import { derivePaymentForm, resolveTaxMode, round2, type CfdiTaxMode } from "@/lib/invoice-totals";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { facturaAdmiteCfdiPorPago, conceptoDePago, excedeElTotalDelCaso } from "@/lib/invoices/cfdi-pago-concepto";
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
  const rl = rateLimit(req, 5, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const paymentId = params.id;
  if (!isUsableWhereId(paymentId)) {
    return NextResponse.json({ error: "Falta indicar qué pago se va a timbrar." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { receptor, usoCfdi, paymentForm, taxMode: taxModeIn } = body;
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
    },
  });
  if (!clinic?.facturApiEnabled || !clinic.facturApiOrgId) {
    return NextResponse.json({
      error: "Configura tu RFC y certificados en Configuración → Facturación antes de timbrar",
    }, { status: 400 });
  }
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
  const taxMode: CfdiTaxMode = taxModeIn === "iva16" || taxModeIn === "exento"
    ? taxModeIn
    : resolveTaxMode(invoice, clinic.cfdiTaxMode);
  const taxIncludedCfdi = taxMode === "exento" ? false : invoice.taxIncluded !== false;

  const payForm: string = typeof paymentForm === "string" && paymentForm.trim()
    ? paymentForm.trim()
    : derivePaymentForm([payment], payment.method);
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

    const rfcValidation = await validateRfc(orgApiKey, receptor.rfc);
    if (!rfcValidation.ok) {
      await soltarCfdiDePago(prisma, { id: apartadaId, claim });
      apartadaId = null;
      return NextResponse.json({ error: `El RFC ${receptor.rfc} aparece en la lista negra del SAT (EFOS, art. 69-B); no es posible facturarle.` }, { status: 400 });
    }

    const customerId = await createOrUpdateCustomer(orgApiKey, {
      legal_name: receptor.nombre,
      tax_id:     receptor.rfc,
      tax_system: receptor.regimenFiscal,
      email:      receptor.email ?? invoice.patient.email ?? undefined,
      address:    { zip: receptor.cp },
    });

    const itemTaxes = taxMode === "exento"
      ? [{ type: "IVA", factor: "Exento", rate: 0 }]
      : [{ type: "IVA", rate: 0.16 }];
    const rawKey = typeof items0[0]?.claveSat === "string" ? items0[0].claveSat.trim() : "";
    const items = [{
      quantity: 1,
      product: {
        description:  concepto.descripcion,
        product_key:  /^\d{8}$/.test(rawKey) ? rawKey : CLAVES_SAT_MEDICOS.consulta.clave,
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
      usoCfdi:     usoCfdi ?? "D01",
      paymentForm: payForm,
      items,
      exigirUuid: true,
    });
    timbrado = result;

    const guardado = await confirmarCfdiDePago(prisma, {
      id: apartadaId, claim, uuid: result.uuid, facturapiId: result.id,
      receptor, conceptos: items, total: result.total,
      xmlUrl: result.xml_url ?? null, pdfUrl: result.pdf_url ?? null,
    });
    if (!guardado) {
      // El timbre YA existe ante el SAT (`timbrado` no es null) y algo falló
      // guardándolo — se cae al mismo catch de abajo para no perder el rastro.
      throw new Error("No se pudo confirmar la fila del CFDI por pago tras el timbrado.");
    }

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
      after:  { paymentId, cfdiUuid: result.uuid, cfdi: { total: result.total, paymentForm: payForm, taxMode, concepto: concepto.descripcion } },
    });

    return NextResponse.json({
      cfdiId:      guardado.id,
      uuid:        result.uuid,
      pdfUrl:      result.pdf_url,
      xmlUrl:      result.xml_url,
      descripcion: concepto.descripcion,
      quota: { used: q.used, included: q.included, overage: q.overage, overagePriceCents: q.overageCents },
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
      return NextResponse.json({ error: err.message ?? "Error al timbrar CFDI del pago" }, { status: 500 });
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
