import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { appointmentToDTO } from "@/lib/agenda/server";
import {
  changesToTreatments,
  createOrUpdateSnapshot,
  diffSnapshots,
  ensureDentalCatalog,
  findPreviousSnapshot,
  readCurrentEntries,
} from "@/lib/odontogram/snapshot";

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
        select: { id: true, specialtyData: true },
      })
    : await prisma.medicalRecord.findFirst({
        where: {
          clinicId: session.clinic.id,
          specialtyData: {
            path: ["appointmentId"],
            equals: params.id,
          },
        },
        select: { id: true, specialtyData: true },
        orderBy: { createdAt: "desc" },
      });

  const updated = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.update({
      where: { id: params.id },
      data: { status: "COMPLETED", completedAt: new Date() },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (note && parsed.data.signNote !== false) {
      const currentSpec = (note.specialtyData ?? {}) as Record<string, unknown>;
      await tx.medicalRecord.update({
        where: { id: note.id },
        data: {
          specialtyData: {
            ...currentSpec,
            status: "SIGNED",
            signedAt: new Date().toISOString(),
          },
        },
      });
    }
    return appt;
  });

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
      // Primera consulta: tratamos el snapshot completo como "todos los
      // estados activos son tratamientos hechos hoy".
      const changes = currentEntries
        .filter((e) => e.state !== "SANO")
        .map((e) => ({
          toothNumber: e.toothNumber,
          surface: e.surface,
          prevState: null,
          newState: e.state,
        }));
      suggestedTreatments = await changesToTreatments(changes, session.clinic.id);
    }
  } catch (err) {
    console.error("[/api/appointments/:id/complete] snapshot/diff error", err);
  }

  return NextResponse.json({
    appointment: appointmentToDTO(updated, session.clinic.category),
    clinicalNoteId: note?.id ?? null,
    signed: !!note && parsed.data.signNote !== false,
    odontogramSnapshotId: snapshotId,
    suggestedTreatments,
  });
}
