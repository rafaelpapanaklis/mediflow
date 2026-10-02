import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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

  const now = new Date();
  // ws1-t8 (decisión 6 de Rafael): llegó hoy el paciente de una cita de un día futuro → la cita se trae a
  // hoy (empieza ahora, misma duración y doctor), sin avisarle de reprogramación. Ver adelantar-cita-a-hoy.ts.
  const zona = await zonaDeClinica(session.clinic.id);
  const adelanto = await prepararAdelantoAHoy({
    clinicId: session.clinic.id,
    cita: existing,
    destino: "CHECKED_IN",
    ahora: now,
    zona: zona ?? session.clinic.timezone ?? "America/Mexico_City",
    userId: session.user.id,
  });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: params.id },
        data: {
          status: "CHECKED_IN",
          checkedInAt: now,
          ...(adelanto?.datos ?? {}),
        },
      });
      if (adelanto) {
        await cancelPendingRemindersForAppointment(tx, {
          appointmentId: params.id,
          clinicId: session.clinic.id,
          reason: MOTIVO_RECORDATORIOS_ADELANTO,
        });
      }
    });
  } catch (err) {
    if (adelanto && isAppointmentOverlapError(err)) {
      return NextResponse.json(
        { error: "invalid_transition", reason: "Otra cita acaba de ocupar esta hora con el mismo doctor o sillón. Intenta de nuevo." },
        { status: 409 },
      );
    }
    throw err;
  }

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
    campos: ["status"],
    cambios: { status: { before: existing.status, after: "CHECKED_IN" } },
    req,
  });

  revalidateAfter("appointments");
  revalidatePatientProfile(existing.patientId);
  return NextResponse.json({
    ok: true,
    status: "CHECKED_IN",
    checkedInAt: now.toISOString(),
    minutesWaiting: 0,
    adelantada: adelanto ? adelantoParaRespuesta(adelanto) : null,
  });
}
