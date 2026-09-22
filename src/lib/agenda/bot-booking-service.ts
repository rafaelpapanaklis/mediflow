import "server-only";
import { prisma } from "@/lib/prisma";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { applyReminderReschedule } from "@/lib/reminders/reschedule.server";
import { bloqueaEsteSlot, bloqueaEsteHueco } from "@/lib/agenda-bloqueos/core";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import { doctorNoAtiende, doctorNoAtiendeSlot, ventanaDelDoctor } from "@/lib/horario-doctor/core";
import { leerHorariosDeDoctores } from "@/lib/horario-doctor/consulta.server";

/**
 * Servicio server-side reutilizable para que el bot de WhatsApp agende y
 * reagende citas SIN sesión de staff. Replica las validaciones de
 * POST/PATCH /api/appointments (dentro del horario de la clínica, doctor
 * activo, sin solape) escribiendo Prisma directamente, SIEMPRE scopeado por
 * clinicId (multi-tenant). Las citas creadas quedan source=WHATSAPP y
 * requiresValidation=true para que entren a la cola de validación del staff.
 */

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Espejo de isWithinClinicHours de /api/appointments (no exportada allá). */
function isWithinClinicHours(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  dayStart: number,
  dayEnd: number,
): boolean {
  const s = getTzParts(startsAt, timezone);
  const e = getTzParts(endsAt, timezone);
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;
  if (startMin < dayStart * 60) return false;
  if (endMin > dayEnd * 60) return false;
  return true;
}

/** Detecta el error de solape de la constraint EXCLUDE (SQLSTATE 23P01). */
function isOverlapError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: { code?: string } };
  if (e.code === "P2010") return e.meta?.code === "23P01";
  if (e.code === "23P01") return true;
  return false;
}

/** Pre-check de solape equivalente a la constraint appt_doctor_no_overlap. */
async function hasConflict(
  clinicId: string,
  doctorId: string,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
): Promise<boolean> {
  const conflict = await prisma.appointment.findFirst({
    where: {
      clinicId,
      doctorId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      overrideReason: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return conflict !== null;
}

export interface SlotResult {
  closed: boolean;
  reason?: string;
  slots: string[];
  /**
   * El motivo del bloqueo, cuando lo que cerró el día fue un bloqueo de agenda
   * y no el horario semanal (WS1-T2). El bot puede decir «ese día está cerrado
   * por vacaciones» en vez de un «no hay atención» que no explica nada.
   */
  mensajeBloqueo?: string;
}

/*
 * `reason` de un día cerrado (`closed: true`):
 *  · "closed_day"  — la clínica no abre ese día (ClinicSchedule).
 *  · "blocked"     — un bloqueo de agenda tapa el día entero (WS1-T2).
 *  · "doctor_off"  — la clínica abre pero ESTE doctor no atiende ese día, o su
 *                    horario no coincide con el de la clínica (WS1-T2 · horario).
 */

/**
 * Calcula horarios libres "HH:MM" (hora local de la clínica) para un doctor en
 * una fecha. Respeta a la vez el horario por día (ClinicSchedule) y la ventana
 * de agenda (agendaDayStart/End), descuenta citas que solapan y omite horas ya
 * pasadas. Mantiene los huecos dentro de lo que createBotAppointment aceptará.
 */
export async function getAvailableSlots(params: {
  clinicId: string;
  doctorId: string;
  dateISO: string;
  durationMin: number;
}): Promise<SlotResult> {
  const { clinicId, doctorId, dateISO } = params;
  const [clinic, horarios] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        timezone: true,
        agendaDayStart: true,
        agendaDayEnd: true,
        defaultSlotMinutes: true,
        schedules: {
          select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
        },
      },
    }),
    // WS1-T2 · horario — el horario PROPIO del doctor, si lo tiene. Sin filas
    // el mapa sale vacío y todo lo de abajo se calcula exactamente como antes.
    leerHorariosDeDoctores(clinicId, { doctorIds: [doctorId] }),
  ]);
  if (!clinic) return { closed: true, reason: "clinic_not_found", slots: [] };

  const tz = clinic.timezone;
  const step = clinic.defaultSlotMinutes > 0 ? clinic.defaultSlotMinutes : 30;
  const duration = params.durationMin > 0 ? params.durationMin : step;

  // ClinicSchedule.dayOfWeek: 0=Lunes … 6=Domingo. JS getUTCDay: 0=Domingo.
  const jsDay = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  const scheduleDay = jsDay === 0 ? 6 : jsDay - 1;

  let openMin = clinic.agendaDayStart * 60;
  let closeMin = clinic.agendaDayEnd * 60;
  if (clinic.schedules.length > 0) {
    const day = clinic.schedules.find((d) => d.dayOfWeek === scheduleDay);
    if (!day || !day.enabled) return { closed: true, reason: "closed_day", slots: [] };
    const [oH, oM] = day.openTime.split(":").map(Number);
    const [cH, cM] = day.closeTime.split(":").map(Number);
    openMin = Math.max(openMin, oH * 60 + oM);
    closeMin = Math.min(closeMin, cH * 60 + cM);
  }

  // WS1-T2 · horario — la ventana del día se RECORTA al horario del doctor:
  // abre la clínica ∩ atiende el doctor. Sin horario propio, `ventanaDelDoctor`
  // devuelve la de la clínica tal cual. Si ese día el doctor no atiende (o su
  // horario no se cruza con el de la clínica), el día está cerrado PARA ÉL y
  // se dice así: «no quedan horarios» invitaría a insistir ese mismo día.
  const ventana = ventanaDelDoctor(
    { abre: openMin, cierra: closeMin },
    horarios.get(doctorId),
    scheduleDay,
  );
  if (!ventana) return { closed: true, reason: "doctor_off", slots: [] };
  openMin = ventana.abre;
  closeMin = ventana.cierra;
  if (closeMin - openMin < duration) return { closed: false, slots: [] };

  const dayStartUtc = tzLocalToUtc(dateISO, 0, 0, tz);
  const dayEndUtc = new Date(dayStartUtc.getTime() + DAY_MS);
  const [existing, bloqueos] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId,
        doctorId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: dayEndUtc },
        endsAt: { gt: dayStartUtc },
      },
      select: { startsAt: true, endsAt: true },
    }),
    // WS1-T2 — los bloqueos que tapan el día. Se piden los de ESTE doctor y
    // los de toda la clínica; el `bloqueaEsteSlot` de abajo aplica el alcance.
    leerBloqueosDelRango(clinicId, dayStartUtc, dayEndUtc, { doctorIds: [doctorId] }),
  ]);

  const nowMs = Date.now();
  const slots: string[] = [];
  for (let m = openMin; m + duration <= closeMin; m += step) {
    const h = Math.floor(m / 60);
    const mn = m % 60;
    const inicio = tzLocalToUtc(dateISO, h, mn, tz);
    const startMs = inicio.getTime();
    const endMs = startMs + duration * 60_000;
    if (startMs <= nowMs) continue;
    const overlaps = existing.some(
      (a) => startMs < a.endsAt.getTime() && endMs > a.startsAt.getTime(),
    );
    if (overlaps) continue;
    // WS1-T2 — un hueco bloqueado no se ofrece. Los que quedan SON las
    // alternativas más cercanas fuera del bloqueo: si se cerró la mañana, el
    // bot lista la tarde en vez de contestar que no hay nada.
    if (bloqueaEsteSlot(bloqueos, inicio, duration, doctorId)) continue;
    // WS1-T2 · horario — el mismo criterio que el alta de abajo, hueco a hueco.
    // Con la ventana ya recortada no debería saltar nunca; está para que la
    // oferta y el alta digan SIEMPRE lo mismo aunque alguien toque el bucle.
    if (doctorNoAtiendeSlot(horarios, inicio, duration, doctorId, tz)) continue;
    slots.push(`${pad(h)}:${pad(mn)}`);
  }

  // Si no quedó ni un hueco Y el día entero está bloqueado, se dice POR QUÉ.
  // La diferencia le importa a quien está del otro lado: «no quedan horarios»
  // invita a insistir ese mismo día; «está cerrado por vacaciones» hace que
  // pregunte por otra fecha, que es la conversación que lleva a algún sitio.
  if (slots.length === 0) {
    const tapaTodo = bloqueaEsteHueco(bloqueos, dayStartUtc, dayEndUtc, doctorId);
    if (tapaTodo) {
      return {
        closed: true,
        reason: "blocked",
        slots: [],
        // El motivo, sin decir de QUIÉN es el bloqueo: al paciente del otro
        // lado no le corresponde saber que la doctora está operada.
        mensajeBloqueo: tapaTodo.reason,
      };
    }
  }

  return { closed: false, slots };
}

export type CreateErrorCode =
  | "outside_hours"
  /** WS1-T2 — el hueco está cerrado por un bloqueo de agenda. */
  | "blocked"
  /** WS1-T2 · horario — el doctor no atiende a esa hora (su horario propio). */
  | "doctor_off"
  | "overlap"
  | "doctor_not_found"
  | "patient_not_found"
  | "invalid"
  | "failed";

export interface CreateResult {
  ok: boolean;
  appointmentId?: string;
  error?: CreateErrorCode;
}

/** Crea una cita desde el bot replicando las validaciones de POST /api/appointments. */
export async function createBotAppointment(params: {
  clinicId: string;
  patientId: string;
  doctorId: string;
  dateISO: string;
  time: string;
  durationMin: number;
  reason?: string | null;
}): Promise<CreateResult> {
  const { clinicId, patientId, doctorId, dateISO, time, reason } = params;
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return { ok: false, error: "invalid" };

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true, agendaDayStart: true, agendaDayEnd: true },
  });
  if (!clinic) return { ok: false, error: "invalid" };

  const durationMin = params.durationMin > 0 ? params.durationMin : 30;
  const startsAt = tzLocalToUtc(dateISO, hh, mm, clinic.timezone);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  if (endsAt.getTime() <= startsAt.getTime()) return { ok: false, error: "invalid" };

  if (!isWithinClinicHours(startsAt, endsAt, clinic.timezone, clinic.agendaDayStart, clinic.agendaDayEnd)) {
    return { ok: false, error: "outside_hours" };
  }

  const [patient, doctor] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true } }),
    prisma.user.findFirst({
      where: { id: doctorId, clinicId, role: "DOCTOR", isActive: true },
      select: { id: true },
    }),
  ]);
  if (!patient) return { ok: false, error: "patient_not_found" };
  if (!doctor) return { ok: false, error: "doctor_not_found" };

  if (await hasConflict(clinicId, doctorId, startsAt, endsAt)) return { ok: false, error: "overlap" };

  // WS1-T2 — el candado del ALTA, no solo el de la oferta. Entre que el bot
  // enseña los horarios y el paciente contesta pueden pasar minutos, y en ese
  // rato alguien puede cerrar el día desde el panel. Sin esta comprobación el
  // bot agendaría dentro de un bloqueo recién puesto.
  const bloqueos = await leerBloqueosDelRango(clinicId, startsAt, endsAt, {
    doctorIds: [doctorId],
  });
  if (bloqueaEsteHueco(bloqueos, startsAt, endsAt, doctorId)) {
    return { ok: false, error: "blocked" };
  }

  // WS1-T2 · horario — el candado del ALTA, por lo mismo que el del bloqueo:
  // entre la oferta y el «sí» pueden pasar minutos, y la oferta no es la
  // única forma de llegar aquí (el paciente puede teclear una hora).
  const horarios = await leerHorariosDeDoctores(clinicId, { doctorIds: [doctorId] });
  if (doctorNoAtiende(horarios, startsAt, endsAt, doctorId, clinic.timezone)) {
    return { ok: false, error: "doctor_off" };
  }

  try {
    const created = await prisma.appointment.create({
      data: {
        clinicId,
        patientId,
        doctorId,
        resourceId: null,
        startsAt,
        endsAt,
        status: "SCHEDULED",
        type: reason && reason.trim() ? reason.trim() : "Consulta general",
        mode: "IN_PERSON",
        source: "WHATSAPP",
        requiresValidation: true,
        overrideReason: null,
      },
      select: { id: true },
    });
    return { ok: true, appointmentId: created.id };
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, error: "overlap" };
    console.error("[bot-booking-service] create failed", err);
    return { ok: false, error: "failed" };
  }
}

export type RescheduleErrorCode =
  | "not_found"
  | "outside_hours"
  /** WS1-T2 — el hueco de destino está cerrado por un bloqueo de agenda. */
  | "blocked"
  /** WS1-T2 · horario — el doctor no atiende a la hora de destino. */
  | "doctor_off"
  | "overlap"
  | "invalid"
  | "failed";

export interface RescheduleResult {
  ok: boolean;
  appointmentId?: string;
  error?: RescheduleErrorCode;
}

/** Mueve una cita existente (mismo doctor y duración) replicando PATCH /api/appointments. */
export async function rescheduleBotAppointment(params: {
  clinicId: string;
  appointmentId: string;
  dateISO: string;
  time: string;
}): Promise<RescheduleResult> {
  const { clinicId, appointmentId, dateISO, time } = params;
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return { ok: false, error: "invalid" };

  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    select: { id: true, doctorId: true, startsAt: true, endsAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true, agendaDayStart: true, agendaDayEnd: true },
  });
  if (!clinic) return { ok: false, error: "invalid" };

  const durationMs = existing.endsAt.getTime() - existing.startsAt.getTime();
  const startsAt = tzLocalToUtc(dateISO, hh, mm, clinic.timezone);
  const endsAt = new Date(startsAt.getTime() + (durationMs > 0 ? durationMs : 30 * 60_000));

  if (!isWithinClinicHours(startsAt, endsAt, clinic.timezone, clinic.agendaDayStart, clinic.agendaDayEnd)) {
    return { ok: false, error: "outside_hours" };
  }
  if (await hasConflict(clinicId, existing.doctorId, startsAt, endsAt, existing.id)) {
    return { ok: false, error: "overlap" };
  }

  // WS1-T2 — mover una cita A un hueco bloqueado es lo mismo que crearla ahí.
  // Lo que NO se toca es la cita que YA está dentro de un bloqueo: si alguien
  // cerró el día encima de ella, moverla FUERA es justo lo que hay que dejar
  // hacer, y esta comprobación mira el destino, nunca el origen.
  const bloqueos = await leerBloqueosDelRango(clinicId, startsAt, endsAt, {
    doctorIds: [existing.doctorId],
  });
  if (bloqueaEsteHueco(bloqueos, startsAt, endsAt, existing.doctorId)) {
    return { ok: false, error: "blocked" };
  }

  // WS1-T2 · horario — igual: se mira el DESTINO. Una cita que quedó fuera del
  // horario porque el doctor lo cambió después se puede mover sin estorbo.
  const horarios = await leerHorariosDeDoctores(clinicId, { doctorIds: [existing.doctorId] });
  if (doctorNoAtiende(horarios, startsAt, endsAt, existing.doctorId, clinic.timezone)) {
    return { ok: false, error: "doctor_off" };
  }

  try {
    // M-22: mover la cita y reprogramar sus recordatorios es UNA operación. El
    // mensaje se rendea al ENCOLAR, con la fecha y la hora congeladas dentro
    // del texto: si el update entra y la reprogramación no, al paciente le
    // llega la hora anterior. Antes esto no estaba en transacción.
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: existing.id },
        data: { startsAt, endsAt, status: "SCHEDULED", requiresValidation: true },
      });
      if (existing.startsAt.getTime() !== startsAt.getTime()) {
        await applyReminderReschedule(tx, {
          appointmentId: existing.id,
          clinicId,
          newStartsAt: startsAt,
        });
      }
    });

    return { ok: true, appointmentId: existing.id };
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, error: "overlap" };
    console.error("[bot-booking-service] reschedule failed", err);
    return { ok: false, error: "failed" };
  }
}

export async function getClinicTimezone(clinicId: string): Promise<string> {
  const c = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true },
  });
  return c?.timezone ?? "America/Mexico_City";
}

/** Nombre de la clínica para el mensaje de confirmación del bot. */
export async function getClinicName(clinicId: string): Promise<string> {
  const c = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { name: true },
  });
  return c?.name ?? "el consultorio";
}

export async function listBookableServices(clinicId: string) {
  return prisma.procedureCatalog.findMany({
    where: { clinicId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, duration: true },
    take: 24,
  });
}

export async function listBookableDoctors(clinicId: string) {
  return prisma.user.findMany({
    where: { clinicId, role: "DOCTOR", isActive: true },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true },
  });
}

export async function getUpcomingAppointmentsForPatient(clinicId: string, patientId: string) {
  return prisma.appointment.findMany({
    where: {
      clinicId,
      patientId,
      status: { in: ["PENDING", "SCHEDULED", "CONFIRMED"] },
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: "asc" },
    take: 5,
    select: {
      id: true,
      doctorId: true,
      startsAt: true,
      endsAt: true,
      type: true,
      doctor: { select: { firstName: true, lastName: true } },
    },
  });
}
