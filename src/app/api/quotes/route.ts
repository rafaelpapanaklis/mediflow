import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createQuoteWithFolio, parseValidUntil } from "@/lib/quotes/service";
import { serializeQuote } from "@/lib/quotes/serialize";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

/**
 * GET /api/quotes?patientId=...  — lista los presupuestos de un paciente.
 * Todo filtrado por la clínica de la sesión. Auto-expira los PRESENTED vencidos.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });

  // Visibilidad por paciente: lee un solo paciente por id → 404 si no lo puede ver.
  const denied = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Vencimiento perezoso: PRESENTED con validUntil pasada → EXPIRED.
  await prisma.quote.updateMany({
    where: {
      clinicId: ctx.clinicId,
      patientId,
      status: "PRESENTED",
      validUntil: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });

  const quotes = await prisma.quote.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(quotes.map(serializeQuote));
}

/**
 * POST /api/quotes — crea un presupuesto DRAFT. Solo el presupuesto: NO crea
 * factura ni gasta folio MF. La factura nace cuando el paciente lo acepta y se
 * pulsa «Generar factura» (POST /api/quotes/[id]/invoice), ya PENDIENTE.
 * Body: { patientId, title?, items[], discountPct?, discountAmount?, validUntil?, notes? }
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: "billing.create", la MISMA key que POST /api/invoices.
  // Se puso cuando esta ruta además creaba una factura BORRADOR y quemaba
  // folio. Ya no factura, pero la llave se conserva a propósito: quitarla
  // ensancharía en silencio quién puede crear presupuestos, y eso lo decide
  // la clínica en sus permisos, no un arreglo.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.create");
  if (deniedPerm) return deniedPerm;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const patientId = typeof body.patientId === "string" ? body.patientId : "";
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Visibilidad: la respuesta (serializeQuote de createQuoteWithFolio) incluye el
  // nombre del paciente. Sin este assert, un usuario excluido crea un presupuesto
  // y recibe el nombre del paciente restringido en el eco de la respuesta.
  const denied = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const items = Array.isArray(body.items) ? (body.items as never[]) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Agrega al menos un concepto" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 160)
    : "Presupuesto";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
  const validUntil = parseValidUntil(body.validUntil);

  const quote = await createQuoteWithFolio({
    clinicId: ctx.clinicId,
    patientId,
    createdById: ctx.userId,
    title,
    items,
    discountPct: body.discountPct == null ? null : Number(body.discountPct),
    discountAmount: body.discountAmount == null ? null : Number(body.discountAmount),
    validUntil,
    notes,
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "create",
    changes: { folio: { before: null, after: quote.folio }, total: { before: null, after: Number(quote.total) } },
  });

  // 🔴 Aquí NO se crea factura. Hasta sep-2026 se creaba una en BORRADOR para
  // que saliera ya en «Facturación», y eso convertía cada presupuesto —aceptado
  // o no— en una factura con folio gastado: inflaba el «Cobrar ahora» y el
  // filtro «Con deuda» de la ficha, y un presupuesto rechazado dejaba su
  // factura viva. Pasarla a PENDIENTE habría sido peor: deuda exigible en
  // Caja, reportes y el portal del paciente por presupuestos que nadie aceptó.
  // La factura nace al aceptar, en POST /api/quotes/[id]/invoice.
  //
  // `invoice: null` se conserva en la respuesta: los editores leen ese campo
  // para insertar la factura en Facturación, y con null no insertan nada.
  return NextResponse.json({ ...serializeQuote(quote), invoice: null }, { status: 201 });
}
