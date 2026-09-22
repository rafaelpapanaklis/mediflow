// GET /api/paciente/appointments/[id]/slots?date=YYYY-MM-DD   (WS1-T5)
//
// Horarios disponibles para REAGENDAR una cita del paciente autenticado
// (portal). Reutiliza la lógica del booking público pero scoped a la cita.
//
// CONTRATO:
//   - Guard: getPatientPortalContext() (src/lib/patient-portal/guard.ts). La cita
//     debe pertenecer a un link del paciente (l.patientId === appt.patientId &&
//     l.clinicId === appt.clinicId) → 404 si no.
//   - Cita en CHANGEABLE_STATUSES → si no, 422 { error: "not_changeable" }.
//   - Ventana mínima: canPatientChange(appt.startsAt, clinic.patientChangesMinHours)
//     → si no, 422 { error: "window", minHours }.
//   - date obligatorio YYYY-MM-DD y no en el pasado → 400 si inválido.
//   - 200: { date: string; timezone: string; durationMin: number; slots: string[] }
//     slots = horarios "HH:mm" LIBRES para el doctor de la cita ese día:
//       · respeta ClinicSchedule (día habilitado, openTime/closeTime),
//       · cada candidato debe tener libre la duración ORIGINAL de la cita
//         (endsAt - startsAt) completa (cargar las citas del día una sola vez
//         y filtrar en memoria, sin N queries),
//       · excluye la propia cita de los conflictos,
//       · si date = hoy (en el timezone de la clínica), filtra slots ya pasados.
//   - export const dynamic = "force-dynamic". Multi-tenant estricto: todo por
//     appt.clinicId verificado contra los links.
//   - Imports compartidos: "@/lib/appointment-change/slots",
//     tzLocalToUtc/todayInTz de "@/lib/agenda/time-utils".

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  CHANGEABLE_STATUSES,
  buildDaySlots,
  canPatientChange,
} from "@/lib/appointment-change/slots";
import { tzLocalToUtc, todayInTz } from "@/lib/agenda/time-utils";
import { bloqueaEsteSlot } from "@/lib/agenda-bloqueos/core";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import { doctorNoAtiendeSlot } from "@/lib/horario-doctor/core";
import { leerHorariosDeDoctores } from "@/lib/horario-doctor/consulta.server";
import { sinApartadoVencido } from "@/lib/agenda/apartado";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  const dateStr = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      doctorId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      clinic: {
        select: {
          timezone: true,
          patientChangesMinHours: true,
          schedules: {
            select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
          },
        },
      },
    },
  });

  // Multi-tenant: la cita debe pertenecer a un link (patientId + clinicId) de
  // la cuenta de la sesión. Si no, 404 (sin revelar existencia).
  const owned =
    appt !== null &&
    ctx.links.some((l) => l.patientId === appt.patientId && l.clinicId === appt.clinicId);
  if (!appt || !owned) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!CHANGEABLE_STATUSES.includes(appt.status)) {
    return NextResponse.json({ error: "not_changeable" }, { status: 422 });
  }

  const minHours = appt.clinic.patientChangesMinHours ?? 24;
  if (!canPatientChange(appt.startsAt, minHours)) {
    return NextResponse.json({ error: "window", minHours }, { status: 422 });
  }

  const timezone = appt.clinic.timezone;
  const todayISO = todayInTz(timezone);
  // No en el pasado, comparado en el timezone de la clínica (strings YYYY-MM-DD).
  if (dateStr < todayISO) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  // Duración ORIGINAL de la cita: cada candidato debe tenerla libre completa.
  const durationMin = Math.max(
    1,
    Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000),
  );

  // Día de la semana del calendario (independiente de timezone): 0=Lun..6=Dom.
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const scheduleDay = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
  const daySchedule = appt.clinic.schedules.find((s) => s.dayOfWeek === scheduleDay);

  if (!daySchedule || !daySchedule.enabled) {
    return NextResponse.json({ date: dateStr, timezone, durationMin, slots: [] });
  }

  // Citas del doctor ese día en UNA sola query (rango del día en el timezone
  // de la clínica, overlap para atrapar también citas que cruzan medianoche).
  const dayStartUtc = tzLocalToUtc(dateStr, 0, 0, timezone);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 86_400_000);
  const [busy, bloqueos, horarios] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: appt.clinicId,
        doctorId: appt.doctorId,
        id: { not: appt.id }, // excluye la propia cita
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: dayEndUtc },
        endsAt: { gt: dayStartUtc },
        // WS1-T5 — una cita apartada cuyo anticipo venció ya no ocupa el hueco.
        AND: [sinApartadoVencido()],
      },
      select: { startsAt: true, endsAt: true },
    }),
    // WS1-T2 — los bloqueos del día de DESTINO. Lo que se filtra es a dónde se
    // puede mover la cita; que la cita actual esté dentro de un bloqueo (el día
    // se cerró después de agendarla) no la ata: moverla FUERA es justo lo que
    // hay que dejar hacer.
    leerBloqueosDelRango(appt.clinicId, dayStartUtc, dayEndUtc, {
      doctorIds: [appt.doctorId],
    }),
    // WS1-T2 · horario — el horario propio del doctor de la cita, si lo tiene.
    // Como con el bloqueo, se filtra el DESTINO: que la cita actual haya
    // quedado fuera de su horario no impide moverla.
    leerHorariosDeDoctores(appt.clinicId, { doctorIds: [appt.doctorId] }),
  ]);

  const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
  const closeMins = closeH * 60 + closeM;
  const isToday = dateStr === todayISO;
  const nowMs = Date.now();

  const slots: string[] = [];
  for (const hhmm of buildDaySlots(daySchedule.openTime, daySchedule.closeTime, 30)) {
    const [h, mn] = hhmm.split(":").map(Number);
    // La duración original completa debe caber antes del cierre.
    if (h * 60 + mn + durationMin > closeMins) continue;

    const slotStart = tzLocalToUtc(dateStr, h, mn, timezone);
    // Hoy (en tz de la clínica): descarta horas ya pasadas.
    if (isToday && slotStart.getTime() <= nowMs) continue;

    const slotEndMs = slotStart.getTime() + durationMin * 60_000;
    const taken = busy.some(
      (b) => b.startsAt.getTime() < slotEndMs && b.endsAt.getTime() > slotStart.getTime(),
    );
    if (taken) continue;
    // WS1-T2 — y sin bloqueo encima.
    if (bloqueaEsteSlot(bloqueos, slotStart, durationMin, appt.doctorId)) continue;
    // WS1-T2 · horario — y dentro del horario del doctor.
    if (doctorNoAtiendeSlot(horarios, slotStart, durationMin, appt.doctorId, timezone)) continue;
    slots.push(hhmm);
  }

  return NextResponse.json({ date: dateStr, timezone, durationMin, slots });
}
