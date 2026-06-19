import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { appointmentToDTO } from "@/lib/agenda/server";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import {
  changesToTreatments,
  createOrUpdateSnapshot,
  diffSnapshots,
  ensureDentalCatalog,
  findPreviousSnapshot,
  readCurrentEntries,
} from "@/lib/odontogram/snapshot";
import { sendReviewInvitation } from "@/lib/reviews/invite";
import { logMutation } from "@/lib/audit";
import { EMPTY_NOTE_ERROR, isClinicalNoteEmpty } from "@/lib/clinical/note-validation";

export const dynamic = "force-dynamic";

const Schema = z.object({
  /** ID de la nota clínica vinculada (opcional — si no se manda, se busca
   *  por specialtyData.appointmentId === appointmentId). */
  clinicalNoteId: z.string().min(1).optional(),
  /** Si true, marca la nota como SIGNED al cerrar la cita. */
  signNote: z.boolean().optional().default(true),
});

interface Params { params: { id: string } }

/**
 * PATCH /api/appointments/[id]/complete
 * Marca la cita como COMPLETED y, si existe una nota clínica vinculada,
 * la firma (specialtyData.status = "SIGNED").
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, status: true, doctorId: true, patientId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    session.user.role === "DOCTOR" &&
    existing.doctorId !== session.user.id
  ) {
    return NextResponse.json({ error: "not_your_appointment" }, { status: 403 });
  }

  // Find linked clinical note: explícito por id o por specialtyData.appointmentId.
  let note = parsed.data.clinicalNoteId
    ? await prisma.medicalRecord.findFirst({
        where: {
          id: parsed.data.clinicalNoteId,
          clinicId: session.clinic.id,
        },
        select: { id: true, specialtyData: true, subjective: true, objective: true, assessment: true, plan: true },
      })
    : await prisma.medicalRecord.findFirst({
        where: {
          clinicId: session.clinic.id,
          specialtyData: {
            path: ["appointmentId"],
            equals: params.id,
          },
        },
        select: { id: true, specialtyData: true, subjective: true, objective: true, assessment: true, plan: true },
        orderBy: { createdAt: "desc" },
      });

  // NOM-004 CAMPOS-OBLIGATORIOS (brecha #19): no cerrar la cita FIRMANDO una nota
  // vacía. Si hay nota a firmar y está vacía, se bloquea el cierre (422).
  const willSign = !!note && parsed.data.signNote !== false;
  if (willSign && note && isClinicalNoteEmpty(note)) {
    return NextResponse.json({ error: EMPTY_NOTE_ERROR }, { status: 422 });
  }

  const completedAt = new Date();
  const signedAtIso = new Date().toISOString();
  const prevSpec = (note?.specialtyData ?? {}) as Record<string, unknown>;

  const updated = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.update({
      where: { id: params.id },
      data: { status: "COMPLETED", completedAt },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (willSign && note) {
      const currentSpec = (note.specialtyData ?? {}) as Record<string, unknown>;
      await tx.medicalRecord.update({
        where: { id: note.id },
        data: {
          specialtyData: {
            ...currentSpec,
            status: "SIGNED",
            signedAt: signedAtIso,
          },
        },
      });
    }
    return appt;
  });

  // NOM-004 / NOM-024 AUDITORIA (brecha #9): el cierre de la cita y la FIRMA del
  // expediente — evento legalmente decisivo — ahora dejan rastro. Antes la firma
  // NO se auditaba. clinicId SIEMPRE de la sesión (multi-tenant); best-effort.
  await logMutation({
    req,
    clinicId: session.clinic.id,
    userId: session.user.id,
    entityType: "appointment",
    entityId: params.id,
    action: "update",
    before: { status: existing.status },
    after: { status: "COMPLETED", completedAt: completedAt.toISOString() },
  });
  if (willSign && note) {
    await logMutation({
      req,
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "record",
      entityId: note.id,
      action: "update",
      before: { status: prevSpec.status ?? null, signedAt: prevSpec.signedAt ?? null },
      after: { status: "SIGNED", signedAt: signedAtIso },
    });
  }

  // ─── Snapshot odontograma + diff vs anterior + tratamientos sugeridos ───
  // Se ejecuta DESPUÉS de marcar COMPLETED para no afectar el cierre si algo
  // falla aquí (errores se loguean pero no rompen la respuesta principal).
  let snapshotId: string | null = null;
  let suggestedTreatments: Awaited<ReturnType<typeof changesToTreatments>> = [];
  try {
    await ensureDentalCatalog(session.clinic.id);
    const currentEntries = await readCurrentEntries(existing.patientId);
    const snap = await createOrUpdateSnapshot(
      existing.patientId,
      params.id,
      currentEntries,
    );
    snapshotId = snap.id;

    const prevEntries = await findPreviousSnapshot(
      existing.patientId,
      new Date(),
      params.id,
    );
    if (prevEntries) {
      const changes = diffSnapshots(prevEntries, currentEntries);
      suggestedTreatments = await changesToTreatments(changes, session.clinic.id);
    } else {
      // Primera consulta: tratamos el snapshot completo como "todas las
      // condiciones activas son tratamientos hechos hoy".
      const changes = currentEntries.map((e) => ({
        toothNumber: e.toothNumber,
        surface: e.surface,
        conditionId: e.conditionId,
        type: "added" as const,
      }));
      suggestedTreatments = await changesToTreatments(changes, session.clinic.id);
    }
  } catch (err) {
    console.error("[/api/appointments/:id/complete] snapshot/diff error", err);
  }

  // Invitación a reseña verificada (best-effort; nunca rompe el cierre). WS2-T2.
  try {
    await sendReviewInvitation(params.id);
  } catch (err) {
    console.error("[/api/appointments/:id/complete] review invite error", err);
  }

  revalidateAfter("appointments");
  revalidatePatientProfile(existing.patientId);
  return NextResponse.json({
    appointment: appointmentToDTO(updated, session.clinic.category),
    clinicalNoteId: note?.id ?? null,
    signed: willSign,
    odontogramSnapshotId: snapshotId,
    suggestedTreatments,
  });
}
