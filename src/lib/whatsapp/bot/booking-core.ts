import { todayInTz } from "@/lib/agenda/time-utils";
import {
  detectaInteresOrtodoncia,
  addDaysISO,
  esCancelacionClara,
  fechaDentroDelMesPedido,
  foldAccents,
  formatDateHuman,
  formatTimeHuman,
  interpretarEleccionDeHorario,
  isMenuWord,
  mediadosDeMes,
  mesPedidoSinDia,
  nombreDeMes,
  parseChoiceIndex,
  parseDateInput,
  parseFechaConPalabras,
  respuestaSiNo,
  toISODate,
  turnoPedido,
} from "./booking-parse";
import { BotIntent } from "./types";
import { textoAvisoAnticipo, textoLinkDePago } from "@/lib/anticipos/core";
import { interactivoParaOpciones, REC_BOTON, type MensajeInteractivo } from "../interactivo";
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
  | "service_kind"
  | "service"
  | "doctor"
  | "date"
  | "slot"
  | "name"
  | "confirm"
  | "select_appt"
  /** ws1-t1 (#12) — número compartido: ¿para quién es la cita? */
  | "who";

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
  /**
   * WS1-T5 — el anticipo que se ANUNCIA en el «¿confirmas?». Solo es texto: el
   * monto que se cobra lo vuelve a calcular el servidor al crear el link, y
   * nada de lo que haya aquí llega a Mercado Pago.
   */
  anticipo?: { monto: number; minutos: number } | null;
  /**
   * ws1-t8 — el control de ortodoncia del caso activo del paciente, guardado mientras
   * elige entre ese control y otro servicio (paso `service_kind`).
   */
  ortoCaso?: { label: string; durationMin: number; treatingDoctorId: string | null } | null;
  /**
   * ws1-t1 — la fecha que el paciente ya dijo al pedir la cita («quiero cita
   * el lunes en la tarde»). Se usa en vez de preguntarla y se consume una vez.
   */
  fechaPedida?: string;
  /** ws1-t1 — «en la tarde» / «en la mañana»: se enseñan primero esos huecos. */
  turno?: "manana" | "tarde";
  /**
   * ws1-t5 — «el próximo mes» sin día ("YYYY-MM"): el bot pregunta qué día de
   * ese mes, y «el 10» se lee dentro de ESE mes (no el próximo 10).
   */
  mesPedido?: string;
  /**
   * ws1-t5 — «a mediados de marzo»: si `dateISO` (el 12) no tiene lugar, la
   * búsqueda hacia adelante llega hasta este día (el 18) en vez de los
   * DIAS_A_BUSCAR_HACIA_ADELANTE. Se usa una vez.
   */
  buscarHasta?: string;
  /**
   * ws1-t1 (#12) — en un número compartido eligió «otra persona»: al pedir su
   * nombre se crea un paciente NUEVO en vez de reutilizar al primero del número.
   */
  pacienteNuevo?: boolean;
}

/** Ids de las dos opciones del paso `service_kind`. */
export const OPCION_CONTROL_ORTO = "orto_control";
export const OPCION_OTRO_SERVICIO = "otro_servicio";
/** ws1-t1 (#12) — opción «otra persona» del paso `who`. */
export const OPCION_OTRA_PERSONA = "otra_persona";

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
    /** WS1-T5 — para el precio del anticipo (catálogo) y el teléfono del aviso. */
    serviceId?: string | null;
    threadId?: string | null;
  }): Promise<CreateResult>;
  /**
   * WS1-T5 — ¿esta clínica pide anticipo para este servicio? Cuánto y en
   * cuánto tiempo, para decirlo ANTES de que el paciente confirme. Opcional:
   * sin él (o si devuelve null) el flujo es exactamente el de siempre.
   */
  anticipoParaAnunciar?(
    clinicId: string,
    serviceId: string | null | undefined,
  ): Promise<{ monto: number; minutos: number } | null>;
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
    /** ws1-t1 (#12) — «otra persona» en un número compartido: crear aunque el número ya exista. */
    opciones?: { crearNuevo?: boolean },
  ): Promise<{ id: string } | null>;
  /**
   * ws1-t1 (#12) — los pacientes ACTIVOS de esta clínica que tienen este
   * número. Con más de uno, el bot pregunta para quién es la cita antes de
   * agendar o reagendar. Opcional: sin él, el flujo es el de siempre.
   */
  listPhoneOwners?(
    clinicId: string,
    phone: string,
  ): Promise<Array<{ id: string; firstName: string; lastName: string }>>;
  findServiceById(
    clinicId: string,
    id: string,
  ): Promise<{ name: string; duration: number | null } | null>;
  findThreadExternalId(threadId: string, clinicId: string): Promise<string | null>;
  findAppointmentById(id: string, clinicId: string): Promise<UpcomingAppt | null>;
  /**
   * ws1-t1 (Ortodoncia conectada al bot) — ¿este paciente tiene un caso de
   * ortodoncia activo en esta sede (para ofrecerle su Control directo, con su
   * doctor tratante), o el módulo tiene un tipo "Valoración de ortodoncia"
   * que ofrecer a un prospecto que la mencionó? Opcional: sin este dep (o con
   * uno que siempre devuelva "nada que ofrecer") el flujo de agendar es
   * exactamente el de siempre — así los dobles de test existentes, que no lo
   * traen, no tienen que cambiar.
   */
  getOrthoBookingContext?(
    clinicId: string,
    patientId: string | null,
  ): Promise<{
    casoActivo: {
      treatmentPlanId: string;
      treatingDoctorId: string | null;
      label: string;
      durationMin: number;
    } | null;
    valoracion: { label: string; durationMin: number } | null;
  }>;
}

// ws1-t3 — 10 y no 12: es el tope de filas de una lista de WhatsApp. Así la
// lista y el texto numerado enseñan lo mismo (escribir otra hora libre sigue
// valiendo: `state.slots` guarda hasta 40).
const MAX_SLOTS_SHOWN = 10;
const MAX_MISSES = 2;
/**
 * ws1-t5 — si el día que pidió el paciente no tiene lugar, cuántos días
 * siguientes se revisan (uno por uno, como la consulta de ese día) para
 * ofrecerle el más cercano con lugar. Decisión para Rafael (reporte ws1-t5).
 */
const DIAS_A_BUSCAR_HACIA_ADELANTE = 7;
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
  // ws1-t3 — un toque sobre las opciones de ESTE paso no es una orden escrita:
  // su título («Otra persona», un servicio…) no pasa por los comandos globales.
  const tocoEstePaso = !!state && esEleccionDelPaso(input, state.step);

  // Comandos globales (solo con un flujo activo). ws1-t1 (#16): cancelar exige
  // que el mensaje ENTERO sea la orden; «ya no me duele, ¿qué día puedo ir?»
  // sigue el agendado en vez de tirarlo.
  if (state && !tocoEstePaso && esCancelacionClara(text)) {
    return done("Listo, cancelé la solicitud. Si necesitas algo más, aquí estoy. 🙂", state.mode);
  }
  if (state && !tocoEstePaso && isMenuWord(text)) {
    // "menu"/"reiniciar": empieza de nuevo conservando el tipo de flujo.
    return iniciarFlujo(input, config, deps, state.mode);
  }

  if (!state) {
    // ws1-t3 — el botón «🔁 Reagendar» del recordatorio es reagendar, diga lo
    // que diga su título.
    const mode = input.eleccion?.id === REC_BOTON.REAGENDAR ? "reschedule" : detectMode(text);
    return iniciarFlujo(input, config, deps, mode);
  }

  switch (state.step) {
    case "who":
      return stepWho(input, config, state, deps);
    case "service_kind":
      return stepServiceKind(input, state, deps);
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
  const interactivo = interactivoDelPaso(state);
  return {
    reply,
    intent: intentFor(mode),
    newBotState: state as unknown as BotJson,
    ...(interactivo ? { interactivo } : {}),
  };
}

// ── ws1-t3: botones y listas ────────────────────────────────────────────────
// Cada pregunta con opciones sale además como botones (≤3) o lista (≤10). El
// texto numerado se queda: es el respaldo y el paciente puede seguir
// escribiendo el número o la hora. El id de cada opción es
// `bk.<paso>.<id de la opción>`, así un toque se resuelve por id EXACTO, sin
// analizar texto, y un toque de un paso anterior no se confunde con este.

const PASOS_CON_OPCIONES: readonly BookingStep[] = ["who", "service_kind", "service", "doctor", "slot", "select_appt"];
const SI_NO = { si: "si", no: "no" } as const;

function idDeOpcion(paso: BookingStep, opcionId: string): string {
  return `bk.${paso}.${opcionId}`;
}

function interactivoDelPaso(state: BookingState): MensajeInteractivo | null {
  if (state.step === "confirm") {
    return {
      tipo: "botones",
      botones: [
        { id: idDeOpcion("confirm", SI_NO.si), titulo: "✅ Sí, confirmo" },
        { id: idDeOpcion("confirm", SI_NO.no), titulo: "❌ No, otro horario" },
      ],
    };
  }
  if (!PASOS_CON_OPCIONES.includes(state.step) || !state.options?.length) return null;
  const boton = state.step === "slot" ? "Ver horarios" : "Ver opciones";
  return interactivoParaOpciones(
    state.options.map((o) => ({ id: idDeOpcion(state.step, o.id), titulo: o.label })),
    boton,
  );
}

/** ¿El paciente tocó una opción ofrecida en el paso `paso`? */
function esEleccionDelPaso(input: BotTurnInput, paso: BookingStep): boolean {
  return !!input.eleccion?.id.startsWith(`bk.${paso}.`);
}

/**
 * Índice de la opción tocada en este paso, o null si no tocó ninguna de estas
 * (escribió, o tocó algo de otro mensaje): entonces se lee el texto como
 * siempre.
 */
function indiceTocado(input: BotTurnInput, state: BookingState, options: BookingOption[]): number | null {
  if (!esEleccionDelPaso(input, state.step)) return null;
  const idx = options.findIndex((o) => idDeOpcion(state.step, o.id) === input.eleccion!.id);
  return idx >= 0 ? idx : null;
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
  // ws1-t5 — sin fecha fija de ejemplo: «2026-06-12» ya estaba en el pasado y
  // era justo lo que el paciente veía al elegir día.
  return `¿Para qué fecha te gustaría la cita${svc}? Puedes escribir "mañana", un día como "el jueves" o el día y el mes ("el 15", "15/10").`;
}

async function resolvePhone(input: BotTurnInput, deps: BookingDeps): Promise<string | null> {
  if (input.patient?.phone) return input.patient.phone;
  return deps.findThreadExternalId(input.threadId, input.clinicId);
}

/** Lo que se arrastra desde el mensaje que abrió el flujo (fecha y turno pedidos). */
type Precarga = Pick<BookingState, "fechaPedida" | "turno" | "mesPedido" | "buscarHasta">;

/**
 * ws1-t1 — «quiero cita el lunes en la tarde»: la fecha (si es de hoy en
 * adelante, en la zona de la clínica) y el turno se guardan para no volver a
 * preguntarlos. Lo que no se entienda se pregunta como siempre.
 */
function precargaDelMensaje(text: string, tz: string): Precarga {
  const out: Precarga = {};
  const fecha = parseDateInput(text, tz);
  if (fecha && fecha >= todayInTz(tz)) out.fechaPedida = fecha;
  const mediados = mediadosDeMes(text, tz);
  if (mediados) {
    out.fechaPedida = mediados.desde;
    out.buscarHasta = mediados.hasta;
  }
  // ws1-t5 — «el próximo mes» sin día: se pregunta qué día de ese mes.
  const mes = fecha ? null : mesPedidoSinDia(text, tz);
  if (mes) out.mesPedido = mes;
  const turno = turnoPedido(text);
  if (turno) out.turno = turno;
  return out;
}

/** «Ana G.», para que dos hermanos del mismo número se distingan sin dar el apellido entero. */
function etiquetaPaciente(p: { firstName: string; lastName: string }): string {
  const inicial = p.lastName.trim().charAt(0);
  return `${p.firstName.trim()}${inicial ? ` ${inicial.toUpperCase()}.` : ""}`.trim() || "Paciente";
}

// ── Arranque de flujos ──────────────────────────────────────────────────────

/**
 * Arranca agendar o reagendar. ws1-t1 (#12): si el número es de VARIOS
 * pacientes, primero pregunta para quién es (antes se agendaba a nombre del
 * primero que devolvía la base, sin preguntar). Con uno o ninguno, igual que
 * siempre.
 */
async function iniciarFlujo(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps,
  mode: FlowMode,
): Promise<BotTurnResult> {
  const tz = await deps.getClinicTimezone(input.clinicId);
  const precarga = precargaDelMensaje(input.incomingText, tz);

  if (input.patient && deps.listPhoneOwners) {
    const phone = await resolvePhone(input, deps);
    const duenos = phone ? await deps.listPhoneOwners(input.clinicId, phone) : [];
    if (duenos.length > 1) {
      const options: BookingOption[] = duenos.map((d) => ({ id: d.id, label: etiquetaPaciente(d) }));
      if (mode === "create") options.push({ id: OPCION_OTRA_PERSONA, label: "Otra persona" });
      const state: BookingState = {
        flow: "booking",
        mode,
        step: "who",
        options,
        fallbackToHuman: config.fallbackToHuman,
        ...precarga,
      };
      const pregunta =
        mode === "create"
          ? "Este número está registrado para varias personas. ¿Para quién es la cita?"
          : "Este número está registrado para varias personas. ¿De quién es la cita que quieres cambiar?";
      return step(`${pregunta} Responde con el número:\n${numberedList(options)}`, mode, state);
    }
  }

  return mode === "reschedule"
    ? startReschedule(input, config, deps, precarga)
    : startCreate(input, config, deps, precarga);
}

async function stepWho(
  input: BotTurnInput,
  config: BotConfigDTO,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  let idx = indiceTocado(input, state, options) ?? parseChoiceIndex(input.incomingText, options.length);
  if (idx === null && !esEleccionDelPaso(input, state.step)) {
    // También vale el nombre: «para Luis».
    const t = foldAccents(input.incomingText);
    const porNombre = options.findIndex(
      (o) =>
        o.id !== OPCION_OTRA_PERSONA &&
        new RegExp(`\\b${foldAccents(o.label.split(" ")[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t),
    );
    if (porNombre >= 0) idx = porNombre;
    else if (/\b(otra persona|otro|otra|nuev[oa]|alguien mas)\b/.test(t)) {
      const otra = options.findIndex((o) => o.id === OPCION_OTRA_PERSONA);
      if (otra >= 0) idx = otra;
    }
  }
  if (idx === null) {
    return miss(state, `¿Para quién es? Responde con el número:\n${numberedList(options)}`);
  }
  const elegido = options[idx];
  const precarga: Precarga = {
    fechaPedida: state.fechaPedida,
    turno: state.turno,
    mesPedido: state.mesPedido,
    buscarHasta: state.buscarHasta,
  };
  const phone = input.patient?.phone ?? null;
  if (elegido.id === OPCION_OTRA_PERSONA) {
    // Sin paciente: el flujo pedirá su nombre y lo dará de alta aparte.
    return startCreate({ ...input, patient: undefined }, config, deps, { ...precarga, pacienteNuevo: true });
  }
  const conPaciente: BotTurnInput = { ...input, patient: { id: elegido.id, phone } };
  return state.mode === "reschedule"
    ? startReschedule(conPaciente, config, deps, precarga)
    : startCreate(conPaciente, config, deps, precarga);
}

async function startCreate(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps,
  precarga: Precarga & { pacienteNuevo?: boolean } = {},
): Promise<BotTurnResult> {
  const base: BookingState = {
    flow: "booking",
    mode: "create",
    step: "service",
    patientId: input.patient?.id ?? undefined,
    fallbackToHuman: config.fallbackToHuman,
    ...precarga,
  };

  // ws1-t1 (Ortodoncia conectada al bot) — antes del catálogo normal: ¿este
  // paciente ya tiene un caso de ortodoncia activo en esta sede, o el mensaje
  // que pidió "agendar" menciona ortodoncia/brackets/alineadores? Solo en
  // sedes con el módulo contratado; sin `getOrthoBookingContext` (dep
  // opcional) el flujo es exactamente el de siempre.
  const ortho = await deps.getOrthoBookingContext?.(input.clinicId, input.patient?.id ?? null);

  // ws1-t8: un paciente con caso activo que escribe «agendar» PUEDE querer otra cosa (una
  // limpieza): se le pregunta entre su control y otro servicio, no se le asigna el control.
  if (ortho?.casoActivo) {
    const caso = ortho.casoActivo;
    const options: BookingOption[] = [
      { id: OPCION_CONTROL_ORTO, label: caso.label },
      { id: OPCION_OTRO_SERVICIO, label: "Otro servicio (limpieza, consulta, etc.)" },
    ];
    const state: BookingState = {
      ...base,
      step: "service_kind",
      options,
      ortoCaso: { label: caso.label, durationMin: caso.durationMin, treatingDoctorId: caso.treatingDoctorId },
    };
    return step(
      `¡Con gusto te agendo! 🦷 Veo que tienes un tratamiento de ortodoncia activo.\n¿Qué necesitas? Responde con el número:\n${numberedList(options)}`,
      "create",
      state,
    );
  }

  if (ortho?.valoracion && detectaInteresOrtodoncia(input.incomingText)) {
    const state: BookingState = {
      ...base,
      serviceId: null,
      serviceName: ortho.valoracion.label,
      durationMin: ortho.valoracion.durationMin,
    };
    return advanceToDoctorOrDate(input, state, deps);
  }

  return startCatalogo(input, base, deps);
}

/** El catálogo normal de servicios (o «Consulta general» si la sede no tiene ninguno). */
async function startCatalogo(
  input: BotTurnInput,
  base: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const services = await deps.listBookableServices(input.clinicId);
  const state: BookingState = { ...base };

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
  // ws1-t5 — preguntó por un día («¿hay lugar el 20 de mayo?»): se le dice
  // que se revisa ESE día; los horarios dependen del servicio y del doctor.
  let saludo = "¡Con gusto te agendo! 🦷";
  if (state.fechaPedida) {
    const tz = await deps.getClinicTimezone(input.clinicId);
    saludo = `¡Con gusto reviso el ${formatDateHuman(state.fechaPedida, tz)}! 🦷`;
  }
  return step(
    `${saludo}\n¿Qué servicio necesitas? Responde con el número:\n${numberedList(options)}`,
    "create",
    state,
  );
}

async function startReschedule(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps,
  precarga: Precarga = {},
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
      ...precarga,
    };
    const actual = `${formatDateHuman(toISODate(a.startsAt, tz), tz)} a las ${formatTimeHuman(a.startsAt, tz)}`;
    return pedirFecha(input, state, deps, `Tu cita actual es el ${actual}.`);
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
    ...precarga,
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
    return pedirFecha(input, state, deps);
  }
  const options: BookingOption[] = doctors.map((d) => ({
    id: d.id,
    label: `${d.firstName} ${d.lastName}`.trim(),
  }));
  state.step = "doctor";
  state.options = options;
  return step(`¿Con qué profesional te gustaría? Responde con el número:\n${numberedList(options)}`, state.mode, state);
}

/**
 * Pide la fecha… salvo que el paciente ya la haya dicho al pedir la cita
 * (ws1-t1): entonces va directo a los horarios de ese día. La fecha pedida se
 * usa UNA vez; si ese día no hay lugar, `presentSlots` pide otra como siempre.
 */
async function pedirFecha(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
  prefijo?: string,
): Promise<BotTurnResult> {
  state.step = "date";
  if (state.fechaPedida) {
    const tz = await deps.getClinicTimezone(input.clinicId);
    state.dateISO = state.fechaPedida;
    state.fechaPedida = undefined;
    if (state.dateISO >= todayInTz(tz)) return presentSlots(input, state, tz, deps, prefijo);
  }
  if (state.mesPedido) {
    const tz = await deps.getClinicTimezone(input.clinicId);
    const pregunta = preguntaDiaDelMes(state.mesPedido, tz);
    return step(prefijo ? `${prefijo}\n${pregunta}` : pregunta, state.mode, state);
  }
  return step(prefijo ? `${prefijo}\n${askDateText(state)}` : askDateText(state), state.mode, state);
}

/** ws1-t5 — «el próximo mes» sin día: ¿qué día de ese mes? */
function preguntaDiaDelMes(mes: string, tz: string): string {
  return `¿Qué día de ${nombreDeMes(mes, tz)} te acomoda? Escríbeme el número del día, por ejemplo "el 10".`;
}

// ── Pasos ───────────────────────────────────────────────────────────────────

/** Elige el control de ortodoncia del caso: con su doctor tratante si sigue disponible. */
async function elegirControlOrto(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const caso = state.ortoCaso;
  if (!caso) return done("Algo salió mal con tu solicitud. Intentémoslo de nuevo más tarde.", state.mode);
  state.serviceId = null;
  state.serviceName = caso.label;
  state.durationMin = caso.durationMin;
  state.options = undefined;
  state.ortoCaso = undefined;
  if (caso.treatingDoctorId) {
    const doctores = await deps.listBookableDoctors(input.clinicId);
    const tratante = doctores.find((d) => d.id === caso.treatingDoctorId);
    if (tratante) {
      state.doctorId = tratante.id;
      state.doctorName = `${tratante.firstName} ${tratante.lastName}`.trim();
      return pedirFecha(input, state, deps, `Te agendo tu *${caso.label}* con ${state.doctorName}. 🦷`);
    }
    // El doctor tratante ya no está disponible (baja, cambio de rol): sigue
    // el flujo normal de elegir doctor, sin perder el servicio ya resuelto.
  }
  return advanceToDoctorOrDate(input, state, deps);
}

async function stepServiceKind(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = indiceTocado(input, state, options) ?? parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return miss(state, `No te entendí. Responde con el número:\n${numberedList(options)}`);
  }
  state.misses = 0;
  if (options[idx].id === OPCION_CONTROL_ORTO) return elegirControlOrto(input, state, deps);
  // Otro servicio: catálogo normal. El control del caso deja de importar en este flujo.
  const base: BookingState = { ...state, step: "service", options: undefined, ortoCaso: undefined };
  return startCatalogo(input, base, deps);
}

async function stepService(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  const idx = indiceTocado(input, state, options) ?? parseChoiceIndex(input.incomingText, options.length);
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
  const idx = indiceTocado(input, state, options) ?? parseChoiceIndex(input.incomingText, options.length);
  if (idx === null) {
    return miss(state, `Responde con el número del profesional:\n${numberedList(options)}`);
  }
  state.misses = 0;
  state.doctorId = options[idx].id;
  state.doctorName = options[idx].label;
  state.options = undefined;
  return pedirFecha(input, state, deps);
}

async function stepDate(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const tz = await deps.getClinicTimezone(input.clinicId);
  // ws1-t5 — tras «¿qué día de noviembre?», «el 10» (o «el lunes») es de ESE
  // mes. Una fecha completa («15 de diciembre», «en 3 semanas») sigue mandando.
  let dateISO: string | null = null;
  if (state.mesPedido) dateISO = fechaDentroDelMesPedido(input.incomingText, state.mesPedido, tz);
  dateISO ??= parseDateInput(input.incomingText, tz);
  if (!dateISO) {
    const mes = mesPedidoSinDia(input.incomingText, tz);
    if (mes) {
      state.misses = 0;
      state.mesPedido = mes;
      return step(preguntaDiaDelMes(mes, tz), state.mode, state);
    }
    if (state.mesPedido) {
      return miss(state, preguntaDiaDelMes(state.mesPedido, tz));
    }
    return miss(state, 'No reconocí la fecha. Escribe algo como "mañana", "el jueves", "en 3 semanas" o "15/10".');
  }
  if (dateISO < todayInTz(tz)) {
    return miss(state, 'Esa fecha ya pasó. Indícame una fecha futura (por ejemplo "mañana").');
  }
  state.misses = 0;
  state.buscarHasta = mediadosDeMes(input.incomingText, tz, undefined, state.mesPedido)?.hasta;
  state.mesPedido = undefined;
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
  let res = await deps.getAvailableSlots({
    clinicId: input.clinicId,
    doctorId: state.doctorId,
    dateISO: state.dateISO,
    durationMin: state.durationMin ?? 0,
  });
  let human = formatDateHuman(state.dateISO, tz);
  let prefix = note ? `${note}\n` : "";

  if (res.closed || res.slots.length === 0) {
    // Por qué ESE día no. WS1-T2 — si lo cerró un BLOQUEO, se dice el motivo:
    // «no hay atención» invita a insistir ese mismo día; «cerrado por
    // vacaciones» hace que la persona pregunte por otra fecha. El motivo lo
    // escribió la clínica y no nombra a nadie. WS1-T2 · horario — si la
    // clínica abre pero ESTE doctor no, se dice con su nombre (lo eligió en
    // este mismo chat) y sin explicar su horario.
    let motivo: string;
    let pregunta = "¿Qué otra fecha te acomoda?";
    if (!res.closed) {
      motivo = `No quedan horarios disponibles el ${human}.`;
      pregunta = "¿Quieres probar otra fecha?";
    } else if (res.reason === "blocked" && res.mensajeBloqueo) {
      motivo = `Ese día (${human}) la agenda está cerrada: ${res.mensajeBloqueo}.`;
    } else if (res.reason === "doctor_off") {
      motivo = `${state.doctorName ?? "El profesional"} no atiende ese día (${human}).`;
    } else {
      motivo = `Ese día (${human}) no hay atención.`;
    }

    // ws1-t5 — en vez de solo pedir otra fecha, se busca el día más cercano
    // con lugar (mismo doctor y duración), día por día y con tope.
    const hasta = state.buscarHasta;
    const siguiente = await siguienteDiaConLugar(input, state, deps);
    if (!siguiente) {
      state.step = "date";
      const tampoco = hasta
        ? `Tampoco encontré lugar hasta el ${formatDateHuman(hasta, tz)}.`
        : `Tampoco encontré lugar en los ${DIAS_A_BUSCAR_HACIA_ADELANTE} días siguientes.`;
      return step(
        `${prefix}${motivo} ${tampoco} ${pregunta}`,
        state.mode,
        state,
      );
    }
    state.dateISO = siguiente.dateISO;
    res = siguiente.res;
    human = formatDateHuman(siguiente.dateISO, tz);
    prefix = `${prefix}${motivo} El día más cercano con lugar es el ${human}.\n`;
  }
  state.buscarHasta = undefined; // el rango de «a mediados» se usa una sola vez

  // ws1-t1 — «en la tarde»: primero los huecos de ese turno. Si ese turno no
  // tiene ninguno, se dice y se enseñan los que hay. Escribir otra hora libre
  // (de cualquier turno) sigue valiendo: `state.slots` guarda todas.
  let lista = res.slots;
  let notaTurno = "";
  if (state.turno) {
    const delTurno = res.slots.filter((s) => (state.turno === "tarde" ? s >= "12:00" : s < "12:00"));
    if (delTurno.length > 0) lista = delTurno;
    else notaTurno = `Ese día no quedan horarios ${state.turno === "tarde" ? "por la tarde" : "por la mañana"}. `;
  }

  const shown = lista.slice(0, MAX_SLOTS_SHOWN);
  const options: BookingOption[] = shown.map((s) => ({ id: s, label: s }));
  state.options = options;
  state.slots = res.slots.slice(0, 40);
  state.step = "slot";
  // ws1-t1 (#18) — el ejemplo es un hueco REAL que no cupo en la lista, no un
  // «16:30» fijo que podía no existir (y al escribirlo: «no está disponible»).
  const noMostradas = res.slots.filter((s) => !shown.includes(s));
  const ejemplo = noMostradas.find((s) => (state.slots ?? []).includes(s));
  const extra = ejemplo ? `\n(También puedes escribir otra hora disponible, por ejemplo ${ejemplo}.)` : "";
  return step(
    `${prefix}${notaTurno}Horarios disponibles el ${human} con ${state.doctorName ?? "el profesional"}:\n${numberedList(options)}${extra}\nResponde con el número.`,
    state.mode,
    state,
  );
}

/**
 * ws1-t5 — el primer día con horarios libres después de `state.dateISO`, hasta
 * DIAS_A_BUSCAR_HACIA_ADELANTE días. Una consulta por día, en serie (nunca en
 * paralelo: el pooler se satura) y parando en el primero que tenga lugar.
 */
async function siguienteDiaConLugar(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<{ dateISO: string; res: SlotResult } | null> {
  if (!state.doctorId || !state.dateISO) return null;
  // ws1-t5 — «a mediados de <mes>»: hasta el 18 de ese mes, no 7 días.
  const hasta = state.buscarHasta;
  state.buscarHasta = undefined;
  for (let i = 1; hasta ? addDaysISO(state.dateISO, i) <= hasta : i <= DIAS_A_BUSCAR_HACIA_ADELANTE; i++) {
    const dateISO = addDaysISO(state.dateISO, i);
    const res = await deps.getAvailableSlots({
      clinicId: input.clinicId,
      doctorId: state.doctorId,
      dateISO,
      durationMin: state.durationMin ?? 0,
    });
    if (!res.closed && res.slots.length > 0) return { dateISO, res };
  }
  return null;
}

async function stepSlot(
  input: BotTurnInput,
  state: BookingState,
  deps: BookingDeps,
): Promise<BotTurnResult> {
  const options = state.options ?? [];
  // ws1-t3 — tocó una fila de la lista: esa hora, sin interpretar el título.
  const tocado = indiceTocado(input, state, options);
  // ws1-t5 — ante la lista de horarios el paciente puede pedir OTRO día
  // («mejor el jueves», «en 3 semanas», «el 15 de junio», «el próximo mes»):
  // se le enseñan los de ese día en vez de un «elige por número». «El 3» o
  // «la 2» a secas siguen siendo opciones de la lista.
  if (tocado === null) {
    const tz = await deps.getClinicTimezone(input.clinicId);
    const otroDia = parseFechaConPalabras(input.incomingText, tz);
    if (otroDia && otroDia >= todayInTz(tz) && otroDia !== state.dateISO) {
      state.misses = 0;
      state.options = undefined;
      state.slots = undefined;
      state.dateISO = otroDia;
      state.buscarHasta = mediadosDeMes(input.incomingText, tz)?.hasta;
      return presentSlots(input, state, tz, deps);
    }
    const mes = otroDia ? null : mesPedidoSinDia(input.incomingText, tz);
    if (mes) {
      state.misses = 0;
      state.options = undefined;
      state.slots = undefined;
      state.step = "date";
      state.mesPedido = mes;
      return step(preguntaDiaDelMes(mes, tz), state.mode, state);
    }
  }
  // ws1-t1 (#2) — una hora escrita como hora («a las 10», «10 am», «10:30», o
  // «10» si ese hueco existe) es esa hora, no la opción número 10.
  const eleccion =
    tocado !== null
      ? ({ tipo: "indice", indice: tocado } as const)
      : interpretarEleccionDeHorario(input.incomingText, options.map((o) => o.id), state.slots ?? []);
  if (eleccion?.tipo === "hora_no_disponible") {
    return miss(state, `Esa hora no está disponible. Elige una de la lista por su número:\n${numberedList(options)}`);
  }
  const time = eleccion?.tipo === "hora" ? eleccion.hora : eleccion?.tipo === "indice" ? options[eleccion.indice]?.id : null;
  if (!time) {
    const ejemplo = options[0]?.id;
    return miss(
      state,
      `Elige un horario por su número${ejemplo ? ` (o escribe una hora disponible, ej. ${ejemplo})` : ""}:\n${numberedList(options)}`,
    );
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
  await prepararAnticipo(input, state, deps);
  return step(confirmText(state, await deps.getClinicTimezone(input.clinicId)), state.mode, state);
}

/**
 * WS1-T5 — antes del «¿confirmas?» de una cita NUEVA se pregunta si la clínica
 * pide anticipo, para que el paciente lo sepa antes de decir que sí. Si la
 * consulta falla, se sigue sin anunciarlo: el servidor decide igual al crear.
 */
async function prepararAnticipo(input: BotTurnInput, state: BookingState, deps: BookingDeps): Promise<void> {
  if (state.mode !== "create" || !deps.anticipoParaAnunciar) {
    state.anticipo = null;
    return;
  }
  try {
    state.anticipo = await deps.anticipoParaAnunciar(input.clinicId, state.serviceId ?? null);
  } catch {
    state.anticipo = null;
  }
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
  const patient = await deps.findOrCreateWhatsAppPatient(
    input.clinicId,
    phone,
    name,
    state.pacienteNuevo ? { crearNuevo: true } : undefined,
  );
  if (!patient) {
    return done("Tuve un problema al crear tu registro. Intenta más tarde o llama al consultorio.", state.mode);
  }
  state.patientId = patient.id;
  state.step = "confirm";
  await prepararAnticipo(input, state, deps);
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
  if (state.mode === "create" && state.anticipo) {
    lines.push("", textoAvisoAnticipo(state.anticipo.monto, state.anticipo.minutos));
  }
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

  // ws1-t1 (#3) — la negación gana: «no me va», «no sé, ok» u «ok no» NO crean
  // la cita (antes `isAffirmative` iba primero y casaba con el «va»/«ok»).
  // ws1-t3 — con los botones «Sí»/«No» la respuesta es el id, no el texto.
  const respuesta =
    input.eleccion?.id === idDeOpcion("confirm", SI_NO.si)
      ? "si"
      : input.eleccion?.id === idDeOpcion("confirm", SI_NO.no)
        ? "no"
        : respuestaSiNo(t);
  if (respuesta === "no") {
    state.misses = 0;
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "De acuerdo, elijamos otro horario.");
  }
  if (respuesta !== "si") {
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
    serviceId: state.serviceId ?? null,
    threadId: input.threadId,
  });
  if (!c.ok) return createError(c.error ?? "failed", input, state, tz, deps);
  // WS1-T5 — la cita quedó APARTADA esperando el anticipo: se manda el link.
  // El monto y el plazo son los que decidió el servidor al crearlo, no los que
  // se anunciaron antes (si la clínica los cambió en medio, manda el de ahora).
  if (c.anticipo) {
    return done(
      textoLinkDePago({
        fechaHumana: formatDateHuman(state.dateISO, tz),
        hora: state.time,
        doctor: state.doctorName ?? null,
        monto: c.anticipo.monto,
        url: c.anticipo.url,
        venceA: new Date(c.anticipo.venceA),
        minutos: c.anticipo.minutos,
        tz,
      }),
      state.mode,
    );
  }
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
  const idx = indiceTocado(input, state, options) ?? parseChoiceIndex(input.incomingText, options.length);
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
  return pedirFecha(input, state, deps);
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
  // WS1-T2 — entre que se enseñaron los horarios y llegó el "sí", alguien
  // cerró ese hueco desde el panel. Se vuelve a la lista del mismo día, igual
  // que con `overlap`: si el bloqueo era de unas horas quedan huecos, y si era
  // del día entero `presentSlots` lo dirá con su motivo.
  if (error === "blocked") {
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "Ese horario acaba de cerrarse en la agenda. 😅");
  }
  // WS1-T2 · horario — esa hora ya no está en el horario del doctor (lo cambió
  // mientras se elegía). Se vuelve a la lista del mismo día, que ya sale
  // recortada a su horario.
  if (error === "doctor_off") {
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "A esa hora el profesional no atiende. 😅");
  }
  // WS1-T5 — la clínica pide anticipo y el link no salió. La cita NO quedó
  // apartada (el servidor lo deshizo): se dice tal cual y pasa a una persona,
  // en vez de agendar sin el anticipo que la clínica pidió.
  if (error === "pago_no_disponible") {
    const reply =
      "No pude generar el link de pago del anticipo en este momento, así que el horario NO quedó apartado. " +
      "Le paso tu solicitud al equipo para que te ayude. 🙏";
    if (state.fallbackToHuman !== false) {
      return { reply, intent: BotIntent.HANDOFF, handoff: true, newBotState: null };
    }
    return done(
      "No pude generar el link de pago del anticipo en este momento, así que el horario NO quedó apartado. " +
        "Intenta en unos minutos o llama al consultorio.",
      state.mode,
    );
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
  // WS1-T2 — el hueco de DESTINO se cerró mientras se elegía. Ver createError.
  if (error === "blocked") {
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "Ese horario acaba de cerrarse en la agenda. 😅");
  }
  // WS1-T2 · horario — ver createError.
  if (error === "doctor_off") {
    state.step = "slot";
    return presentSlots(input, state, tz, deps, "A esa hora el profesional no atiende. 😅");
  }
  return done("No pude reagendar la cita ahora. Intenta más tarde o llama al consultorio.", state.mode);
}
