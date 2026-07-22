import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { computeRiskFlags, deriveSyncArrays, mergeAdditive } from "@/lib/health-questionnaire";

export const dynamic = "force-dynamic";

/**
 * GET /api/patients/[id]/health-questionnaire
 * Devuelve { current, history }. current = el vigente (más reciente);
 * history = los últimos 20 llenados (versionado simple). Multi-tenant:
 * clinicId SIEMPRE de la sesión; valida pertenencia del paciente.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Visibilidad por paciente: 404 si el viewer no puede ver este paciente.
  const denied = await assertPatientVisible(params.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const list = await prisma.healthQuestionnaire.findMany({
    where: { clinicId: ctx.clinicId, patientId: params.id },
    orderBy: { filledAt: "desc" },
    take: 20,
  });

  // Resolver nombre del staff que llenó cada versión (no hay relación
  // Prisma a propósito → una sola query extra y mapeo en memoria).
  const ids: string[] = [];
  list.forEach((q) => { if (q.filledById && ids.indexOf(q.filledById) === -1) ids.push(q.filledById); });
  let nameById: Record<string, string> = {};
  if (ids.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, clinicId: ctx.clinicId },
      select: { id: true, firstName: true, lastName: true },
    });
    users.forEach((u) => { nameById[u.id] = `${u.firstName} ${u.lastName}`.trim(); });
  }
  const withNames = list.map((q) => ({
    ...q,
    filledByName: q.filledById ? (nameById[q.filledById] ?? null) : null,
  }));

  return NextResponse.json({ current: withNames[0] ?? null, history: withNames });
}

/**
 * POST /api/patients/[id]/health-questionnaire
 * Crea una NUEVA versión del cuestionario. Calcula riskFlags server-side
 * (autoridad) y hace merge ADITIVO (dedup) hacia Patient.allergies /
 * chronicConditions / currentMedications sin borrar lo capturado a mano.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Visibilidad por paciente: 404 si el viewer no puede ver este paciente.
  const denied = await assertPatientVisible(params.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, allergies: true, chronicConditions: true, currentMedications: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const answers = body && typeof body.answers === "object" && body.answers && !Array.isArray(body.answers)
    ? body.answers
    : {};
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  const riskFlags = computeRiskFlags(answers);
  const sync = deriveSyncArrays(answers);

  const created = await prisma.healthQuestionnaire.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: params.id,
      filledById: ctx.userId,
      answers,
      riskFlags,
      notes,
    },
  });

  // Merge ADITIVO hacia Patient — mantiene vivas las alertas existentes del
  // panel sin tocar su código.
  const nextAllergies   = mergeAdditive(patient.allergies, sync.allergies);
  const nextConditions  = mergeAdditive(patient.chronicConditions, sync.chronicConditions);
  const nextMedications = mergeAdditive(patient.currentMedications, sync.currentMedications);
  await prisma.patient.update({
    where: { id: params.id },
    data: {
      allergies: nextAllergies,
      chronicConditions: nextConditions,
      currentMedications: nextMedications,
    },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient",
    entityId: params.id,
    action: "create",
    after: { healthQuestionnaireId: created.id, riskFlags },
  });

  return NextResponse.json(
    {
      questionnaire: { ...created, filledByName: null },
      riskFlags,
      synced: {
        allergies: nextAllergies,
        chronicConditions: nextConditions,
        currentMedications: nextMedications,
      },
    },
    { status: 201 },
  );
}
