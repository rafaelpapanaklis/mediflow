import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).optional(),
  doctorId: z.string().min(1).optional(),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
});

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí, pero aplicando el gate
// de plan vencido que las copias locales se saltaban. ctx.user es la fila
// User (include clinic) con permissionsOverride normalizado.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

/**
 * POST /api/clinical-notes
 * Crea una nota clínica en estado DRAFT, opcionalmente vinculada a una
 * cita (appointmentId guardado dentro de specialtyData para no requerir
 * migración del schema).
 */
export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(dbUser, "medicalRecord.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Tenant + visibilidad por paciente en un solo query (Ola 3): sin esto, un
  // doctor excluido creaba notas clínicas del paciente restringido con el id.
  const visDenied = await assertPatientVisible(parsed.data.patientId, {
    userId: dbUser.id,
    role: dbUser.role,
    clinicId: dbUser.clinicId,
  });
  if (visDenied) return visDenied;

  const doctorId = parsed.data.doctorId ?? dbUser.id;
  if (parsed.data.doctorId) {
    const d = await prisma.user.findFirst({
      where: { id: parsed.data.doctorId, clinicId: dbUser.clinicId, isActive: true },
      select: { id: true },
    });
    if (!d) return NextResponse.json({ error: "doctor_not_found" }, { status: 404 });
  }

  let appointmentExists = true;
  if (parsed.data.appointmentId) {
    const a = await prisma.appointment.findFirst({
      where: { id: parsed.data.appointmentId, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    appointmentExists = a !== null;
    if (!appointmentExists) {
      return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });
    }
  }

  const record = await prisma.medicalRecord.create({
    data: {
      clinicId: dbUser.clinicId,
      patientId: parsed.data.patientId,
      doctorId,
      subjective: parsed.data.subjective ?? null,
      objective: parsed.data.objective ?? null,
      assessment: parsed.data.assessment ?? null,
      plan: parsed.data.plan ?? null,
      specialtyData: {
        status: "DRAFT",
        appointmentId: parsed.data.appointmentId ?? null,
        attachments: [],
      },
    },
    select: {
      id: true,
      patientId: true,
      doctorId: true,
      subjective: true,
      objective: true,
      assessment: true,
      plan: true,
      specialtyData: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // NOM-004 AUDITORIA (brecha #9): la creación del expediente deja rastro.
  // clinicId SIEMPRE de la sesión (multi-tenant); best-effort, nunca rompe el alta.
  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "record",
    entityId: record.id,
    action: "create",
    after: {
      patientId: record.patientId,
      doctorId: record.doctorId,
      status: "DRAFT",
      appointmentId: parsed.data.appointmentId ?? null,
    },
  });

  revalidateAfter("clinicalNotes");
  revalidatePatientProfile(record.patientId);
  return NextResponse.json({ note: record }, { status: 201 });
}
