import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { citasParaHecho } from "@/lib/treatments/cita-del-hecho.server";

export const dynamic = "force-dynamic";

/**
 * GET /api/treatments/[id]/citas-para-hecho — v17 (decisión 1 de Rafael, 28-oct): las citas recientes del
 * paciente del plan para elegir en qué cita se hizo lo que se marca «Hecho» desde la tarjeta (la de hoy
 * primero), y si cada una tiene nota clínica. Solo lectura.
 *
 * Quién: el mismo de «Hecho» — `treatments.edit`, o SUPER_ADMIN siempre —, en el plan de cualquier doctor
 * (decisión 4). Clínica de la sesión y visibilidad del paciente.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = ctx.role === "SUPER_ADMIN" ? null : denyIfMissingPermission(ctx, "treatments.edit");
  if (denied) return denied;

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, patientId: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (!plan.patientId) return NextResponse.json({ citas: [] });
  const oculto = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;

  const clinica = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } }).catch(() => null);
  const citas = await citasParaHecho(ctx.clinicId, plan.patientId, { timezone: clinica?.timezone ?? null });
  return NextResponse.json({ citas });
}
