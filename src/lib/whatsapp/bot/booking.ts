import { prisma } from "@/lib/prisma";
import { todayInTz } from "@/lib/agenda/time-utils";
import {
  createBotAppointment,
  getAvailableSlots,
  getClinicTimezone,
  getUpcomingAppointmentsForPatient,
  listBookableDoctors,
  listBookableServices,
  rescheduleBotAppointment,
  type CreateErrorCode,
  type RescheduleErrorCode,
} from "@/lib/agenda/bot-booking-service";
import {
  findOrCreateWhatsAppPatient,
  formatDateHuman,
  formatTimeHuman,
  isAffirmative,
  isCancelWord,
  isNegative,
  parseChoiceIndex,
  parseDateInput,
  parseTimeInput,
  toISODate,
} from "./booking-helpers";
import { BotIntent } from "./types";
import type { BotJson, BotTurnInput, BotTurnResult, HandleBookingTurn } from "./types";

/**
 * T4 — flujo de agendar / reagendar multi-turno del bot de WhatsApp.
 *
 * El motor (runBotTurn) llama aquí en dos casos: (1) primer turno, cuando el
 * texto dispara detectBookingIntent; (2) turnos siguientes, cuando botState
 * indica un flujo de agenda en progreso (ver isBookingInProgress, que engine.ts
 * usa para no caer a la IA libre). Todo el estado se persiste en
 * InboxThread.botState vía el newBotState que devolvemos. Multi-tenant: cada
 * lectura/escritura va scopeada por input.clinicId.
 */

type FlowMode = "create" | "reschedule";

type BookingStep =
  | "service"
  | "doctor"
  | "date"
  | "slot"
  | "name"
  | "confirm"
  | "select_appt";

interface BookingOption {
  id: string;
  label: string;
}

interface BookingState {
  flow: "booking";
  mode: FlowMode;
  step: BookingStep;
  serviceId?: string | null;
  serviceName?: string;
  durationMin?: number;
  doctorId?: string;
  doctorName?: string;
  dateISO?: string;
  time?: string;
  patientId?: string;
  apptId?: string;
  options?: BookingOption[];
  slots?: string[];
}

const MAX_SLOTS_SHOWN = 12;

/** ¿botState representa un flujo de agenda en progreso? Lo consume engine.ts. */
export function isBookingInProgress(state: BotJson | null | undefined): boolean {
  return (
    !!state &&
    typeof state === "object" &&
    !Array.isArray(state) &&
    (state as { flow?: unknown }).flow === "booking"
  );
}

export const handleBookingTurn: HandleBookingTurn = async (input, _config) => {
  const text = input.incomingText.trim();
  const state = readState(input.botState);

  // Cancelar en cualquier punto del flujo.
  if (state && isCancelWord(text)) {
    return done("Listo, cancelé la solicitud. Si necesitas algo más, aquí estoy. 🙂", state.mode);
  }

  if (!state) {
    return detectMode(text) === "reschedule" ? startReschedule(input) : startCreate(input);
  }

  switch (state.step) {
    case "service":
      return stepService(input, state);
    case "doctor":
      return stepDoctor(input, state);
    case "date":
      return stepDate(input, state);
    case "slot":
      return stepSlot(input, state);
    case "name":
      return stepName(input, state);
    case "confirm":
      return stepConfirm(input, state);
    case "select_appt":
      return stepSelectAppt(input, state);
    default:
      return null;
  }
};

// ── Helpers de resultado ────────────────────────────────────────────────────

function intentFor(mode: FlowMode): BotIntent {
  return mode === "reschedule" ? BotIntent.RESCHEDULE : BotIntent.BOOK_APPOINTMENT;
}

function step(reply: string, mode: FlowMode, state: BookingState): BotTurnResult {
  return { reply, intent: intentFor(mode), newBotState: state as unknown as BotJson };
}

function done(reply: string, mode: FlowMode): BotTurnResult {
  return { reply, intent: intentFor(mode), newBotState: null };
}

function readState(raw: BotJson | null | undefined): BookingState | null {
  if (!isBookingInProgress(raw)) return null;
  return raw as unknown as BookingState;
}

function detectMode(text: string): FlowMode {
  const n = text.toLowerCase();
  if (/(reagendar|reprogramar|cambiar (de|la|mi) cita|mover (la|mi) cita)/.test(n)) {
    return "reschedule";
  }
  return "create";
}

function numberedList(options: BookingOption[]): string {
  return options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
}

function askDateText(state: BookingState): string {
  const svc = state.serviceName ? ` para *${state.serviceName}*` : "";
  return `¿Para qué fecha te gustaría la cita${svc}? Puedes escribir "mañana" o una fecha como 2026-06-12.`;
}

async function resolvePhone(input: BotTurnInput): Promise<string | null> {
  if (input.patient?.phone) return input.patient.phone;
  const thread = await prisma.inboxThread.findFirst({
    where: { id: input.threadId, clinicId: input.clinicId },
    select: { externalId: true },
  });
  return thread?.externalId ?? null;
}

// ── Arranque de flujos ──────────────────────────────────────────────────────

async function startCreate(input: BotTurnInput): Promise<BotTurnResult> {
  const services = await listBookableServices(input.clinicId);
  const state: BookingState = {
    flow: "booking",
    mode: "create",
    step: "service",
    patientId: input.patient?.id ?? undefined,
  };

  if (services.length === 0) {
    state.serviceId = null;
    state.serviceName = "Consulta general";
    state.durationMin = 0;
    return advanceToDoctorOrDate(input, state);
  }

  const options: BookingOption[] = services.map((s) => ({
    id: s.id,
    label: s.duration ? `${s.name} (${s.duration} min)` : s.name,
  }));
  state.options = options;
  return step(
    `¡Con gusto te agendo! 🦷\n¿Qué servicio necesitas? Responde con el número:\n${numberedList(options)}`,
    "create",
    state,
  );
}

async function startReschedule(input: BotTurnInput): Promise<BotTurnResult> {
  const patientId = input.patient?.id;
  if (!patientId) {
    return done(
      'No encontré tu expediente con este número. Si quieres una *nueva* cita, escribe "agendar".',
      "reschedule",
    );
  }

  const appts = await getUpcomingAppointmentsForPatient(input.clinicId, patientId);
  if (appts.length === 0) {
    return done("No encuentro citas próximas a tu nombre. ¿Deseas *agendar* una nueva?", "reschedule");
  }

  const tz = await getClinicTimezone(input.clinicId);
  if (appts.length === 1) {
    const a = appts[0];
    const state: BookingState = {
      flow: "booking",
      mode: "reschedule",
      step: "date",
      apptId: a.id,
      patientId,
      doctorId: a.doctorId,
      doctorName: a.doctor ? `${a.doctor.firstName} ${a.doctor.lastName}`.trim() : undefined,
      durationMin: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
      serviceName: a.type,
    };
    const actual = `${formatDateHuman(toISODate(a.startsAt, tz), tz)} a las ${formatTimeHuman(a.startsAt, tz)}`;
    return step(`Tu cita actual es el ${actual}.\n${askDateText(state)}`, "reschedule", state);
  }

  const options: BookingOption[] = appts.map((a) => ({
    id: a.id,
    label: `${formatDateHuman(toISODate(a.startsAt, tz), tz)} a las ${formatTimeHuman(a.startsAt, tz)}${a.type ? ` (${a.type})` : ""}`,
  }));
  const state: BookingState = {
    flow: "booking",
    mode: "reschedule",
    step: "select_appt",
    patientId,
    options,
  };
  return step(`¿Cuál cita deseas reagendar? Responde con el número:\n${numberedList(options)}`, "reschedule", state);
}

async function advanceToDoctorOrDate(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const doctors = await listBookableDoctors(input.clinicId);
  if (doctors.length === 0) {
    return done("Por ahora no hay profesionales disponibles para agendar. Te comunico con el consultorio.", state.mode);
  }
  if (doctors.length === 1) {
    state.doctorId = doctors[0].id;
    state.doctorName = `${doctors[0].firstName} ${doctors[0].lastName}`.trim();
    state.step = "date";
    return step(askDateText(state), state.mode, state);
  }
  const options: BookingOption[] = doctors.map((d) => ({
    id: d.id,
    label: `${d.firstName} ${d.lastName}`.trim(),
  }));
  state.step = "doctor";
  state.options = options;
  return step(`¿Con qué profesional te gustaría? Responde con el número:\n${numberedList(options)}`, state.mode, state);
}

// ── Pasos ───────────────────────────────────────────────────────────────────

async function stepService(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return step(`No te entendí. Responde con el número del servicio:\n${numberedList(options)}`, state.mode, state);
  }
  const chosen = options[idx];
  const svc = await prisma.procedureCatalog.findFirst({
    where: { id: chosen.id, clinicId: input.clinicId, isActive: true },
    select: { name: true, duration: true },
  });
  state.serviceId = chosen.id;
  state.serviceName = svc?.name ?? chosen.label;
  state.durationMin = svc?.duration ?? 0;
  state.options = undefined;
  return advanceToDoctorOrDate(input, state);
}

async function stepDoctor(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return step(`Responde con el número del profesional:\n${numberedList(options)}`, state.mode, state);
  }
  state.doctorId = options[idx].id;
  state.doctorName = options[idx].label;
  state.options = undefined;
  state.step = "date";
  return step(askDateText(state), state.mode, state);
}

async function stepDate(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const tz = await getClinicTimezone(input.clinicId);
  const dateISO = parseDateInput(input.incomingText, tz);
  if (!dateISO) {
    return step('No reconocí la fecha. Escribe algo como "mañana" o "2026-06-12".', state.mode, state);
  }
  if (dateISO < todayInTz(tz)) {
    return step('Esa fecha ya pasó. Indícame una fecha futura (por ejemplo "mañana").', state.mode, state);
  }
  state.dateISO = dateISO;
  return presentSlots(input, state, tz);
}

async function presentSlots(
  input: BotTurnInput,
  state: BookingState,
  tz: string,
  note?: string,
): Promise<BotTurnResult> {
  if (!state.doctorId || !state.dateISO) {
    return done("Algo salió mal con tu solicitud. Intentémoslo de nuevo más tarde.", state.mode);
  }
  const res = await getAvailableSlots({
    clinicId: input.clinicId,
    doctorId: state.doctorId,
    dateISO: state.dateISO,
    durationMin: state.durationMin ?? 0,
  });
  const human = formatDateHuman(state.dateISO, tz);
  const prefix = note ? `${note}\n` : "";

  if (res.closed) {
    state.step = "date";
    return step(`${prefix}Ese día (${human}) no hay atención. ¿Qué otra fecha te acomoda?`, state.mode, state);
  }
  if (res.slots.length === 0) {
    state.step = "date";
    return step(`${prefix}No quedan horarios disponibles el ${human}. ¿Quieres probar otra fecha?`, state.mode, state);
  }

  const shown = res.slots.slice(0, MAX_SLOTS_SHOWN);
  const options: BookingOption[] = shown.map((s) => ({ id: s, label: s }));
  state.options = options;
  state.slots = res.slots.slice(0, 40);
  state.step = "slot";
  const extra =
    res.slots.length > shown.length ? "\n(También puedes escribir otra hora disponible, por ejemplo 16:30.)" : "";
  return step(
    `${prefix}Horarios disponibles el ${human} con ${state.doctorName ?? "el profesional"}:\n${numberedList(options)}${extra}\nResponde con el número.`,
    state.mode,
    state,
  );
}

async function stepSlot(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const options = state.options ?? [];
  let time: string | null = null;
  // Si el texto parece una hora, parséala primero (evita que "9:30" se tome
  // como la opción #9). Si no, trátalo como número de la lista.
  if (/\d\s*:\s*\d|\b\d{1,2}\s*(am|pm)\b/i.test(input.incomingText)) {
    const typed = parseTimeInput(input.incomingText);
    if (typed && (state.slots ?? []).includes(typed)) {
      time = typed;
    } else {
      return step(`Esa hora no está disponible. Elige una de la lista por su número:\n${numberedList(options)}`, state.mode, state);
    }
  } else {
    const idx = parseChoiceIndex(input.incomingText, options.length);
    if (idx !== null) time = options[idx].id;
  }
  if (!time) {
    return step(`Elige un horario por su número (o escribe una hora disponible, ej. 16:30):\n${numberedList(options)}`, state.mode, state);
  }

  state.time = time;
  state.options = undefined;
  state.slots = undefined;

  if (state.mode === "create" && !state.patientId) {
    state.step = "name";
    return step("¿A nombre de quién registro la cita? Escríbeme tu *nombre y apellido*.", state.mode, state);
  }

  state.step = "confirm";
  return step(confirmText(state, await getClinicTimezone(input.clinicId)), state.mode, state);
}

async function stepName(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const name = input.incomingText.trim().replace(/\s+/g, " ");
  if (name.length < 2 || /^\d+$/.test(name)) {
    return step("Necesito tu nombre para registrar la cita. Escríbeme tu nombre y apellido, por favor.", state.mode, state);
  }
  const phone = await resolvePhone(input);
  if (!phone) {
    return done("No pude identificar tu número para crear el registro. Te comunico con el consultorio.", state.mode);
  }
  const patient = await findOrCreateWhatsAppPatient(input.clinicId, phone, name);
  if (!patient) {
    return done("Tuve un problema al crear tu registro. Intenta más tarde o llama al consultorio.", state.mode);
  }
  state.patientId = patient.id;
  state.step = "confirm";
  return step(confirmText(state, await getClinicTimezone(input.clinicId)), state.mode, state);
}

function confirmText(state: BookingState, tz: string): string {
  const human = state.dateISO ? formatDateHuman(state.dateISO, tz) : "";
  const lines: string[] = [
    state.mode === "reschedule" ? "Confirmo el cambio de tu cita:" : "Confirmo tu cita:",
    `📅 ${human} a las ${state.time}`,
  ];
  if (state.serviceName) lines.push(`🦷 ${state.serviceName}`);
  if (state.doctorName) lines.push(`👩‍⚕️ ${state.doctorName}`);
  lines.push("", "¿Confirmas? Responde *sí* o *no*.");
  return lines.join("\n");
}

async function stepConfirm(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const t = input.incomingText.trim();
  const tz = await getClinicTimezone(input.clinicId);

  if (!isAffirmative(t)) {
    if (isNegative(t)) {
      state.step = "slot";
      return presentSlots(input, state, tz, "De acuerdo, elijamos otro horario.");
    }
    return step("¿Confirmas la cita? Responde *sí* para agendar o *no* para elegir otro horario.", state.mode, state);
  }
  if (!state.dateISO || !state.time) {
    return done("Faltan datos de la cita. Empecemos de nuevo cuando gustes.", state.mode);
  }

  if (state.mode === "reschedule") {
    if (!state.apptId) return done("No encuentro la cita a reagendar. Intenta de nuevo.", state.mode);
    const r = await rescheduleBotAppointment({
      clinicId: input.clinicId,
      appointmentId: state.apptId,
      dateISO: state.dateISO,
      time: state.time,
    });
    if (!r.ok) return rescheduleError(r.error ?? "failed", input, state, tz);
    return done(
      `¡Listo! Tu cita quedó reagendada para el ${formatDateHuman(state.dateISO, tz)} a las ${state.time}. El consultorio la confirmará en breve. ✅`,
      state.mode,
    );
  }

  if (!state.patientId || !state.doctorId) {
    return done("Faltan datos para crear la cita. Intenta de nuevo.", state.mode);
  }
  const c = await createBotAppointment({
    clinicId: input.clinicId,
    patientId: state.patientId,
    doctorId: state.doctorId,
    dateISO: state.dateISO,
    time: state.time,
    durationMin: state.durationMin ?? 0,
    reason: state.serviceName ?? null,
  });
  if (!c.ok) return createError(c.error ?? "failed", input, state, tz);
  return done(
    `¡Listo! Registré tu cita para el ${formatDateHuman(state.dateISO, tz)} a las ${state.time}${state.doctorName ? ` con ${state.doctorName}` : ""}. El consultorio la confirmará en breve. ✅`,
    state.mode,
  );
}

async function stepSelectAppt(input: BotTurnInput, state: BookingState): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return step(`Responde con el número de la cita:\n${numberedList(options)}`, state.mode, state);
  }
  const a = await prisma.appointment.findFirst({
    where: { id: options[idx].id, clinicId: input.clinicId },
    select: {
      id: true,
      doctorId: true,
      startsAt: true,
      endsAt: true,
      type: true,
      doctor: { select: { firstName: true, lastName: true } },
    },
  });
  if (!a) return done("No encuentro esa cita. Intenta de nuevo.", state.mode);

  state.apptId = a.id;
  state.doctorId = a.doctorId;
  state.doctorName = a.doctor ? `${a.doctor.firstName} ${a.doctor.lastName}`.trim() : undefined;
  state.durationMin = Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
  state.serviceName = a.type;
  state.options = undefined;
  state.step = "date";
  return step(askDateText(state), state.mode, state);
}

// ── Manejo de errores del servicio ──────────────────────────────────────────

function createError(
  error: CreateErrorCode,
  input: BotTurnInput,
  state: BookingState,
  tz: string,
): Promise<BotTurnResult> | BotTurnResult {
  if (error === "overlap") {
    state.step = "slot";
    return presentSlots(input, state, tz, "Ese horario se acaba de ocupar. 😅");
  }
  if (error === "outside_hours") {
    state.step = "date";
    return step("Ese horario quedó fuera del horario de atención. Elige otra fecha, por favor.", state.mode, state);
  }
  return done("No pude registrar la cita ahora. Intenta más tarde o llama al consultorio.", state.mode);
}

function rescheduleError(
  error: RescheduleErrorCode,
  input: BotTurnInput,
  state: BookingState,
  tz: string,
): Promise<BotTurnResult> | BotTurnResult {
  if (error === "overlap") {
    state.step = "slot";
    return presentSlots(input, state, tz, "Ese horario se acaba de ocupar. 😅");
  }
  if (error === "outside_hours") {
    state.step = "date";
    return step("Ese horario quedó fuera del horario de atención. Elige otra fecha, por favor.", state.mode, state);
  }
  if (error === "not_found") {
    return done('Ya no encuentro esa cita. Si necesitas, escribe "agendar" para una nueva.', state.mode);
  }
  return done("No pude reagendar la cita ahora. Intenta más tarde o llama al consultorio.", state.mode);
}
