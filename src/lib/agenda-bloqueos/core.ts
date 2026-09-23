/**
 * LOS BLOQUEOS DE AGENDA (dental) — la parte PURA. WS1-T2.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin `new Date()`
 * escondido. Se prueba sin base (`npm run test:agenda-bloqueos`). Lo que toca
 * la base vive en service.ts y consulta.server.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE
 *
 * Hasta ahora Dental no sabía cerrar un día ni unas horas: lo único que
 * conocía era `ClinicSchedule`, el horario SEMANAL. Para cerrar el 25 de
 * diciembre había que apagar los jueves —y con ellos los 52 jueves del año—
 * o no cerrarlo. El diseño está portado de `EduAgendaBlock` (la vertical
 * educativa ya lo tenía resuelto), simplificado: en dental no hay sedes ni
 * sillones, solo clínica y doctor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UNA SOLA FUNCIÓN, UN SOLO CRITERIO: `bloqueaEsteHueco`
 *
 * La tapan CINCO puertas distintas (la rejilla del panel, el bot de WhatsApp,
 * Sabina, la página web de la clínica y las solicitudes sin cuenta) más las
 * que se encontraron al mirar. Si cada una reimplementa el solape, tarde o
 * temprano dos de ellas discrepan y el bot ofrece lo que la web no, o al
 * revés. Todas llaman a esta función y ninguna compara fechas por su cuenta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL TIPO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Espejo 1:1 del enum `AgendaBlockKind` de Prisma, escrito como unión de
 * strings para poder importarlo desde un componente "use client" sin
 * arrastrar el cliente de Prisma al bundle del navegador. El candado de que
 * no se desincronicen es un chequeo de TIPOS en las pruebas.
 */
export type AgendaBlockKind =
  | "FESTIVO"
  | "VACACIONES"
  | "PERSONAL"
  | "MANTENIMIENTO"
  | "OTRO";

export const BLOQUEO_KINDS: AgendaBlockKind[] = [
  "FESTIVO",
  "VACACIONES",
  "PERSONAL",
  "MANTENIMIENTO",
  "OTRO",
];

export const BLOQUEO_KIND_LABELS: Record<AgendaBlockKind, string> = {
  FESTIVO: "Día festivo",
  VACACIONES: "Vacaciones",
  PERSONAL: "Asunto personal",
  MANTENIMIENTO: "Mantenimiento",
  OTRO: "Otro",
};

export const BLOQUEO_KIND_DESCRIPCIONES: Record<AgendaBlockKind, string> = {
  FESTIVO: "Día festivo, oficial o de costumbre. La clínica no abre.",
  VACACIONES: "Periodo vacacional o puente, de un doctor o de toda la clínica.",
  PERSONAL: "Un congreso, una cita médica, una boda. Suele ser de un doctor.",
  MANTENIMIENTO: "Obra, fumigación o equipo en servicio. Suele ser de toda la clínica.",
  OTRO: "Cualquier otra cosa; manda el motivo que escribas.",
};

export function parseKind(raw: unknown): AgendaBlockKind {
  if (typeof raw !== "string") return "OTRO";
  const v = raw.trim().toUpperCase();
  return (BLOQUEO_KINDS as string[]).includes(v) ? (v as AgendaBlockKind) : "OTRO";
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS TOPES
// ═══════════════════════════════════════════════════════════════════════

export const MOTIVO_MAX = 200;
export const MOTIVO_MIN = 3;
/** Cuántos bloqueos se leen de un rango como mucho. */
export const BLOQUEOS_MAX_FILAS = 300;
/** Cuántas citas en choque se devuelven en el 409. Ver `CHOQUE_MAX` abajo. */
export const CHOQUE_MAX = 50;
/**
 * Un bloqueo no puede durar más de un AÑO. No es una regla de negocio: es el
 * cinturón contra el dedazo de año («2027» donde iba «2026»), que dejaría la
 * agenda cerrada para siempre sin que nadie entendiera por qué.
 */
export const BLOQUEO_MAX_DIAS = 366;

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL SOLAPE Y EL ALCANCE — el corazón del archivo
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo que hay que saber de un bloqueo para decidir si tapa un hueco. */
export interface BloqueoLike {
  id?: string;
  /** Null = toda la clínica. */
  doctorId: string | null;
  startsAt: Date;
  endsAt: Date;
  kind?: AgendaBlockKind;
  reason?: string;
  /**
   * Los retirados NO cuentan nunca. Va aquí y no en el `where` de cada
   * consulta para que un caller que lea la tabla entera —o que reciba filas
   * ya cargadas— no pueda saltárselo por olvido.
   */
  deletedAt?: Date | null;
}

/**
 * ¿Dos rangos se pisan?
 *
 * 🔴 SEMIABIERTO POR LA DERECHA: `[inicio, fin)`. TOCAR EL BORDE NO ES
 * SOLAPAR. Un bloqueo de 14:00 a 16:00 NO estorba a una cita que empieza a
 * las 16:00. Con el intervalo cerrado, cerrar la mañana se comería el primer
 * hueco de la tarde y nadie sabría por qué — y es además el mismo criterio
 * con el que la agenda compara citas entre sí (`slotOverlapsBusy` y la
 * constraint EXCLUDE `appt_doctor_no_overlap`).
 */
export function rangosSePisan(
  aInicio: Date,
  aFin: Date,
  bInicio: Date,
  bFin: Date,
): boolean {
  return aInicio.getTime() < bFin.getTime() && aFin.getTime() > bInicio.getTime();
}

/**
 * ¿Este bloqueo alcanza a este doctor?
 *
 * La regla del NULL, escrita UNA sola vez para que no la reimplemente cada
 * consumidor:
 *   · bloqueo con `doctorId = null` → tapa a TODOS los doctores;
 *   · bloqueo con `doctorId = X`    → tapa solo a X.
 *
 * `doctorId` de la pregunta en `null` significa «un hueco sin doctor
 * concreto» (la barra del Mes, una solicitud sin doctor elegido): entonces
 * solo lo tapan los bloqueos de TODA la clínica. Es la respuesta honesta —
 * decir que el hueco está cerrado porque UN doctor se fue de vacaciones sería
 * esconder a los otros tres que sí atienden.
 */
export function bloqueoAlcanzaDoctor(
  bloqueo: { doctorId: string | null },
  doctorId: string | null,
): boolean {
  if (bloqueo.doctorId === null) return true;
  return doctorId !== null && bloqueo.doctorId === doctorId;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL BLOQUEO QUE IMPIDE ESTE HUECO, o `null` si no hay ninguno.
 *
 * Es LA función: la llaman los cinco consumidores y ninguno compara fechas
 * por su cuenta.
 *
 * 🔴 DEVUELVE EL BLOQUEO, NO UN BOOLEANO. Quien choca contra él tiene que
 * poder leer POR QUÉ («Congreso CDMX»); un `false` deja a recepción llamando
 * por teléfono a preguntar, y al bot contestando «no hay nada» a un paciente
 * que solo quería saber cuándo vuelve el doctor.
 *
 * Si varios lo tapan gana el PRIMERO de la lista. La lista llega ordenada por
 * `startsAt` (así la pide `consulta.server.ts`), así que el que se enseña es
 * el que empezó antes, que es el que una persona nombraría.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function bloqueaEsteHueco(
  bloqueos: readonly BloqueoLike[],
  inicio: Date,
  fin: Date,
  doctorId: string | null,
): BloqueoLike | null {
  for (const b of bloqueos) {
    // Los retirados no cuentan NUNCA. Primero, para que ni se mire el resto.
    if (b.deletedAt) continue;
    if (!bloqueoAlcanzaDoctor(b, doctorId)) continue;
    if (rangosSePisan(inicio, fin, b.startsAt, b.endsAt)) return b;
  }
  return null;
}

/**
 * Atajo para quien solo tiene el INICIO y una duración en minutos, que es la
 * forma en que razonan todas las calculadoras de huecos del repo (`"09:30"` +
 * 30 min). Evita que cada una arme su propio `new Date(ini + dur * 60_000)`.
 */
export function bloqueaEsteSlot(
  bloqueos: readonly BloqueoLike[],
  inicioUtc: Date,
  duracionMin: number,
  doctorId: string | null,
): BloqueoLike | null {
  return bloqueaEsteHueco(
    bloqueos,
    inicioUtc,
    new Date(inicioUtc.getTime() + duracionMin * 60_000),
    doctorId,
  );
}

/** El alcance de un bloqueo, para rotularlo. */
export function bloqueoAlcance(b: { doctorId: string | null }): "clinica" | "doctor" {
  return b.doctorId === null ? "clinica" : "doctor";
}

/**
 * El texto que se le enseña a quien chocó con un bloqueo.
 *
 * Lo usan el aviso del staff («esta hora está bloqueada: Congreso CDMX») y el
 * mensaje del bot. Nunca dice de QUIÉN es el bloqueo por nombre: al paciente
 * del otro lado de WhatsApp no le corresponde saber que la doctora está de
 * vacaciones, solo que esa hora no se puede.
 */
export function mensajeDeBloqueo(b: BloqueoLike): string {
  const tipo = b.kind ? BLOQUEO_KIND_LABELS[b.kind] : "Bloqueo";
  const motivo = b.reason ? `: ${b.reason}` : "";
  const alcance = b.doctorId === null ? " (toda la clínica)" : "";
  return `Esa hora está bloqueada${alcance}. ${tipo}${motivo}.`;
}

/**
 * EL AVISO PARA EL STAFF, con la forma de `ScheduleViolation`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 AL STAFF SE LE AVISA, NO SE LE PROHÍBE
 *
 * Es el MISMO criterio con el que `scheduleViolation` trata una cita fuera de
 * horario desde el panel: «Ojo… La cita se guardó de todas formas». Y no es
 * una concesión: quien está en el mostrador con el paciente delante sabe algo
 * que el sistema no. La doctora canceló su congreso y vino; el paciente del
 * 25 es el sobrino del dueño. Un 422 ahí obliga a retirar el bloqueo entero
 * —abriéndoselo al bot, a la web y a Sabina— para meter UNA cita.
 *
 * Lo que sí se bloquea sin excepción es lo que entra por las puertas donde no
 * hay nadie mirando: el bot, la reserva pública, el portal del paciente y
 * Sabina. Ahí un hueco cerrado es un paciente que se presenta a una clínica
 * vacía.
 *
 * Devuelve la forma de `ScheduleViolation` (misma `message`, `openTime` y
 * `closeTime`) porque viaja por el campo `scheduleWarning` que las pantallas
 * del staff ya leen.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function avisoDeBloqueo(b: BloqueoLike): {
  reason: "blocked";
  message: string;
  openTime: null;
  closeTime: null;
} {
  const tipo = b.kind ? BLOQUEO_KIND_LABELS[b.kind] : "Bloqueo";
  const alcance = b.doctorId === null ? "toda la clínica" : "ese doctor";
  return {
    reason: "blocked",
    // «Se guardó de todas formas» es literal y va al final, igual que en
    // `scheduleViolation`: es lo que evita que quien lee el toast crea que
    // perdió la cita y la vuelva a capturar.
    message: `Ojo: esa hora está bloqueada para ${alcance} — ${tipo}${
      b.reason ? `: ${b.reason}` : ""
    }. La cita se guardó de todas formas.`,
    openTime: null,
    closeTime: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS PARSERS
// ═══════════════════════════════════════════════════════════════════════

/** El error que los parsers lanzan. Lleva el status con el que sale por la API. */
export class BloqueoError extends Error {
  status: number;
  /** Código estable para que la pantalla no tenga que leer el texto. */
  codigo: string;
  constructor(mensaje: string, status = 400, codigo = "INVALIDO") {
    super(mensaje);
    this.name = "BloqueoError";
    this.status = status;
    this.codigo = codigo;
  }
}

export function parseMotivo(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < MOTIVO_MIN) {
    throw new BloqueoError(
      "Escribe el motivo del bloqueo. Es lo que se lee en la rejilla, y sin él quien lo vea llama por teléfono.",
      400,
      "MOTIVO_REQUERIDO",
    );
  }
  return v.slice(0, MOTIVO_MAX);
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^(\d{1,2}):(\d{2})$/;

/** `"2026-11-12"` validado, o `null`. */
export function parseDiaISO(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!DIA_RE.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  // Que la fecha EXISTA: "2026-02-31" pasa la regex y no es un día.
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    return null;
  }
  return v;
}

/** `"09:30"` → 570 minutos. `null` si no es una hora del día. */
export function parseMinutoDelDia(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = HORA_RE.exec(raw.trim());
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  if (!Number.isFinite(min) || min < 0 || min > 24 * 60) return null;
  return min;
}

/** `YYYY-MM-DD` desplazado `dias` días. Aritmética de calendario, sin husos. */
export function sumarDiasISO(dia: string, dias: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + dias);
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${dd(t.getUTCMonth() + 1)}-${dd(t.getUTCDate())}`;
}

/** Lo que la pantalla manda: días de calendario y, si acaso, horas. */
export interface RangoTecleado {
  desdeDia?: unknown;
  desdeHora?: unknown;
  hastaDia?: unknown;
  hastaHora?: unknown;
}

/**
 * EL RANGO, de lo que teclea una persona a INSTANTES.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTA CONVERSIÓN LA HACE EL SERVIDOR, Y NO ES UN CAPRICHO
 *
 * Quien cierra un puente escribe «del 15 al 17», no dos instantes UTC. Y «el
 * 15» NO lo puede traducir el navegador: `new Date("2026-09-15T00:00")` se
 * interpreta en la zona del DISPOSITIVO, así que la administradora que abre
 * el panel desde otro huso cerraría la clínica con horas de desfase — y en un
 * cierre de día entero ese desfase se come la primera cita de la mañana o
 * deja abierta la última de la tarde. Se convierte aquí, con la zona de la
 * CLÍNICA, que es la que se le pasa y nunca se adivina.
 *
 * 🔴 «HASTA EL 17» INCLUYE EL 17 ENTERO. El instante que se guarda es la
 * medianoche del 18, porque el intervalo es semiabierto `[inicio, fin)`. Si
 * se guardara la medianoche del 17, el puente terminaría el día antes de lo
 * que dice la pantalla y el 17 la agenda se abriría sola.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function parseRangoTecleado(
  body: RangoTecleado,
  timeZone: string,
): { startsAt: Date; endsAt: Date; diaCompleto: boolean } {
  const desdeDia = parseDiaISO(body?.desdeDia);
  const hastaDia = parseDiaISO(body?.hastaDia);
  if (!desdeDia || !hastaDia) {
    throw new BloqueoError(
      "Elige el día en que empieza el bloqueo y el último día que cubre.",
      400,
      "RANGO_REQUERIDO",
    );
  }
  if (hastaDia < desdeDia) {
    throw new BloqueoError(
      "El último día del bloqueo no puede ser anterior al primero.",
      400,
      "RANGO_INVERTIDO",
    );
  }

  // Las horas son OPCIONALES: sin ellas, el bloqueo es de días completos.
  // Una hora que venga escrita pero ilegible NO se ignora en silencio: se
  // corta, porque ignorarla cerraría el día entero cuando la persona pidió
  // dos horas.
  const hayDesdeHora = body?.desdeHora !== undefined && body?.desdeHora !== null && body?.desdeHora !== "";
  const hayHastaHora = body?.hastaHora !== undefined && body?.hastaHora !== null && body?.hastaHora !== "";
  const desdeMin = hayDesdeHora ? parseMinutoDelDia(body.desdeHora) : null;
  const hastaMin = hayHastaHora ? parseMinutoDelDia(body.hastaHora) : null;
  if ((hayDesdeHora && desdeMin === null) || (hayHastaHora && hastaMin === null)) {
    throw new BloqueoError("Esas horas no se entienden. Usa el formato HH:MM.", 400, "HORA_INVALIDA");
  }
  // Media pareja de horas es ambiguo: «de las 14:00 a…» ¿hasta cuándo?
  if (hayDesdeHora !== hayHastaHora) {
    throw new BloqueoError(
      "Si el bloqueo es por horas, escribe la de inicio y la de fin. Si es el día entero, deja las dos vacías.",
      400,
      "HORA_INCOMPLETA",
    );
  }

  const diaCompleto = !hayDesdeHora;

  const startsAt = tzLocalToUtc(desdeDia, Math.floor((desdeMin ?? 0) / 60), (desdeMin ?? 0) % 60, timeZone);
  // Sin hora de fin, el último día entra ENTERO: el corte es la medianoche
  // del día siguiente. Ver el bloque de arriba.
  const endsAt = diaCompleto
    ? tzLocalToUtc(sumarDiasISO(hastaDia, 1), 0, 0, timeZone)
    : tzLocalToUtc(hastaDia, Math.floor(hastaMin! / 60), hastaMin! % 60, timeZone);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new BloqueoError("Esas fechas no son válidas.", 400, "FECHA_INVALIDA");
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new BloqueoError(
      "El final del bloqueo tiene que ser posterior a su inicio.",
      400,
      "RANGO_INVERTIDO",
    );
  }
  const dias = (endsAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000);
  if (dias > BLOQUEO_MAX_DIAS) {
    throw new BloqueoError(
      `Ese bloqueo dura ${Math.round(dias)} días. El tope es ${BLOQUEO_MAX_DIAS}: revisa el año de las fechas.`,
      400,
      "RANGO_DEMASIADO_LARGO",
    );
  }

  return { startsAt, endsAt, diaCompleto };
}

/** El rango de UN día completo de calendario, en la zona de la clínica. */
export function rangoDeDiaCompleto(
  dia: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: tzLocalToUtc(dia, 0, 0, timeZone),
    endsAt: tzLocalToUtc(sumarDiasISO(dia, 1), 0, 0, timeZone),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LO QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El DTO que devuelven TODAS las rutas y el payload de la agenda. ws1-t3
 * programa contra esta forma, así que no se cambia sin avisar.
 *
 * 🔴 VIVE AQUÍ Y NO EN service.ts, que es donde se produce: ese archivo
 * importa prisma, así que un `import type` desde una pantalla arrastraría el
 * cliente de Prisma al bundle del navegador.
 */
export interface BloqueoDTO {
  id: string;
  doctorId: string | null;
  doctorNombre: string | null;
  kind: AgendaBlockKind;
  reason: string;
  /** Instante ISO. */
  inicio: string;
  /** Instante ISO. */
  fin: string;
  /** Empieza a medianoche y acaba a medianoche: se rotula por días, no por horas. */
  diaCompleto: boolean;
  holidayKey: string | null;
  creadoPor: string;
  creadoEl: string;
  /**
   * 🔴 LO DECIDE EL SERVIDOR según el rol de quien pide. La pantalla no tiene
   * que volver a razonar el permiso: solo enseña o esconde el botón. Si lo
   * razonara ella, el día que cambie la regla habría dos versiones de la
   * verdad y una de ellas enseñaría un botón que devuelve 403.
   */
  puedoRetirarlo: boolean;
}

/** Una cita que estorba a un bloqueo. Es lo que viaja en el 409. */
export interface CitaEnChoque {
  id: string;
  /** `YYYY-MM-DD` en la zona de la clínica. */
  fecha: string;
  /** `HH:MM` en la zona de la clínica. */
  hora: string;
  pacienteNombre: string;
  doctorNombre: string;
  doctorId: string;
}

/** El cuerpo del 409 y la respuesta de `/revision`. */
export interface RespuestaChoque {
  error: "CITAS_EN_EL_RANGO";
  citas: CitaEnChoque[];
  /** Cuántas hay en total; `citas` trae como mucho `CHOQUE_MAX`. */
  total: number;
}

/** ¿Este par de instantes cubre días enteros en esta zona? */
export function esDiaCompleto(inicio: Date, fin: Date, timeZone: string): boolean {
  const i = getTzParts(inicio, timeZone);
  const f = getTzParts(fin, timeZone);
  return i.hour === 0 && i.minute === 0 && f.hour === 0 && f.minute === 0;
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA BANDA QUE PINTA LA REJILLA (para ws1-t3)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Un bloqueo recortado a UN día, en minutos de RELOJ DE PARED.
 *
 * 🔴 MINUTOS DE PARED, no milisegundos desde el inicio del día. La rejilla
 * coloca las citas por su hora local ("08:30" → 510), así que una banda
 * situada por diferencia de instantes se despegaría de las tarjetas
 * exactamente el día del cambio de horario — el único día en que a nadie se
 * le ocurriría mirar.
 */
export interface BandaBloqueo {
  id: string;
  kind: AgendaBlockKind;
  reason: string;
  alcance: "clinica" | "doctor";
  doctorId: string | null;
  /** Minuto del día en que empieza la banda EN ESTE día (0 si viene de antes). */
  desdeMinuto: number;
  /** Minuto del día en que acaba (1440 si sigue mañana). */
  hastaMinuto: number;
  /** Empezó antes de este día. */
  vieneDeAntes: boolean;
  /** Sigue después de este día. */
  sigueDespues: boolean;
  /** Cubre el día de punta a punta: la columna entera está cerrada. */
  todoElDia: boolean;
}

const MINUTOS_DEL_DIA = 24 * 60;

/**
 * LAS BANDAS QUE TAPAN ESTE DÍA EN ESTA COLUMNA.
 *
 * `doctorId` en `null` = la columna es un DÍA entero (la vista Semana o la
 * celda del Mes): entonces entra CUALQUIER bloqueo, porque no hay un doctor
 * contra el que aplicar la regla del NULL. En esa vista la banda significa
 * «hay un cierre ese día» y el detalle lo lleva escrito. Con un `doctorId`
 * concreto (la vista Día, una columna por responsable) se aplica el alcance.
 *
 * Ordenadas por hora de inicio. Se descartan las de duración cero: un bloqueo
 * que termina a las 00:00 de este día NO tapa este día (semiabierto, como
 * todo lo demás).
 */
export function bandasDelDia(
  bloqueos: readonly BloqueoDTO[],
  diaISO: string,
  doctorId: string | null,
  timeZone: string,
): BandaBloqueo[] {
  const out: BandaBloqueo[] = [];
  const dd = (n: number) => String(n).padStart(2, "0");

  for (const b of bloqueos) {
    if (doctorId !== null && !bloqueoAlcanzaDoctor(b, doctorId)) continue;

    const ini = new Date(b.inicio);
    const fin = new Date(b.fin);
    if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) continue;

    const zi = getTzParts(ini, timeZone);
    const zf = getTzParts(fin, timeZone);
    const diaIni = `${zi.year}-${dd(zi.month)}-${dd(zi.day)}`;
    const diaFin = `${zf.year}-${dd(zf.month)}-${dd(zf.day)}`;

    // Fuera de este día por completo. La comparación de días ISO es
    // lexicográfica, y con el formato AAAA-MM-DD eso es exacto.
    if (diaIni > diaISO) continue;
    if (diaFin < diaISO) continue;

    const empiezaAntes = diaIni < diaISO;
    const acabaDespues = diaFin > diaISO;
    const desdeMinuto = empiezaAntes ? 0 : zi.hour * 60 + zi.minute;
    const hastaMinuto = acabaDespues ? MINUTOS_DEL_DIA : zf.hour * 60 + zf.minute;
    if (hastaMinuto <= desdeMinuto) continue;

    // 🔴 «SIGUE MAÑANA» NO ES «ACABA A MEDIANOCHE». Un puente «del 15 al 17»
    // se guarda con el corte en las 00:00 del 18 (el intervalo es
    // semiabierto), así que el 17 acaba justo en el borde y NO continúa. Si
    // `sigueDespues` mirara solo el día, la banda del 17 pintaría la flecha
    // «→» prometiendo un 18 cerrado que la rejilla enseña abierto: la
    // pantalla diría una cosa y el alta otra.
    const sigueDespues =
      acabaDespues && !(zf.hour === 0 && zf.minute === 0 && diaFin === sumarDiasISO(diaISO, 1));

    out.push({
      id: b.id,
      kind: b.kind,
      reason: b.reason,
      alcance: bloqueoAlcance(b),
      doctorId: b.doctorId,
      desdeMinuto,
      hastaMinuto,
      vieneDeAntes: empiezaAntes,
      sigueDespues,
      todoElDia: desdeMinuto <= 0 && hastaMinuto >= MINUTOS_DEL_DIA,
    });
  }

  out.sort((a, b) => a.desdeMinuto - b.desdeMinuto || a.hastaMinuto - b.hastaMinuto);
  return out;
}

/** Una línea para la celda del Mes: «Día festivo · Navidad · toda la clínica». */
export function lineaDeBloqueo(b: {
  kind: AgendaBlockKind;
  reason: string;
  doctorId: string | null;
}): string {
  const alcance = b.doctorId === null ? "toda la clínica" : "un doctor";
  return `${BLOQUEO_KIND_LABELS[b.kind]} · ${b.reason} · ${alcance}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL RASTRO DE QUIEN AGENDÓ SOBRE UN BLOQUEO (WS1-T3)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL RASTRO VA AL REGISTRO DE AUDITORÍA, **NO** A `overrideReason`.
 *
 * El encargo pedía reutilizar las columnas `overrideReason` /
 * `overriddenBy` / `overriddenAt` de la cita, para no inventar un rastro
 * nuevo. Al mirarlo de cerca no se puede, y no por el gate de rol —eso se
 * podía rodear— sino por lo que esa columna ES en la base:
 *
 *   -- prisma/migrations/20260424120000_fase_4_agenda/migration.sql
 *   ALTER TABLE "appointments" ADD CONSTRAINT appt_doctor_no_overlap
 *     EXCLUDE USING gist (…)
 *     WHERE ("status" NOT IN ('CANCELLED','NO_SHOW')
 *            AND "overrideReason" IS NULL);
 *   COMMENT ON CONSTRAINT appt_doctor_no_overlap ON "appointments" IS
 *     '… Admin puede bypasear con overrideReason.';
 *
 * `overrideReason` no es un campo de texto: es la BANDERA que saca la fila
 * del índice de exclusión y apaga el «dos citas no se pisan». Hay otra
 * constraint igual para el sillón, y `overlap-client.ts` hace lo propio en
 * la pantalla (`if (a.overrideReason) continue`) para la rejilla de huecos.
 *
 * Escribir ahí el motivo del bloqueo le habría regalado a cualquiera que
 * pueda crear una cita el bypass de solape que la casa reserva a ADMIN y
 * SUPER_ADMIN — dos citas del mismo doctor a la misma hora, sin 409 y con
 * el hueco pintado como libre. Es exactamente lo contrario de lo que el
 * encargo pedía proteger, y ningún prefijo en el texto lo evita: el filtro
 * lo aplica Postgres sobre `overrideReason IS NULL`, no el código.
 *
 * Así que el rastro va donde va el rastro de todo lo demás: la fila de
 * `AuditLog` que las dos rutas ya escriben con `logMutation` al crear y al
 * editar una cita, con el campo `bloqueoSaltado`. Una sola fila por acción,
 * con quién, cuándo y qué bloqueo se saltó — que es lo que hay que poder
 * responder meses después— y sin tocar ninguna regla de solape.
 *
 * `overrideReason` se queda EXACTAMENTE como estaba: mismo gate, mismos
 * valores, mismo significado.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const TRAZA_BLOQUEO_PREFIJO = "Bloqueo: ";

/**
 * «Bloqueo: Mantenimiento de clínica» — lo que se escribe en la auditoría.
 *
 * Lleva el MOTIVO que escribió la persona, no la etiqueta del tipo: es lo que
 * explica el hueco meses después, cuando nadie recuerde qué pasó ese día. Sin
 * motivo, la etiqueta del tipo como último recurso.
 */
export function trazaDeBloqueo(b: BloqueoLike): string {
  const motivo = (b.reason ?? "").trim();
  const tipo = b.kind ? BLOQUEO_KIND_LABELS[b.kind] : null;
  if (!motivo) return `${TRAZA_BLOQUEO_PREFIJO}${tipo ?? "sin motivo"}`;
  return `${TRAZA_BLOQUEO_PREFIJO}${motivo}`.slice(0, MOTIVO_MAX + TRAZA_BLOQUEO_PREFIJO.length);
}

/**
 * EL BLOQUEO QUE TAPA ESTE HUECO, partiendo del DTO que viaja a la pantalla.
 *
 * Es `bloqueaEsteHueco` con la conversión de ISO a `Date` hecha una sola vez y
 * en un sitio: las tres pantallas que preguntan «¿este hueco cae en un
 * bloqueo?» (alta, reagendar, arrastrar) tienen que responder lo MISMO que el
 * servidor, y la única manera es que llamen a la misma función. Una tercera
 * comparación de fechas escrita a mano en un componente es exactamente lo que
 * el encabezado de este archivo dice que no se haga.
 *
 * Pura y client-safe: no toca la red ni el reloj.
 */
export function bloqueoQueTapa(
  bloqueos: readonly {
    id: string;
    doctorId: string | null;
    doctorNombre?: string | null;
    kind?: AgendaBlockKind;
    reason: string;
    inicio: string;
    fin: string;
    /** Los retirados no cuentan NUNCA, igual que en `bloqueaEsteHueco`. */
    deletedAt?: string | Date | null;
  }[],
  inicioISO: string,
  finISO: string,
  doctorId: string | null,
): {
  id: string;
  doctorId: string | null;
  doctorNombre: string | null;
  kind?: AgendaBlockKind;
  reason: string;
  inicio: string;
  fin: string;
} | null {
  const inicio = new Date(inicioISO);
  const fin = new Date(finISO);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;

  for (const b of bloqueos) {
    // Primero, para que ni se mire el resto — el mismo orden que
    // `bloqueaEsteHueco`. Hoy el DTO no trae el campo, pero si un día lo trae
    // (o alguien pasa filas de la tabla) un bloqueo retirado no puede hacer
    // saltar un aviso que el servidor no va a dar.
    if (b.deletedAt) continue;
    const bIni = new Date(b.inicio);
    const bFin = new Date(b.fin);
    if (Number.isNaN(bIni.getTime()) || Number.isNaN(bFin.getTime())) continue;
    const tapa = bloqueaEsteHueco(
      [{ doctorId: b.doctorId, startsAt: bIni, endsAt: bFin }],
      inicio,
      fin,
      doctorId,
    );
    if (tapa) return { ...b, doctorNombre: b.doctorNombre ?? null };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · ¿QUIÉN PUEDE AGENDAR ENCIMA DE UN BLOQUEO? (WS1-T5)
// ═══════════════════════════════════════════════════════════════════════

/**
 * El ajuste de la clínica («¿Recepción puede agendar sobre un día
 * bloqueado?») resuelto PARA QUIEN PREGUNTA. Una sola función para las tres
 * puertas que lo necesitan: el GET de la política (lo que lee la ventana de
 * confirmar), el POST y el PATCH de la cita (el candado de verdad).
 *
 *   · «Sí» (de fábrica) → todo el que ya podía agendar, como siempre: aviso,
 *     confirmación y rastro en `AuditLog`.
 *   · «No» → solo quien puede editar la configuración de la clínica
 *     (`settings.edit`). Es quien decide el ajuste: prohibírselo a él solo le
 *     obligaría a apagarlo, agendar y volver a encenderlo. Recepción, los
 *     doctores sin esa llave y Sabina —que agenda con los permisos de quien
 *     la usa— quedan fuera.
 */
export function puedeAgendarEncima(
  recepcionPuedeAgendar: boolean,
  puedeEditarAjustes: boolean,
): boolean {
  return recepcionPuedeAgendar || puedeEditarAjustes;
}

/**
 * La frase del rechazo. Es la que pinta la pantalla: el código no se enseña
 * nunca.
 *
 * Dice el TIPO y el alcance, y no el motivo escrito: el rechazo le puede
 * llegar a un doctor que agenda para una compañera con un bloqueo personal, y
 * `listarBloqueos` ya decidió no enseñarle ese motivo («operación de
 * rodilla»). Quien sí puede verlo ya lo vio en la ventana de confirmar.
 */
export function fraseBloqueoProhibido(b: BloqueoLike): string {
  const tipo = b.kind ? BLOQUEO_KIND_LABELS[b.kind].toLowerCase() : "bloqueo";
  const alcance = b.doctorId === null ? "toda la clínica" : "ese doctor";
  return (
    `Esa hora está bloqueada para ${alcance} (${tipo}) y la clínica no permite agendar encima. ` +
    "Elige otro día u hora; lo decide la administración en Configuración → Horarios y bloqueos."
  );
}
