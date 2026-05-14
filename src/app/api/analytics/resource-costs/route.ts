import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";
// Vercel Pro permite hasta 300s. 60s da cabecera mientras instrumentamos
// el query — NO es la solución final, solo evita el corte abrupto a los 10s.
export const maxDuration = 60;

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
  console.time("resource-costs:total");
  const user = await getCurrentUser();
  const denied = denyIfMissingPermission(user, "analytics.view");
  if (denied) {
    console.timeEnd("resource-costs:total");
    return denied;
  }
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const ref = monthParam ? new Date(`${monthParam}-01T00:00:00Z`) : new Date();
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59);

  // Todos los recursos activos de la clínica — costos aplican a cualquier
  // tipo (silla, consultorio, sala de espera, lab, radio).
  console.time("resource-costs:resources");
  const resources = await prisma.resource.findMany({
    where: { clinicId, isActive: true },
    select: {
      id: true,
      name: true,
      orderIndex: true,
      cost: { select: { monthlyRent: true, monthlyOps: true, notes: true } },
    },
    orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
  });
  console.timeEnd("resource-costs:resources");
  console.log(`resource-costs:resource-count=${resources.length} clinicId=${clinicId}`);

  // Revenue por sillón en el mes — 1 sola query con JOIN + GROUP BY en
  // SQL. Antes hacíamos findMany sin LIMIT cargando todas las invoices
  // pagadas del mes y agregábamos en JS → 503 timeout en preview.
  // Multi-tenant: i.clinicId directo + restringimos a resourceIds que
  // ya vienen filtrados por clinicId arriba (defense in depth).
  const resourceIds = resources.map((r) => r.id);
  const revenueByResource = new Map<string, number>();
  if (resourceIds.length > 0) {
    console.time("resource-costs:revenue");
    const rows = await prisma.$queryRaw<Array<{ resourceId: string; revenue: number }>>`
      SELECT a."resourceId" AS "resourceId",
             COALESCE(SUM(i.paid), 0)::float AS revenue
      FROM invoices i
      JOIN appointments a ON a.id = i."appointmentId"
      WHERE i."clinicId" = ${clinicId}
        AND i.status::text IN ('PAID', 'PARTIAL')
        AND a."startsAt" >= ${monthStart}
        AND a."startsAt" <= ${monthEnd}
        AND a."resourceId" IN (${Prisma.join(resourceIds)})
      GROUP BY a."resourceId"
    `;
    console.timeEnd("resource-costs:revenue");
    console.log(`resource-costs:revenue-rows=${rows.length}`);
    for (const row of rows) {
      revenueByResource.set(row.resourceId, Number(row.revenue));
    }
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

  console.timeEnd("resource-costs:total");
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
  const denied = denyIfMissingPermission(user, "resources.edit");
  if (denied) return denied;
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
  const denied = denyIfMissingPermission(user, "resources.edit");
  if (denied) return denied;
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
