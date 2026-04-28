import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/resource-costs?month=YYYY-MM
 *
 * Devuelve por sillón (Resource kind=CHAIR de la clínica):
 *  - resourceId, name
 *  - monthlyRent, monthlyOps (de ResourceCost; 0 si no configurado)
 *  - revenue: SUM de invoice.paid donde invoice.appointment.resourceId
 *    coincide y el appointment.startsAt cae en el mes solicitado.
 *  - margin = revenue - (monthlyRent + monthlyOps)
 *  - marginPct = margin / max(revenue, 1) × 100
 *
 * Multi-tenant:
 * - Lista de Resources filtra clinicId directo.
 * - ResourceCost NO tiene clinicId directo, pero como el FK apunta a
 *   Resource.id que ya filtramos por clinicId, está covered.
 * - Invoices filtran clinicId directo + appointment.resourceId match.
 *
 * POST  /api/analytics/resource-costs   — crear o actualizar costo de
 *                                          un resource (admin only)
 *   Body: { resourceId, monthlyRent, monthlyOps, notes? }
 *
 * DELETE /api/analytics/resource-costs?resourceId=xxx
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const ref = monthParam ? new Date(`${monthParam}-01T00:00:00Z`) : new Date();
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59);

  // Sillones de la clínica (clinicId directo).
  const resources = await prisma.resource.findMany({
    where: { clinicId, kind: "CHAIR", isActive: true },
    select: {
      id: true,
      name: true,
      orderIndex: true,
      cost: { select: { monthlyRent: true, monthlyOps: true, notes: true } },
    },
    orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
  });

  // Revenue por sillón en el mes — sum de invoice.paid filtrado por
  // appointment.resourceId. Invoice tiene clinicId directo + nested
  // filter del appointment.
  const invoices = await prisma.invoice.findMany({
    where: {
      clinicId,
      status: { in: ["PAID", "PARTIAL"] },
      appointment: {
        startsAt: { gte: monthStart, lte: monthEnd },
        resourceId: { not: null },
      },
    },
    select: {
      paid: true,
      appointment: { select: { resourceId: true } },
    },
  });

  const revenueByResource = new Map<string, number>();
  for (const inv of invoices) {
    const rid = inv.appointment?.resourceId;
    if (!rid) continue;
    revenueByResource.set(rid, (revenueByResource.get(rid) ?? 0) + inv.paid);
  }

  const rows = resources.map((r) => {
    const monthlyRent = r.cost ? Number(r.cost.monthlyRent) : 0;
    const monthlyOps = r.cost ? Number(r.cost.monthlyOps) : 0;
    const totalCost = monthlyRent + monthlyOps;
    const revenue = revenueByResource.get(r.id) ?? 0;
    const margin = revenue - totalCost;
    const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;
    return {
      resourceId: r.id,
      name: r.name,
      monthlyRent,
      monthlyOps,
      totalCost,
      revenue: Math.round(revenue * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPct,
      notes: r.cost?.notes ?? null,
      configured: r.cost != null,
    };
  });

  return NextResponse.json({
    month: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
    resources: rows,
    totals: {
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      cost: rows.reduce((s, r) => s + r.totalCost, 0),
      margin: rows.reduce((s, r) => s + r.margin, 0),
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  let body: { resourceId?: string; monthlyRent?: number; monthlyOps?: number; notes?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.resourceId) {
    return NextResponse.json({ error: "missing_resourceId" }, { status: 400 });
  }
  const monthlyRent = Number(body.monthlyRent ?? 0);
  const monthlyOps = Number(body.monthlyOps ?? 0);
  if (monthlyRent < 0 || monthlyOps < 0 || isNaN(monthlyRent) || isNaN(monthlyOps)) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  // Validar que el Resource pertenezca al clinicId del usuario (tenant scope).
  const resource = await prisma.resource.findFirst({
    where: { id: body.resourceId, clinicId },
    select: { id: true },
  });
  if (!resource) {
    return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
  }

  const cost = await prisma.resourceCost.upsert({
    where: { resourceId: body.resourceId },
    create: {
      resourceId: body.resourceId,
      monthlyRent,
      monthlyOps,
      notes: body.notes?.slice(0, 500) ?? null,
    },
    update: {
      monthlyRent,
      monthlyOps,
      notes: body.notes?.slice(0, 500) ?? null,
    },
  });

  return NextResponse.json({
    resourceId: cost.resourceId,
    monthlyRent: Number(cost.monthlyRent),
    monthlyOps: Number(cost.monthlyOps),
    notes: cost.notes,
  });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get("resourceId");
  if (!resourceId) {
    return NextResponse.json({ error: "missing_resourceId" }, { status: 400 });
  }

  // Validar tenant antes de delete.
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, clinicId },
    select: { id: true },
  });
  if (!resource) {
    return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
  }

  await prisma.resourceCost.deleteMany({ where: { resourceId } });
  return NextResponse.json({ deleted: true });
}
