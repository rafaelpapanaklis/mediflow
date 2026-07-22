import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import {
  createInvoice, createOrUpdateCustomer, getOrgApiKey,
  validateRfc, CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT,
} from "@/lib/facturapi";
import {
  expectedCfdiTotal, spreadInvoiceDiscount,
  derivePaymentForm, defaultTaxMode, itemQuantity, itemUnitPrice,
  itemDiscount, round2, type CfdiTaxMode,
} from "@/lib/invoice-totals";

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
    select: { facturApiOrgId: true, facturApiEnabled: true, name: true, rfcEmisor: true },
  });

  if (!clinic?.facturApiEnabled || !clinic.facturApiOrgId) {
    return NextResponse.json({
      error: "Configura tu RFC y certificados en Configuración → Facturación antes de timbrar"
    }, { status: 400 });
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
  const taxMode: CfdiTaxMode = taxModeIn === "iva16" || taxModeIn === "exento"
    ? taxModeIn
    : defaultTaxMode(invoice);
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

    const [cfdiRecord] = await prisma.$transaction([
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
    ]);

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
    });

  } catch (err: any) {
    console.error("CFDI error:", err);
    return NextResponse.json({ error: err.message ?? "Error al timbrar CFDI" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
