/**
 * EL HORARIO PROPIO DEL DOCTOR (dental) — la parte PURA. WS1-T2 · horario.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin `new Date()`
 * escondido. Se prueba sin base. Lo que toca la base vive en
 * consulta.server.ts (leer) y service.ts (escribir).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 HORARIO NO ES BLOQUEO
 *
 *  · «el 12 de noviembre no vengo»  → BLOQUEO (`AgendaBlock`): tiene fecha,
 *    no se repite. Vive en src/lib/agenda-bloqueos.
 *  · «nunca trabajo los miércoles»  → HORARIO (`DoctorSchedule`): se repite
 *    cada semana, no tiene fecha. Vive aquí.
 *
 * Las dos piezas hacen falta y ninguna se convierte en la otra: un horario
 * escrito como bloqueos serían 52 filas por miércoles al año, y un bloqueo
 * escrito como horario cerraría TODOS los 12 de noviembre.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS DOS REGLAS
 *
 * 1. UN DOCTOR SIN HORARIO PROPIO SIGUE EL DE LA CLÍNICA, EXACTAMENTE COMO
 *    ANTES. `doctorNoAtiende` devuelve `null` para él siempre, así que cada
 *    consumidor queda como estaba. Solo cambia la agenda de quien define su
 *    horario a propósito.
 *
 * 2. EL HORARIO DEL DOCTOR NO SE SALE DEL DE LA CLÍNICA. La disponibilidad
 *    efectiva es la INTERSECCIÓN:
 *
 *        abre la clínica  ∩  atiende el doctor  ∩  no hay bloqueo
 *
 *    Cada consumidor ya comprueba el horario de la clínica y el bloqueo; este
 *    módulo añade el tercer factor. Como un hueco tiene que pasar los tres,
 *    la intersección sale sola: si el doctor guardó 08:00–20:00 y la clínica
 *    abre 09:00–18:00, se ofrece 09:00–18:00. Guardarlo no es un error (la
 *    API lo acepta y AVISA con `avisosDeRecorte`); el cálculo recorta.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UNA SOLA FUNCIÓN, UN SOLO CRITERIO: `doctorNoAtiende`
 *
 * Mismo patrón que `bloqueaEsteHueco`: la llaman todas las puertas por las
 * que sale o entra una cita (la rejilla, el bot, Sabina, la web, el portal,
 * los POST públicos) y ninguna compara horas por su cuenta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { getTzParts } from "@/lib/agenda/time-utils";
import { scheduleDayOf, type ScheduleDay } from "@/lib/agenda/clinic-hours";

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS TIPOS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Un día del horario. La MISMA forma que `ClinicSchedule` (y que el `Dia` de
 * la API): `dayOfWeek` 0=Lunes … 6=Domingo (≠ JS getDay), horas "HH:MM" de
 * pared en la zona de la clínica.
 */
export type DiaHorario = ScheduleDay;

/**
 * doctorId → sus filas. SOLO están los doctores CON horario propio: que un id
 * no esté en el mapa es exactamente «hereda el de la clínica».
 */
export type HorariosDeDoctores = ReadonlyMap<string, readonly DiaHorario[]>;

/** Un mapa vacío: nadie tiene horario propio = todo como antes. */
export const SIN_HORARIOS: HorariosDeDoctores = new Map();

/**
 * El objeto plano que viaja en el JSON de la agenda (`horariosDoctores`)
 * convertido al mapa que esperan las funciones de aquí. Para las pantallas:
 * así preguntan con `doctorNoAtiende`, igual que el servidor, en vez de
 * comparar horas a mano.
 */
export function horariosDesdeObjeto(
  obj: Readonly<Record<string, readonly DiaHorario[]>> | null | undefined,
): HorariosDeDoctores {
  const mapa = new Map<string, readonly DiaHorario[]>();
  for (const [doctorId, filas] of Object.entries(obj ?? {})) {
    if (Array.isArray(filas) && filas.length > 0) mapa.set(doctorId, filas);
  }
  return mapa;
}

export const DIAS_SEMANA: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

export const NOMBRES_DIA = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

/** Las horas por defecto de un día nuevo, las mismas que `ClinicSchedule`. */
export const APERTURA_POR_DEFECTO = "09:00";
export const CIERRE_POR_DEFECTO = "18:00";

// ═══════════════════════════════════════════════════════════════════════
// 2 · HORAS
// ═══════════════════════════════════════════════════════════════════════

/** El formato que acepta la API: el mismo de /api/settings/schedule. */
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** El que se tolera al LEER (filas viejas "9:00"), el mismo de clinic-hours. */
const HORA_LEIDA_RE = /^(\d{1,2}):(\d{2})$/;

/** `"09:30"` → 570. `null` si no es una hora del día. */
export function minutosDeHora(hhmm: string | null | undefined): number | null {
  const m = HORA_LEIDA_RE.exec(hhmm ?? "");
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(min) && min >= 0 && min <= 24 * 60 ? min : null;
}

/** 570 → `"09:30"`. */
export function horaDeMinutos(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Una ventana del día en minutos de pared, `[abre, cierra)`. */
export interface Ventana {
  abre: number;
  cierra: number;
}

/** La fila de un día, si abre y sus horas se entienden. `null` = ese día no se atiende. */
function ventanaDeFila(fila: DiaHorario | undefined): Ventana | null {
  if (!fila || !fila.enabled) return null;
  const abre = minutosDeHora(fila.openTime);
  const cierra = minutosDeHora(fila.closeTime);
  // Una fila habilitada con horas ilegibles o al revés NO abre nada. La API
  // nunca la guarda así; si llega (una edición a mano en la base), lo prudente
  // es no ofrecer ese día: el encargo es evitar sobreagenda, y abrir de más es
  // exactamente eso.
  if (abre === null || cierra === null || cierra <= abre) return null;
  return { abre, cierra };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL CORAZÓN: ¿ATIENDE ESTE DOCTOR ESTE HUECO?
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las filas del doctor, o `null` si no tiene horario propio (hereda).
 *
 * `doctorId` en `null` = un hueco sin doctor concreto (una solicitud «con
 * cualquiera», la barra del Mes): no hay horario personal que aplicar.
 */
export function horarioPropio(
  horarios: HorariosDeDoctores | null | undefined,
  doctorId: string | null | undefined,
): readonly DiaHorario[] | null {
  if (!doctorId || !horarios) return null;
  const filas = horarios.get(doctorId);
  return filas && filas.length > 0 ? filas : null;
}

/** Por qué el doctor no atiende ese hueco. */
export interface FueraDeHorario {
  /**
   *  · `dia_libre`   — ese día de la semana no atiende.
   *  · `antes`       — el hueco empieza antes de su hora de entrada.
   *  · `despues`     — el hueco termina después de su hora de salida (o
   *                    cruza la medianoche).
   */
  motivo: "dia_libre" | "antes" | "despues";
  /** 0=Lunes … 6=Domingo, del INICIO del hueco en la zona de la clínica. */
  dayOfWeek: number;
  /** Su horario ese día, "HH:MM". `null` si ese día no atiende. */
  openTime: string | null;
  closeTime: string | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ¿EL DOCTOR NO ATIENDE `[inicio, fin)`? Devuelve el porqué, o `null` si sí
 * atiende (o si no tiene horario propio).
 *
 * Es LA función: la llaman todos los consumidores y ninguno compara horas por
 * su cuenta.
 *
 * 🔴 SEMIABIERTO POR LA DERECHA, como `rangosSePisan` de los bloqueos: con
 * salida a las 14:00, una cita de 13:30 a 14:00 cabe y una que EMPIEZA a las
 * 14:00 no. «Empieza justo al cerrar» es fuera.
 *
 * 🔴 SOLO MIRA AL DOCTOR. El horario de la clínica lo sigue comprobando cada
 * consumidor como siempre; como el hueco tiene que pasar las dos cosas, lo que
 * queda es la intersección. Si esta función mirara también a la clínica, un
 * doctor SIN horario propio dejaría de dar `null` en una clínica sin
 * `ClinicSchedule` y la regla 1 se rompería.
 *
 * Devuelve el porqué y no un booleano por lo mismo que `bloqueaEsteHueco`:
 * quien choca tiene que poder decir «el doctor atiende de 9 a 14», no solo
 * «no se puede».
 * ═══════════════════════════════════════════════════════════════════════
 */
export function doctorNoAtiende(
  horarios: HorariosDeDoctores | null | undefined,
  inicio: Date,
  fin: Date,
  doctorId: string | null | undefined,
  timeZone: string,
): FueraDeHorario | null {
  const filas = horarioPropio(horarios, doctorId);
  // REGLA 1: sin horario propio no se cambia nada.
  if (!filas) return null;
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;

  const dayOfWeek = scheduleDayOf(inicio, timeZone);
  const fila = filas.find((f) => f.dayOfWeek === dayOfWeek);
  const ventana = ventanaDeFila(fila);
  if (!ventana) {
    return { motivo: "dia_libre", dayOfWeek, openTime: null, closeTime: null };
  }

  const s = getTzParts(inicio, timeZone);
  const e = getTzParts(fin, timeZone);
  // Intl a veces escribe la medianoche como "24": es la hora 0.
  const inicioMin = (s.hour === 24 ? 0 : s.hour) * 60 + s.minute;
  const mismoDia = s.year === e.year && s.month === e.month && s.day === e.day;
  const finMin = mismoDia
    ? (e.hour === 24 ? 0 : e.hour) * 60 + e.minute
    // Otro día calendario: termina a medianoche (1440, «hasta el final del
    // día») o cruza al día siguiente — y entonces se sale de cualquier
    // horario, porque ninguno pasa de 24:00.
    : (e.hour === 0 || e.hour === 24) && e.minute === 0
      ? 24 * 60
      : 24 * 60 + 1;

  const openTime = horaDeMinutos(ventana.abre);
  const closeTime = horaDeMinutos(ventana.cierra);
  if (inicioMin < ventana.abre) return { motivo: "antes", dayOfWeek, openTime, closeTime };
  if (finMin > ventana.cierra) return { motivo: "despues", dayOfWeek, openTime, closeTime };
  return null;
}

/**
 * Atajo para quien razona con INICIO + minutos (`"09:30"` + 30), que es como
 * piensan todas las calculadoras de huecos del repo. Espejo de
 * `bloqueaEsteSlot`.
 */
export function doctorNoAtiendeSlot(
  horarios: HorariosDeDoctores | null | undefined,
  inicioUtc: Date,
  duracionMin: number,
  doctorId: string | null | undefined,
  timeZone: string,
): FueraDeHorario | null {
  return doctorNoAtiende(
    horarios,
    inicioUtc,
    new Date(inicioUtc.getTime() + duracionMin * 60_000),
    doctorId,
    timeZone,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA VENTANA DEL DÍA (para los que barren un día o miden capacidad)
// ═══════════════════════════════════════════════════════════════════════

/**
 * La ventana del doctor un día de la semana, YA INTERSECADA con la de la
 * clínica. `null` = ese día no se le agenda nada.
 *
 * `clinica` es la ventana que el consumidor ya calculaba con SU criterio (cada
 * uno tiene el suyo y esta tarea no lo cambia); aquí solo se recorta.
 * Sin horario propio devuelve la de la clínica tal cual: regla 1.
 */
export function ventanaDelDoctor(
  clinica: Ventana | null,
  filas: readonly DiaHorario[] | null | undefined,
  dayOfWeek: number,
): Ventana | null {
  if (!clinica) return null;
  if (!filas || filas.length === 0) return clinica;
  const propia = ventanaDeFila(filas.find((f) => f.dayOfWeek === dayOfWeek));
  if (!propia) return null;
  const abre = Math.max(clinica.abre, propia.abre);
  const cierra = Math.min(clinica.cierra, propia.cierra);
  return cierra > abre ? { abre, cierra } : null;
}

/**
 * La ventana de la CLÍNICA un día de la semana, con el criterio de
 * `scheduleViolation` (el del alta del staff): con `ClinicSchedule`
 * utilizable manda la fila del día (sin fila o apagada = cerrado); sin él, la
 * ventana histórica `agendaDayStart/End` los siete días.
 *
 * La usan la API (para avisar de recortes y para devolver el horario que
 * hereda un doctor) y quien no tenía ya su propio criterio.
 */
export function ventanaDeLaClinica(
  clinic: { agendaDayStart: number; agendaDayEnd: number },
  schedules: readonly DiaHorario[] | null | undefined,
  dayOfWeek: number,
): Ventana | null {
  const utiles = (schedules ?? []).filter(
    (d) => minutosDeHora(d.openTime) !== null && minutosDeHora(d.closeTime) !== null,
  );
  if (utiles.length === 0) {
    const abre = clinic.agendaDayStart * 60;
    const cierra = clinic.agendaDayEnd * 60;
    return cierra > abre ? { abre, cierra } : null;
  }
  return ventanaDeFila(utiles.find((d) => d.dayOfWeek === dayOfWeek));
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LOS TEXTOS
// ═══════════════════════════════════════════════════════════════════════

/**
 * El AVISO PARA EL STAFF, con la forma de `ScheduleViolation`.
 *
 * 🔴 AL STAFF SE LE AVISA, NO SE LE PROHÍBE — el mismo criterio que el
 * fuera-de-horario de la clínica (`scheduleViolation`) y que el bloqueo
 * (`avisoDeBloqueo`), y por la misma razón: quien está en el mostrador con el
 * paciente delante sabe algo que el sistema no. Lo que no pasa sin excepción
 * son las puertas sin nadie mirando: el bot, la web, el portal y Sabina.
 *
 * Viaja por `scheduleWarning`, que las pantallas del staff ya leen y pintan
 * como toast; «Se guardó de todas formas» va al final y literal, igual que en
 * los otros dos avisos.
 */
export function avisoDeHorarioDoctor(f: FueraDeHorario): {
  reason: "doctor_off";
  message: string;
  openTime: string | null;
  closeTime: string | null;
} {
  const dia = NOMBRES_DIA[f.dayOfWeek] ?? "ese día";
  const cuerpo =
    f.motivo === "dia_libre"
      ? `el doctor no atiende los ${dia}`
      : f.motivo === "antes"
        ? `la cita empieza antes de que entre el doctor (los ${dia} atiende de ${f.openTime} a ${f.closeTime})`
        : `la cita termina después de que salga el doctor (los ${dia} atiende de ${f.openTime} a ${f.closeTime})`;
  return {
    reason: "doctor_off",
    message: `Ojo: ${cuerpo}. La cita se guardó de todas formas.`,
    openTime: f.openTime,
    closeTime: f.closeTime,
  };
}

/**
 * El texto para quien NO es staff (la web, el portal, el bot). No nombra al
 * doctor ni explica su horario: basta con que esa hora no se puede.
 */
export const MENSAJE_PUBLICO_FUERA_DE_HORARIO =
  "El doctor no atiende en ese horario. Elige otro horario, por favor.";

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA SEMANA QUE LLEGA POR LA API
// ═══════════════════════════════════════════════════════════════════════

/** El error de los parsers. Lleva el status con el que sale por la API. */
export class HorarioError extends Error {
  status: number;
  /** Código estable para que la pantalla no tenga que leer el texto. */
  codigo: string;
  constructor(mensaje: string, status = 400, codigo = "INVALIDO") {
    super(mensaje);
    this.name = "HorarioError";
    this.status = status;
    this.codigo = codigo;
  }
}

/** Los roles que, con la llave, pueden tocar el horario de OTROS doctores. */
export const ROLES_ADMINISTRATIVOS: readonly string[] = ["ADMIN", "SUPER_ADMIN", "RECEPTIONIST"];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ¿PUEDE QUIEN PIDE TOCAR EL HORARIO DE ESTE DOCTOR? Devuelve el id limpio, o
 * lanza el `HorarioError` con el status que sale por la API.
 *
 * Pura a propósito —sin base— para que el reparto por rol se pruebe entero:
 *  · sin la llave (`agenda.bloqueos`)      → 403, sea quien sea;
 *  · DOCTOR                                → solo su propio id; otro → 403;
 *  · ADMIN / SUPER_ADMIN / RECEPTIONIST    → cualquiera (el servidor comprueba
 *    DESPUÉS que el doctor sea de su clínica);
 *  · cualquier otro rol                    → 403.
 *
 * 🔴 VA ANTES DE CONSULTAR LA BASE. Un DOCTOR que pide el id de un compañero
 * recibe 403 sin que se mire si ese id existe: contestar 404 o 200 según
 * exista le estaría contando algo.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function alcanceDelHorario(
  quien: { role: string; userId: string; puedeGestionar: boolean },
  doctorIdRaw: unknown,
): string {
  if (!quien.puedeGestionar) {
    throw new HorarioError("Permiso requerido: agenda.bloqueos", 403, "SIN_PERMISO");
  }
  const doctorId = typeof doctorIdRaw === "string" ? doctorIdRaw.trim() : "";
  if (!doctorId) throw new HorarioError("Falta el doctor.", 400, "DOCTOR_REQUERIDO");
  if (quien.role === "DOCTOR") {
    if (doctorId !== quien.userId) {
      throw new HorarioError("Solo puedes ver y cambiar tu propio horario.", 403, "ALCANCE_NO_PERMITIDO");
    }
    return doctorId;
  }
  if (!ROLES_ADMINISTRATIVOS.includes(quien.role)) {
    throw new HorarioError("Tu rol no puede cambiar horarios.", 403, "SIN_PERMISO");
  }
  return doctorId;
}

/**
 * LA SEMANA del cuerpo del PUT, validada y ordenada por día.
 *
 * 🔴 LOS SIETE DÍAS SIEMPRE. Un PUT con cinco días no dice qué pasa con los
 * otros dos: ¿los apagó?, ¿los dejó como estaban?, ¿heredan de la clínica? Con
 * el horario de un doctor no hay mitades — o tiene horario propio entero o
 * hereda el de la clínica entero —, así que se pide la semana completa y un
 * día sin atender se manda con `enabled: false`.
 *
 * Mismas reglas que `PATCH /api/settings/schedule` (el horario de la
 * clínica): "HH:MM" de 00:00 a 23:59, y en un día que atiende la entrada va
 * antes de la salida.
 */
export function parseSemana(raw: unknown): DiaHorario[] {
  if (!Array.isArray(raw) || raw.length !== 7) {
    throw new HorarioError(
      "Manda los 7 días de la semana. Un día que no atiende va con «enabled: false».",
      400,
      "SEMANA_INCOMPLETA",
    );
  }
  const vistos = new Set<number>();
  const semana: DiaHorario[] = [];
  for (const item of raw) {
    const dayOfWeek = (item as { dayOfWeek?: unknown })?.dayOfWeek;
    if (typeof dayOfWeek !== "number" || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new HorarioError("dayOfWeek debe ser un entero entre 0 (lunes) y 6 (domingo).", 400, "DIA_INVALIDO");
    }
    if (vistos.has(dayOfWeek)) {
      throw new HorarioError(`Día repetido: ${NOMBRES_DIA[dayOfWeek]}.`, 400, "DIA_REPETIDO");
    }
    vistos.add(dayOfWeek);

    const enabled = (item as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") {
      throw new HorarioError(
        `Di si el ${NOMBRES_DIA[dayOfWeek]} atiende o no («enabled»: true o false).`,
        400,
        "ENABLED_INVALIDO",
      );
    }
    const { openTime, closeTime } = item as { openTime?: unknown; closeTime?: unknown };
    if (
      typeof openTime !== "string" || !HORA_RE.test(openTime) ||
      typeof closeTime !== "string" || !HORA_RE.test(closeTime)
    ) {
      throw new HorarioError(
        `El horario del ${NOMBRES_DIA[dayOfWeek]} no se entiende. Usa el formato HH:MM.`,
        400,
        "HORA_INVALIDA",
      );
    }
    if (enabled && openTime >= closeTime) {
      throw new HorarioError(
        `El ${NOMBRES_DIA[dayOfWeek]} la hora de entrada tiene que ser antes de la de salida.`,
        400,
        "RANGO_INVERTIDO",
      );
    }
    semana.push({ dayOfWeek, enabled, openTime, closeTime });
  }
  semana.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return semana;
}

/**
 * LA SEMANA COMPLETA a partir de las filas guardadas: siete días siempre, los
 * que falten como `enabled: false`. Es lo que devuelve el GET cuando el doctor
 * SÍ tiene horario propio — la pantalla pinta siete filas, no las que haya.
 */
export function semanaCompleta(filas: readonly DiaHorario[]): DiaHorario[] {
  return DIAS_SEMANA.map((d) => {
    const f = filas.find((x) => x.dayOfWeek === d);
    return f
      ? { dayOfWeek: d, enabled: f.enabled, openTime: f.openTime, closeTime: f.closeTime }
      : { dayOfWeek: d, enabled: false, openTime: APERTURA_POR_DEFECTO, closeTime: CIERRE_POR_DEFECTO };
  });
}

/**
 * LA SEMANA QUE HEREDA un doctor sin horario propio: la de la clínica, leída
 * con el criterio de `ventanaDeLaClinica`. Es lo que devuelve el GET con
 * `hereda: true`, para que la pantalla arranque de lo que el doctor YA tiene
 * en la práctica y no de un 9–18 inventado.
 */
export function semanaHeredada(
  clinic: { agendaDayStart: number; agendaDayEnd: number },
  schedules: readonly DiaHorario[] | null | undefined,
): DiaHorario[] {
  return DIAS_SEMANA.map((d) => {
    const v = ventanaDeLaClinica(clinic, schedules, d);
    if (v) {
      return { dayOfWeek: d, enabled: true, openTime: horaDeMinutos(v.abre), closeTime: horaDeMinutos(v.cierra) };
    }
    const fila = (schedules ?? []).find((s) => s.dayOfWeek === d);
    return {
      dayOfWeek: d,
      enabled: false,
      openTime: fila?.openTime && HORA_RE.test(fila.openTime) ? fila.openTime : APERTURA_POR_DEFECTO,
      closeTime: fila?.closeTime && HORA_RE.test(fila.closeTime) ? fila.closeTime : CIERRE_POR_DEFECTO,
    };
  });
}

/** Un día en que lo guardado se sale del horario de la clínica. */
export interface AvisoRecorte {
  dayOfWeek: number;
  /**
   *  · `clinica_cerrada` — el doctor dice que atiende y la clínica no abre.
   *  · `sin_coincidencia` — abren los dos pero sus horas no se tocan.
   *  · `recortado`       — se solapan; se agenda solo la parte común.
   */
  tipo: "clinica_cerrada" | "sin_coincidencia" | "recortado";
  /** Lo que de verdad se va a agendar ese día. `null` = nada. */
  efectivo: { openTime: string; closeTime: string } | null;
  message: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS DÍAS EN QUE EL HORARIO GUARDADO SE SALE DEL DE LA CLÍNICA.
 *
 * 🔴 LA API ACEPTA Y AVISA; EL CÁLCULO RECORTA. Se guarda lo que la persona
 * escribió —si la clínica amplía su horario mañana, el del doctor ya está
 * bien— y se le dice qué parte no va a servir hoy. Es el mismo criterio que
 * `scheduleViolation`: avisar, no prohibir. Lo que NUNCA pasa es que la
 * agenda ofrezca un minuto fuera de la clínica: eso lo garantiza la
 * intersección, no este aviso.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function avisosDeRecorte(
  semana: readonly DiaHorario[],
  clinic: { agendaDayStart: number; agendaDayEnd: number },
  schedules: readonly DiaHorario[] | null | undefined,
): AvisoRecorte[] {
  const avisos: AvisoRecorte[] = [];
  for (const dia of semana) {
    const propia = ventanaDeFila(dia);
    if (!propia) continue; // no atiende ese día: no hay nada que recortar
    const nombre = NOMBRES_DIA[dia.dayOfWeek] ?? "ese día";
    const clinica = ventanaDeLaClinica(clinic, schedules, dia.dayOfWeek);
    if (!clinica) {
      avisos.push({
        dayOfWeek: dia.dayOfWeek,
        tipo: "clinica_cerrada",
        efectivo: null,
        message: `El ${nombre} la clínica no abre: ese día no se le agendará nada.`,
      });
      continue;
    }
    const efectiva = ventanaDelDoctor(clinica, [dia], dia.dayOfWeek);
    if (!efectiva) {
      avisos.push({
        dayOfWeek: dia.dayOfWeek,
        tipo: "sin_coincidencia",
        efectivo: null,
        message:
          `El ${nombre} la clínica abre de ${horaDeMinutos(clinica.abre)} a ${horaDeMinutos(clinica.cierra)} ` +
          `y ese horario no coincide: ese día no se le agendará nada.`,
      });
      continue;
    }
    if (efectiva.abre !== propia.abre || efectiva.cierra !== propia.cierra) {
      avisos.push({
        dayOfWeek: dia.dayOfWeek,
        tipo: "recortado",
        efectivo: { openTime: horaDeMinutos(efectiva.abre), closeTime: horaDeMinutos(efectiva.cierra) },
        message:
          `El ${nombre} la clínica abre de ${horaDeMinutos(clinica.abre)} a ${horaDeMinutos(clinica.cierra)}: ` +
          `se le agendará de ${horaDeMinutos(efectiva.abre)} a ${horaDeMinutos(efectiva.cierra)}.`,
      });
    }
  }
  return avisos;
}
