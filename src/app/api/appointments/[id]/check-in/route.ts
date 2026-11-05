import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible, ensureUserCanSeePatient } from "@/lib/patient-visibility";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { textoCita } from "@/lib/movimientos-paciente/textos";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";
import {
  MOTIVO_RECORDATORIOS_ADELANTO,
  adelantoParaRespuesta,
  prepararAdelantoAHoy,
} from "@/lib/agenda/adelantar-cita-a-hoy";
import { isAppointmentOverlapError } from "@/lib/agenda/transitions";
import { cancelPendingRemindersForAppointment } from "@/lib/reminders/reschedule.server";
import { sincronizarCitaEnSegundoPlano } from "@/lib/agenda/google-sync";
import { doctorAlCambiarEstado } from "@/lib/agenda/sin-doctor";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { cuerpoDoctorNoRecibeCitasDe } from "@/lib/agenda/roles-que-atienden-db";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  // Permiso granular ADEMÁS del rol (P1-3): el check-in mueve la cita de estado.
  const deniedPerm = denyIfMissingPermission(session.user, "agenda.edit");
  if (deniedPerm) return deniedPerm;

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, status: true, patientId: true, startsAt: true, endsAt: true, doctorId: true, resourceId: true, overrideReason: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Visibilidad por paciente (Ola 3): el check-in muta la cita — mismo assert
  // (y mismo 404) que el PATCH y el /status de la cita. Antes del chequeo de
  // estado para no revelar en qué estado está una cita que no puede ver.
  if (existing.patientId) {
    const visDenied = await assertPatientVisible(existing.patientId, {
      userId: session.user.id,
      role: session.user.role,
      clinicId: session.clinic.id,
    });
    if (visDenied) return visDenied;
  }

  if (
    existing.status === "CHECKED_IN" ||
    existing.status === "IN_PROGRESS" ||
    existing.status === "COMPLETED"
  ) {
    return NextResponse.json(
      { error: "already_checked_in", currentStatus: existing.status },
      { status: 409 },
    );
  }
  if (existing.status === "CANCELLED" || existing.status === "NO_SHOW") {
    return NextResponse.json(
      { error: "invalid_state_for_check_in", currentStatus: existing.status },
      { status: 409 },
    );
  }

  // ws1-t11 — «¿Quién lo atiende?» (opcional) de una cita «Sin doctor». Sin cuerpo, como siempre.
  let pedido: unknown = undefined;
  try {
    const b = (await req.json()) as { doctorId?: unknown } | null;
    pedido = b?.doctorId;
  } catch {
    /* sin cuerpo: la llegada de siempre */
  }
  const decisionDoctor = doctorAlCambiarEstado({
    role: session.user.role,
    userId: session.user.id,
    citaDoctorId: existing.doctorId,
    destino: "CHECKED_IN",
    pedido,
  });
  if (decisionDoctor.rechazo) {
    return NextResponse.json({ error: decisionDoctor.rechazo.error }, { status: decisionDoctor.rechazo.status });
  }
  const doctorAsignado = decisionDoctor.asignar;
  if (doctorAsignado) {
    const d = await prisma.user.findFirst({
      where: { id: doctorAsignado, clinicId: session.clinic.id, ...RECIBE_CITAS_WHERE },
      select: { id: true },
    });
    if (!d) return NextResponse.json(await cuerpoDoctorNoRecibeCitasDe(session.clinic.id, doctorAsignado), { status: 404 });
  }

  const now = new Date();
  // ws1-t8 (decisión 6 de Rafael): llegó hoy el paciente de una cita de un día futuro → la cita se trae a
  // hoy (empieza ahora, misma duración y doctor), sin avisarle de reprogramación. Ver adelantar-cita-a-hoy.ts.
  const zona = await zonaDeClinica(session.clinic.id);
  const adelanto = await prepararAdelantoAHoy({
    clinicId: session.clinic.id,
    cita: { ...existing, doctorId: doctorAsignado ?? existing.doctorId },
    destino: "CHECKED_IN",
    ahora: now,
    zona: zona ?? session.clinic.timezone ?? "America/Mexico_City",
    userId: session.user.id,
  });
  let reclamada = false;
  try {
    reclamada = await prisma.$transaction(async (tx) => {
      // WS1-T3 v7 (revisión t8 de la v6) — con el estado que se leyó arriba: si
      // se canceló (o cambió) en este instante, no se toca y no hay efectos.
      const r = await tx.appointment.updateMany({
        where: { id: params.id, clinicId: session.clinic.id, status: existing.status },
        data: {
          status: "CHECKED_IN",
          checkedInAt: now,
          ...(adelanto?.datos ?? {}),
          ...(doctorAsignado ? { doctorId: doctorAsignado } : {}),
        },
      });
      if (r.count !== 1) return false;
      if (doctorAsignado && existing.patientId) {
        await ensureUserCanSeePatient(tx, existing.patientId, doctorAsignado, session.clinic.id);
      }
      if (adelanto) {
        await cancelPendingRemindersForAppointment(tx, {
          appointmentId: params.id,
          clinicId: session.clinic.id,
          reason: MOTIVO_RECORDATORIOS_ADELANTO,
        });
      }
      return true;
    });
  } catch (err) {
    if (doctorAsignado && isAppointmentOverlapError(err)) {
      return NextResponse.json(
        { error: "appointment_overlap", reason: "Ese doctor ya tiene otra cita a esta hora. Elige a otro doctor o mueve la otra cita." },
        { status: 409 },
      );
    }
    if (adelanto && isAppointmentOverlapError(err)) {
      return NextResponse.json(
        { error: "invalid_transition", reason: "Otra cita acaba de ocupar esta hora con el mismo doctor o sillón. Intenta de nuevo." },
        { status: 409 },
      );
    }
    throw err;
  }
  if (!reclamada) {
    return NextResponse.json(
      { error: "invalid_transition", reason: "La cita cambió de estado mientras tanto. Recarga e intenta de nuevo." },
      { status: 409 },
    );
  }

  // ws1-t11: con doctor nuevo, la descripción del evento de Google cambia (el adelanto ya sincroniza abajo).
  if (doctorAsignado && !adelanto) await sincronizarCitaEnSegundoPlano(session.clinic.id, params.id);

  if (adelanto) {
    await registrarMovimientoDelPaciente({
      clinicId: session.clinic.id,
      userId: session.user.id,
      patientId: existing.patientId,
      entityType: "appointment",
      entityId: params.id,
      action: "update",
      texto: textoCita.adelantadaAHoy(adelanto.antes.startsAt, adelanto.despues.startsAt, zona),
      campos: Object.keys(adelanto.datos),
      cambios: {
        startsAt: { before: adelanto.antes.startsAt, after: adelanto.despues.startsAt },
        endsAt: { before: adelanto.antes.endsAt, after: adelanto.despues.endsAt },
        ...(adelanto.sinSillon ? { resourceId: { before: existing.resourceId, after: null } } : {}),
      },
      req,
    });
    // Google Calendar: el evento se mueve a hoy. No lanza y no alarga la respuesta.
    await sincronizarCitaEnSegundoPlano(session.clinic.id, params.id);
  }

  // ws1-t12 — la llegada del paciente queda en sus movimientos.
  await registrarMovimientoDelPaciente({
    clinicId: session.clinic.id,
    userId: session.user.id,
    patientId: existing.patientId,
    entityType: "appointment",
    entityId: params.id,
    action: "update",
    // Con adelanto, la cita ya es de hoy: nombrarla por su fecha vieja se leía como si siguiera allí.
    texto: textoCita.estado(adelanto ? adelanto.despues.startsAt : existing.startsAt, existing.status, "CHECKED_IN", zona),
    campos: doctorAsignado ? ["status", "doctorId"] : ["status"],
    cambios: {
      status: { before: existing.status, after: "CHECKED_IN" },
      ...(doctorAsignado ? { doctorId: { before: existing.doctorId, after: doctorAsignado } } : {}),
    },
    req,
  });

  revalidateAfter("appointments");
  revalidatePatientProfile(existing.patientId);
  return NextResponse.json({
    ok: true,
    status: "CHECKED_IN",
    checkedInAt: now.toISOString(),
    minutesWaiting: 0,
    doctorId: doctorAsignado ?? existing.doctorId,
    adelantada: adelanto ? adelantoParaRespuesta(adelanto) : null,
  });
}
