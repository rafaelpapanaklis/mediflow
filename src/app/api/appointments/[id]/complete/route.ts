import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
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
import { assertPatientVisible, ensureUserCanSeePatient } from "@/lib/patient-visibility";
import { doctorAlCambiarEstado } from "@/lib/agenda/sin-doctor";
import { sobreturnoAlAsignar } from "@/lib/agenda/sobreturno-al-asignar.server";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { canTransition, isAppointmentOverlapError } from "@/lib/agenda/transitions";
import { inicioParaCompletar } from "@/lib/clinical/inicio-para-completar";
import { textoCita } from "@/lib/movimientos-paciente/textos";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";
import { cerrarFilaDeLaCita } from "@/lib/walk-in/cerrar-fila-de-la-cita";

export const dynamic = "force-dynamic";

const Schema = z.object({
  /** ID de la nota clínica vinculada (opcional — si no se manda, se busca
   *  por specialtyData.appointmentId === appointmentId). */
  clinicalNoteId: z.string().min(1).optional(),
  /** Si true, marca la nota como SIGNED al cerrar la cita. */
  signNote: z.boolean().optional().default(true),
});

interface Params { params: Promise<{ id: string }> }

/**
 * PATCH /api/appointments/[id]/complete
 * Marca la cita como COMPLETED y, si existe una nota clínica vinculada,
 * la firma (specialtyData.status = "SIGNED").
 */
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  // Gate de rol (P1-1): cerrar la cita FIRMA la nota clínica (specialtyData
  // status:"SIGNED") — el evento legalmente decisivo de NOM-004. Es un acto
  // clínico: DOCTOR/ADMIN/SUPER_ADMIN, igual que COMPLETED en la matriz de
  // transitions. Antes esta ruta no tenía ningún gate y cualquier sesión de la
  // clínica (READONLY o recepción) quedaba registrada como firmante.
  const forbidden = requireRole(session, ["DOCTOR", "ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

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
    select: { id: true, status: true, doctorId: true, patientId: true, startsAt: true, endsAt: true, startedAt: true, overrideReason: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Visibilidad por paciente: el cierre lee clínica del paciente (odontograma) y
  // devuelve su nombre vía appointmentToDTO. Un paciente restringido no debe ser
  // cerrado ni revelado a quien no puede verlo (404 = ocultar existencia).
  if (existing.patientId) {
    const denied = await assertPatientVisible(existing.patientId, { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id });
    if (denied) return denied;
  }
  // Un DOCTOR solo cierra SUS citas. ws1-t11 (D3) — una «Sin doctor» que cierra un DOCTOR pasa a ser suya.
  const decisionDoctor = doctorAlCambiarEstado({
    role: session.user.role,
    userId: session.user.id,
    citaDoctorId: existing.doctorId,
    destino: "COMPLETED",
    pedido: undefined,
  });
  if (decisionDoctor.rechazo) {
    return NextResponse.json({ error: decisionDoctor.rechazo.error }, { status: decisionDoctor.rechazo.status });
  }

  // Permiso granular ADEMÁS del rol (P1-3). Tras el assert de visibilidad
  // para conservar el 404 sobre el 403.
  const deniedPerm = denyIfMissingPermission(session.user, "agenda.edit");
  if (deniedPerm) return deniedPerm;

  // Máquina de estados REAL (P1-1). El gate de rol de arriba dice QUIÉN puede
  // cerrar; esto dice DESDE QUÉ ESTADO. Sin ello un DOCTOR "completaba" —y
  // FIRMABA la nota, el acto legalmente decisivo de la NOM-004— una cita ya
  // CANCELLED, NO_SHOW o COMPLETED, transición que su hermana PATCH /status
  // rechaza con 409. Dos puertas al mismo cambio de estado con reglas distintas
  // es una puerta sin regla.
  //
  // No rompe el flujo vivo: el único caller (`patient-detail-client.tsx`) sólo
  // arma el botón de cerrar cuando la cita está IN_PROGRESS, y IN_PROGRESS →
  // COMPLETED está en la matriz para DOCTOR/ADMIN/SUPER_ADMIN — exactamente los
  // roles que el requireRole de arriba deja pasar. Lo que ahora falla es el
  // caso que debía fallar: cerrar dos veces, o cerrar lo ya cancelado.
  if (existing.status === "PENDING") {
    return NextResponse.json(
      { error: "legacy_status", reason: "Status PENDING ya no soportado. Migrá a SCHEDULED." },
      { status: 409 },
    );
  }
  const check = canTransition(
    existing.status as Exclude<typeof existing.status, "PENDING">,
    "COMPLETED",
    session.user.role,
    new Date(),
    // F-2 (tercera auditoría): una consulta ya iniciada hoy, antes de la hora de su cita de hoy, se cierra (la regla
    // de «cita que todavía no empieza» se mide contra el inicio real). Una cita de otro día sigue rechazándose.
    inicioParaCompletar(existing, new Date(), await zonaDeClinica(session.clinic.id)),
  );
  if (!check.ok) {
    // Mismo contrato de códigos que PATCH /status: rol = 403, estado = 409.
    if (check.code === "forbidden_role") {
      return NextResponse.json({ error: "forbidden", reason: check.error }, { status: 403 });
    }
    return NextResponse.json(
      { error: "invalid_transition", reason: check.error },
      { status: 409 },
    );
  }

  // Find linked clinical note: explícito por id o por specialtyData.appointmentId.
  // En AMBAS ramas la nota se ata al PACIENTE de esta cita, no solo a la clínica
  // (P1-2): scopear solo por clinicId permitía cerrar una cita propia mandando
  // {"clinicalNoteId":"<id ajeno>"} y firmar el expediente de OTRO paciente —
  // alteración de un expediente firmado, irreversible desde la UI.
  let note = parsed.data.clinicalNoteId
    ? await prisma.medicalRecord.findFirst({
        where: {
          id: parsed.data.clinicalNoteId,
          clinicId: session.clinic.id,
          patientId: existing.patientId,
        },
        select: { id: true, doctorId: true, specialtyData: true, subjective: true, objective: true, assessment: true, plan: true },
      })
    : await prisma.medicalRecord.findFirst({
        where: {
          clinicId: session.clinic.id,
          patientId: existing.patientId,
          specialtyData: {
            path: ["appointmentId"],
            equals: params.id,
          },
        },
        select: { id: true, doctorId: true, specialtyData: true, subjective: true, objective: true, assessment: true, plan: true },
        orderBy: { createdAt: "desc" },
      });

  // NOM-004 CAMPOS-OBLIGATORIOS (brecha #19): no cerrar la cita FIRMANDO una nota
  // vacía. Si hay nota a firmar y está vacía, se bloquea el cierre (422).
  // Una nota YA firmada (p. ej. la consulta guardada con «Guardar consulta», que adoptó el borrador de esta
  // cita) no se vuelve a firmar: su signedAt es el de verdad. La cita se cierra igual.
  const yaFirmada = (note?.specialtyData as Record<string, unknown> | null)?.status === "SIGNED";
  const willSign = !!note && parsed.data.signNote !== false && !yaFirmada;
  if (willSign && note && isClinicalNoteEmpty(note)) {
    return NextResponse.json({ error: EMPTY_NOTE_ERROR }, { status: 422 });
  }

  // ws1-t11 — una «Sin doctor» que se cierra con su nota de consulta es de quien escribió la nota (si no la
  // cierra un DOCTOR, que ya se la quedó). Sin nota, se cierra «Sin doctor» (D9 del plan).
  // v2 (m5): el autor solo si la nota es de ESTA cita (`clinicalNoteId` puede ser cualquier nota del paciente)
  // y el autor recibe citas en la clínica (no una asistente, ni un doctor dado de baja). Si no, «Sin doctor».
  const notaDeEstaCita = (note?.specialtyData as { appointmentId?: unknown } | null)?.appointmentId === params.id;
  const autorQueAtiende =
    existing.doctorId === null && !decisionDoctor.asignar && note?.doctorId && notaDeEstaCita
      ? await prisma.user.findFirst({
          where: { id: note.doctorId, clinicId: session.clinic.id, ...RECIBE_CITAS_WHERE },
          select: { id: true },
        })
      : null;
  const doctorAsignado: string | null =
    existing.doctorId === null ? decisionDoctor.asignar ?? autorQueAtiende?.id ?? null : null;

  const completedAt = new Date();
  // v2 (M1/m1): si quien la atendió ya tiene otra cita a esa hora, la cita se cierra como sobreturno (con rastro).
  const sobreturno = doctorAsignado
    ? await sobreturnoAlAsignar({
        clinicId: session.clinic.id,
        appointmentId: params.id,
        doctorId: doctorAsignado,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        overrideActual: existing.overrideReason,
        destino: "COMPLETED",
        confirmacion: {},
        viewer: { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id },
        userId: session.user.id,
        ahora: completedAt,
      })
    : null;
  const signedAtIso = new Date().toISOString();
  const prevSpec = (note?.specialtyData ?? {}) as Record<string, unknown>;

  let updated;
  try {
  updated = await prisma.$transaction(async (tx) => {
    // WS1-T3 v7 (revisión t8 de la v6) — con el estado que se leyó arriba: si
    // la cita se canceló (o cambió) en este instante, no se cierra ni se firma.
    const r = await tx.appointment.updateMany({
      where: { id: params.id, clinicId: session.clinic.id, status: existing.status },
      data: { status: "COMPLETED", completedAt, ...(doctorAsignado ? { doctorId: doctorAsignado } : {}), ...(sobreturno?.datos ?? {}) },
    });
    if (r.count !== 1) return null;
    // ws1-t11 — quien queda como doctor de la cita tiene que poder ver al paciente (como al agendar).
    if (doctorAsignado && existing.patientId) {
      await ensureUserCanSeePatient(tx, existing.patientId, doctorAsignado, session.clinic.id);
    }
    const appt = await tx.appointment.findFirst({
      where: { id: params.id, clinicId: session.clinic.id },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!appt) return null;
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
  } catch (err) {
    // ws1-t11 — quien la atendió ya tiene otra cita viva a esa hora (la constraint de siempre).
    if (doctorAsignado && isAppointmentOverlapError(err)) {
      return NextResponse.json(
        { error: "appointment_overlap", reason: "Otra cita de ese doctor acaba de ocupar esta hora. Intenta de nuevo." },
        { status: 409 },
      );
    }
    throw err;
  }
  if (!updated) {
    return NextResponse.json(
      { error: "invalid_transition", reason: "La cita cambió de estado mientras tanto. Recarga e intenta de nuevo." },
      { status: 409 },
    );
  }

  // ws1-t1: si era la cita de un walk-in, su fila deja de estar «En atención».
  await cerrarFilaDeLaCita({ clinicId: session.clinic.id, appointmentId: params.id, estado: "COMPLETED", ahora: completedAt });

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
    patientId: existing.patientId,
    texto: textoCita.completada(existing.startsAt, await zonaDeClinica(session.clinic.id)),
    before: { status: existing.status, ...(doctorAsignado ? { doctorId: null } : {}) },
    after: {
      status: "COMPLETED",
      completedAt: completedAt.toISOString(),
      ...(doctorAsignado ? { doctorId: doctorAsignado } : {}),
      // v2 (M1): EL RASTRO del sobreturno.
      ...(sobreturno?.conCita ? { sobreturno: { conCita: sobreturno.conCita } } : {}),
    },
  });
  if (willSign && note) {
    await logMutation({
      req,
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "record",
      entityId: note.id,
      action: "update",
      patientId: existing.patientId,
      texto: "Firmó la nota de la consulta",
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
        estado: e.estado ?? null, // rojo (por hacer) o previo: no se cobra (ws1-t6)
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
