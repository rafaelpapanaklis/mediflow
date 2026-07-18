import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import {
  createInvoice, createOrUpdateCustomer, getOrgApiKey,
  validateRfc, CLAVES_SAT_MEDICOS, UNIDAD_SAT,
} from "@/lib/facturapi";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5, 60 * 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const body = await req.json();
  const { invoiceId, receptor, usoCfdi, paymentForm } = body;

  // Validate required receptor fields
  if (!receptor?.rfc || !receptor?.nombre || !receptor?.regimenFiscal || !receptor?.cp) {
    return NextResponse.json({
      error: "Datos del receptor incompletos. Se requiere RFC, nombre, régimen fiscal y código postal."
    }, { status: 400 });
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: { facturApiOrgId: true, facturApiEnabled: true, name: true, rfcEmisor: true, plan: true, timezone: true },
  });

  if (!clinic?.facturApiEnabled || !clinic.facturApiOrgId) {
    return NextResponse.json({
      error: "Configura tu RFC y certificados en Configuración → Facturación antes de timbrar"
    }, { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({
    where:   { id: invoiceId, clinicId: ctx!.clinicId },
    include: { patient: { select: { firstName: true, lastName: true, email: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.cfdiUuid) return NextResponse.json({ error: "Esta factura ya tiene CFDI timbrado" }, { status: 400 });

  // Validate RFC with SAT
  const rfcValidation = await validateRfc(receptor.rfc);
  if (!rfcValidation.valid) {
    return NextResponse.json({ error: `RFC inválido ante el SAT: ${receptor.rfc}` }, { status: 400 });
  }

  try {
    const orgApiKey = await getOrgApiKey(clinic.facturApiOrgId);

    const customerId = await createOrUpdateCustomer(orgApiKey, {
      legal_name: receptor.nombre,
      rfc:        receptor.rfc,
      tax_system: receptor.regimenFiscal,
      email:      receptor.email ?? invoice.patient.email ?? undefined,
      address:    { zip: receptor.cp },
    });

    // FIX: safe cast with fallback for invoice items
    const invoiceItems = Array.isArray(invoice.items) ? invoice.items as any[] : [];
    const items = invoiceItems.map((item: any) => ({
      quantity: item.quantity ?? 1,
      product: {
        description: item.description ?? "Servicio médico",
        product_key: item.claveSat ?? CLAVES_SAT_MEDICOS.consulta.clave,
        unit_key:    UNIDAD_SAT,
        price:       item.unitPrice ?? item.price ?? item.total ?? 0,
        tax_included: true,
      },
      discount: item.discount ?? 0,
    }));

    if (items.length === 0) {
      return NextResponse.json({ error: "La factura no tiene conceptos" }, { status: 400 });
    }

    const result = await createInvoice({
      orgApiKey,
      customerId,
      usoCfdi:     usoCfdi ?? "D01",
      paymentForm: paymentForm ?? "03",
      items,
      notes: `Clínica: ${clinic.name}${clinic.rfcEmisor ? ` | RFC: ${clinic.rfcEmisor}` : ""}`,
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

  // ?invoiceId= devuelve el CFDI de una factura puntual (lo usa el modal para
  // resolver el cfdiId de una factura ya timbrada y ofrecer descarga PDF/XML).
  const invoiceId = req.nextUrl.searchParams.get("invoiceId");

  const cfdis = await prisma.cfdiRecord.findMany({
    where:   { clinicId: ctx.clinicId, ...(invoiceId ? { invoiceId } : {}) },
    orderBy: { createdAt: "desc" },
    take:    invoiceId ? 1 : 50,
  });
  return NextResponse.json(cfdis);
}
