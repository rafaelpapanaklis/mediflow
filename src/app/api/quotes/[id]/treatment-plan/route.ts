import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { distinctPhaseCount } from "@/lib/quotes/compute";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * POST /api/quotes/[id]/treatment-plan — crea un plan de tratamiento ACTIVE a
 * partir de un presupuesto ACEPTADO. totalCost = total; sesiones = nº de fases.
 * Idempotente: si ya se generó (y sigue existiendo), devuelve el mismo plan.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { items: { select: { phase: true } } },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
  if (quote.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: "Solo se crea un plan desde un presupuesto aceptado" },
      { status: 409 },
    );
  }

  if (quote.treatmentPlanId) {
    const existing = await prisma.treatmentPlan.findFirst({
      where: { id: quote.treatmentPlanId, clinicId: ctx.clinicId },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json({ treatmentPlanId: existing.id, name: existing.name, already: true });
    }
  }

  const doctorId = quote.createdById ?? ctx.userId;
  const totalSessions = distinctPhaseCount(quote.items.map((i) => ({ phase: i.phase == null ? null : Number(i.phase) })));
  const sessionIntervalDays = 30;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + totalSessions * sessionIntervalDays * 24 * 60 * 60 * 1000);
  const nextExpectedDate = new Date(startDate.getTime() + sessionIntervalDays * 24 * 60 * 60 * 1000);

  const plan = await prisma.treatmentPlan.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: quote.patientId,
      doctorId,
      name: quote.title.slice(0, 160),
      description: `Generado desde presupuesto ${quote.folio}`,
      totalSessions,
      sessionIntervalDays,
      totalCost: Number(quote.total) || 0,
      status: "ACTIVE",
      startDate,
      endDate,
      nextExpectedDate,
    },
    select: { id: true, name: true },
  });

  await prisma.quote.update({ where: { id: quote.id }, data: { treatmentPlanId: plan.id } });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "treatment",
    entityId: plan.id,
    action: "create",
    changes: { fromQuote: { before: null, after: quote.folio } },
  });

  return NextResponse.json({ treatmentPlanId: plan.id, name: plan.name }, { status: 201 });
}
