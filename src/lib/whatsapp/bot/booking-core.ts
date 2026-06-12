import { todayInTz } from "@/lib/agenda/time-utils";
import {
  formatDateHuman,
  formatTimeHuman,
  isAffirmative,
  isCancelWord,
  isMenuWord,
  isNegative,
  parseChoiceIndex,
  parseDateInput,
  parseTimeInput,
  toISODate,
} from "./booking-parse";
import { BotIntent } from "./types";
import type { BotConfigDTO, BotJson, BotTurnInput, BotTurnResult } from "./types";
import type {
  CreateErrorCode,
  CreateResult,
  RescheduleErrorCode,
  RescheduleResult,
  SlotResult,
} from "@/lib/agenda/bot-booking-service";

/**
 * T4 — máquina de estados PURA del flujo de agendar / reagendar del bot de
 * WhatsApp. Toda operación con efectos (servicio de agenda + lecturas Prisma) se
 * inyecta vía `BookingDeps`, así este módulo se testea sin BD ni `server-only`.
 * El shell server-side (./booking.ts) cablea las dependencias reales; el motor
 * (engine.ts) lo consume desde ahí.
 *
 * Estado persistido en InboxThread.botState (vía newBotState). Multi-tenant:
 * cada lectura/escritura va scopeada por input.clinicId. Endurecido (T4 cierre):
 *  - Expiración por inactividad (30 min): isBookingInProgress ignora sesiones
 *    viejas para que no se reanude un agendado abandonado.
 *  - 2 respuestas seguidas sin entender → deriva a humano (si la clínica lo
 *    permite); el contador se reinicia con cada respuesta entendida.
 *  - Comando global "menu"/"reiniciar" además de "cancelar"/"salir".
 */

export type FlowMode = "create" | "reschedule";

export type BookingStep =
  | "service"
  | "doctor"
  | "date"
  | "slot"
  | "name"
  | "confirm"
  | "select_appt";

export interface BookingOption {
  id: string;
  label: string;
}

export interface BookingState {
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
  /** Respuestas seguidas sin entender (→ humano a las 2). */
  misses?: number;
  /** Epoch ms del último turno; base de la expiración por inactividad. */
  updatedAt?: number;
  /** Copia de config.fallbackToHuman al iniciar (para decidir el handoff). */
  fallbackToHuman?: boolean;
}

interface UpcomingAppt {
  id: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  type: string;
  doctor: { firstName: string; lastName: string } | null;
}

/** Frontera de efectos del flujo; el shell la cablea con las funciones reales. */
export interface BookingDeps {
  getClinicTimezone(clinicId: string): Promise<string>;
  getClinicName(clinicId: string): Promise<string>;
  listBookableServices(
    clinicId: string,
  ): Promise<Array<{ id: string; name: string; duration: number | null }>>;
  listBookableDoctors(
    clinicId: string,
  ): Promise<Array<{ id: string; firstName: string; lastName: string }>>;
  getAvailableSlots(params: {
    clinicId: string;
    doctorId: string;
    dateISO: string;
    durationMin: number;
  }): Promise<SlotResult>;
  createBotAppointment(params: {
    clinicId: string;
    patientId: string;
    doctorId: string;
    dateISO: string;
    time: string;
    durationMin: number;
    reason?: string | null;
  }): Promise<CreateResult>;
  rescheduleBotAppointment(params: {
    clinicId: string;
    appointmentId: string;
    dateISO: string;
    time: string;
  }): Promise<RescheduleResult>;
  getUpcomingAppointmentsForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<UpcomingAppt[]>;
  findOrCreateWhatsAppPatient(
    clinicId: string,
    phoneRaw: string,
    fullName: string,
  ): Promise<{ id: string } | null>;
  findServiceById(
    clinicId: string,
    id: string,
  ): Promise<{ name: string; duration: number | null } | null>;
  findThreadExternalId(threadId: string, clinicId: string): Promise<string | null>;
  findAppointmentById(id: string, clinicId: string): Promise<UpcomingAppt | null>;
}

const MAX_SLOTS_SHOWN = 12;
const MAX_MISSES = 2;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min de inactividad

/**
 * ¿botState representa un flujo de agenda EN PROGRESO (no expirado)? Lo consume
 * engine.ts para entrar al flujo antes que FAQ/IA. updatedAt ausente ⇒ sesión
 * legacy previa a este campo: se tolera (no expira).
 */
export function isBookingInProgress(state: BotJson | null | undefined): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as { flow?: unknown; updatedAt?: unknown };
  if (s.flow !== "booking") return false;
  if (typeof s.updatedAt === "number" && Date.now() - s.updatedAt > SESSION_TTL_MS) {
    return false;
  }
  return true;
}

export async function runBookingTurn(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps,
): Promise<BotTurnResult | null> {
  const text = input.incomingText.trim();
  const state = readState(input.botState);

  // Comandos globales (solo con un flujo activo).
  if (state && isCancelWord(text)) {
    return done("Listo, cancelé la solicitud. Si necesitas algo más, aquí estoy. 🙂", state.mode);
  }
  if (state && isMenuWord(text)) {
    // "menu"/"reiniciar": empieza de nuevo conservando el tipo de flujo.
    return state.mode === "reschedule"
      ? startReschedule(input, config, deps)
      : startCreate(input, config, deps);
  }

  if (!state) {
    return detectMode(text) === "reschedule"
      ? startReschedule(input, config, deps)
      : startCreate(input, config, deps);
  }

  switch (state.step) {
    case "service":
      return stepService(input, state, deps);
    case "doctor":
      return stepDoctor(input, state, deps);
    case "date":
      return stepDate(input, state, deps);
    case "slot":
      return stepSlot(input, state, deps);
    case "name":
      return stepName(input, state, deps);
    case "confirm":
      return stepConfirm(input, state, deps);
    case "select_appt":
      return stepSelectAppt(input, state, deps);
    default:
      return null;
  }
}

// ── Helpers de resultado ────────────────────────────────────────────────────

function intentFor(mode: FlowMode): BotIntent {
  return mode === "reschedule" ? BotIntent.RESCHEDULE : BotIntent.BOOK_APPOINTMENT;
}

function step(reply: string, mode: FlowMode, state: BookingState): BotTurnResult {
  state.updatedAt = Date.now(); // marca actividad para la expiración por inactividad
  return { reply, intent: intentFor(mode), newBotState: state as unknown as BotJson };
}

function done(reply: string, mode: FlowMode): BotTurnResult {
  return { reply, intent: intentFor(mode), newBotState: null };
}

/**
 * Re-pregunta tras una respuesta no entendida. A las 2 seguidas (MAX_MISSES) y
 * si la clínica permite handoff, deriva a un humano: manda el aviso y LIMPIA la
 * sesión (newBotState null) para que el staff tome el hilo desde el Inbox. El
 * contador se reinicia (state.misses = 0) en cada paso que sí entiende.
 */
function miss(state: BookingState, reply: string): BotTurnResult {
  const misses = (state.misses ?? 0) + 1;
  if (misses >= MAX_MISSES && state.fallbackToHuman !== false) {
    return {
      reply:
        "Creo que será más fácil si te ayuda una persona del equipo. 🙋 Le paso tu mensaje y te responden en breve.",
      intent: BotIntent.HANDOFF,
      handoff: true,
      newBotState: null,
    };
  }
  state.misses = misses;
  return step(reply, state.mode, state);
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

async function resolvePhone(input: BotTurnInput, deps: BookingDeps): Promise<string | null> {
  if (input.patient?.phone) return input.patient.phone;
  return deps.findThreadExternalId(input.threadId, input.clinicId);
}

// ── Arranque de flujos ──────────────────────────────────────────────────────

async function startCreate(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const services = await deps.listBookableServices(input.clinicId);
  const state: BookingState = {
    flow: "booking",
    mode: "create",
    step: "service",
    patientId: input.patient?.id ?? undefined,
    fallbackToHuman: config.fallbackToHuman,
  };

  if (services.length === 0) {
    state.serviceId = null;
    state.serviceName = "Consulta general";
    state.durationMin = 0;
    return advanceToDoctorOrDate(input, state, deps);
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

async function startReschedule(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const patientId = input.patient?.id;
  if (!patientId) {
    return done(
      'No encontré tu expediente con este número. Si quieres una *nueva* cita, escribe "agendar".',
      "reschedule",
    );
  }

  const appts = await deps.getUpcomingAppointmentsForPatient(input.clinicId, patientId);
  if (appts.length === 0) {
    return done("No encuentro citas próximas a tu nombre. ¿Deseas *agendar* una nueva?", "reschedule");
  }

  const tz = await deps.getClinicTimezone(input.clinicId);
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
      fallbackToHuman: config.fallbackToHuman,
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
    fallbackToHuman: config.fallbackToHuman,
  };
  return step(`¿Cuál cita deseas reagendar? Responde con el número:\n${numberedList(options)}`, "reschedule", state);
}

async function advanceToDoctorOrDate(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const doctors = await deps.listBookableDoctors(input.clinicId);
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

async function stepService(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return miss(state, `No te entendí. Responde con el número del servicio:\n${numberedList(options)}`);
  }
  state.misses = 0;
  const chosen = options[idx];
  const svc = await deps.findServiceById(input.clinicId, chosen.id);
  state.serviceId = chosen.id;
  state.serviceName = svc?.name ?? chosen.label;
  state.durationMin = svc?.duration ?? 0;
  state.options = undefined;
  return advanceToDoctorOrDate(input, state, deps);
}

async function stepDoctor(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return miss(state, `Responde con el número del profesional:\n${numberedList(options)}`);
  }
  state.misses = 0;
  state.doctorId = options[idx].id;
  state.doctorName = options[idx].label;
  state.options = undefined;
  state.step = "date";
  return step(askDateText(state), state.mode, state);
}

async function stepDate(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const tz = await deps.getClinicTimezone(input.clinicId);
  const dateISO = parseDateInput(input.incomingText, tz);
  if (!dateISO) {
    return miss(state, 'No reconocí la fecha. Escribe algo como "mañana" o "2026-06-12".');
  }
  if (dateISO < todayInTz(tz)) {
    return miss(state, 'Esa fecha ya pasó. Indícame una fecha futura (por ejemplo "mañana").');
  }
  state.misses = 0;
  state.dateISO = dateISO;
  return presentSlots(input, state, tz, deps);
}

async function presentSlots(
  input: BotTurnInput,
  state: BookingState,
  tz: string,
  deps: BookingDeps,
  note?: string,
): Promise<BotTurnResult> {
  if (!state.doctorId || !state.dateISO) {
    return done("Algo salió mal con tu solicitud. Intentémoslo de nuevo más tarde.", state.mode);
  }
  const res = await deps.getAvailableSlots({
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

async function stepSlot(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  let time: string | null = null;
  // Si el texto parece una hora, parséala primero (evita que "9:30" se tome
  // como la opción #9). Si no, trátalo como número de la lista.
  if (/\d\s*:\s*\d|\b\d{1,2}\s*(am|pm)\b/i.test(input.incomingText)) {
    const typed = parseTimeInput(input.incomingText);
    if (typed && (state.slots ?? []).includes(typed)) {
      time = typed;
    } else {
      return miss(state, `Esa hora no está disponible. Elige una de la lista por su número:\n${numberedList(options)}`);
    }
  } else {
    const idx = parseChoiceIndex(input.incomingText, options.length);
    if (idx !== null) time = options[idx].id;
  }
  if (!time) {
    return miss(state, `Elige un horario por su número (o escribe una hora disponible, ej. 16:30):\n${numberedList(options)}`);
  }

  state.misses = 0;
  state.time = time;
  state.options = undefined;
  state.slots = undefined;

  if (state.mode === "create" && !state.patientId) {
    state.step = "name";
    return step("¿A nombre de quién registro la cita? Escríbeme tu *nombre y apellido*.", state.mode, state);
  }

  state.step = "confirm";
  return step(confirmText(state, await deps.getClinicTimezone(input.clinicId)), state.mode, state);
}

async function stepName(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const name = input.incomingText.trim().replace(/\s+/g, " ");
  if (name.length < 2 || /^\d+$/.test(name)) {
    return miss(state, "Necesito tu nombre para registrar la cita. Escríbeme tu nombre y apellido, por favor.");
  }
  state.misses = 0;
  const phone = await resolvePhone(input, deps);
  if (!phone) {
    return done("No pude identificar tu número para crear el registro. Te comunico con el consultorio.", state.mode);
  }
  const patient = await deps.findOrCreateWhatsAppPatient(input.clinicId, phone, name);
  if (!patient) {
    return done("Tuve un problema al crear tu registro. Intenta más tarde o llama al consultorio.", state.mode);
  }
  state.patientId = patient.id;
  state.step = "confirm";
  return step(confirmText(state, await deps.getClinicTimezone(input.clinicId)), state.mode, state);
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

async function stepConfirm(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const t = input.incomingText.trim();
  const tz = await deps.getClinicTimezone(input.clinicId);

  if (!isAffirmative(t)) {
    if (isNegative(t)) {
      state.misses = 0;
      state.step = "slot";
      return presentSlots(input, state, tz, deps, "De acuerdo, elijamos otro horario.");
    }
    return miss(state, "¿Confirmas la cita? Responde *sí* para agendar o *no* para elegir otro horario.");
  }
  state.misses = 0;
  if (!state.dateISO || !state.time) {
    return done("Faltan datos de la cita. Empecemos de nuevo cuando gustes.", state.mode);
  }

  if (state.mode === "reschedule") {
    if (!state.apptId) return done("No encuentro la cita a reagendar. Intenta de nuevo.", state.mode);
    const r = await deps.rescheduleBotAppointment({
      clinicId: input.clinicId,
      appointmentId: state.apptId,
      dateISO: state.dateISO,
      time: state.time,
    });
    if (!r.ok) return rescheduleError(r.error ?? "failed", input, state, tz, deps);
    const clinicName = await deps.getClinicName(input.clinicId);
    return done(
      `¡Listo! Tu cita quedó reagendada para el ${formatDateHuman(state.dateISO, tz)} a las ${state.time}. ${clinicName} la confirmará en breve. ✅`,
      state.mode,
    );
  }

  if (!state.patientId || !state.doctorId) {
    return done("Faltan datos para crear la cita. Intenta de nuevo.", state.mode);
  }
  const c = await deps.createBotAppointment({
    clinicId: input.clinicId,
    patientId: state.patientId,
    doctorId: state.doctorId,
    dateISO: state.dateISO,
    time: state.time,
    durationMin: state.durationMin ?? 0,
    reason: state.serviceName ?? null,
  });
  if (!c.ok) return createError(c.error ?? "failed", input, state, tz, deps);
  const clinicName = await deps.getClinicName(input.clinicId);
  return done(
    `¡Listo! Registré tu cita para el ${formatDateHuman(state.dateISO, tz)} a las ${state.time}${state.doctorName ? ` con ${state.doctorName}` : ""}. ${clinicName} la confirmará en breve. ✅`,
    state.mode,
  );
}

async function stepSelectAppt(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return miss(state, `Responde con el número de la cita:\n${numberedList(options)}`);
  }
  state.misses = 0;
  const a = await deps.findAppointmentById(options[idx].id, input.clinicId);
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
  deps: BookingDeps,
): Promise<BotTurnResult> | BotTurnResult {
  if (error === "overlap") {
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "Ese horario se acaba de ocupar. 😅");
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
  deps: BookingDeps,
): Promise<BotTurnResult> | BotTurnResult {
  if (error === "overlap") {
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "Ese horario se acaba de ocupar. 😅");
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
