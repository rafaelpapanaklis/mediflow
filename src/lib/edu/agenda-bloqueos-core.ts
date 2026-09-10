/**
 * DaleControl INSTITUCIONAL — LOS BLOQUEOS DE AGENDA · la parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido. El solape, el alcance por sede/sillón y los
 * parsers. Lo que toca la base vive en agenda-bloqueos.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (H-19, «el hueco más caro de la lista»)
 *
 * «No existe el BLOQUEO: no hay forma de cerrar un puente ni de sacar un
 * sillón por mantenimiento. No hay ningún modelo de cierre/festivo en el
 * schema. El sillón 7 se descompone el martes: o cambias el horario
 * semanal (y afecta TODOS los martes), o das de baja el sillón (que no
 * cancela nada). La agenda ofrece huecos que no existen.»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ALCANCE LO DA LO QUE ESTÉ EN NULL. Es toda la tabla en tres líneas:
 *   · sin sede y sin sillón → el INSTITUTO entero (un festivo nacional);
 *   · con sede y sin sillón → esa SEDE (el puente del campus norte);
 *   · con sillón            → ese SILLÓN (el 7 en mantenimiento).
 *
 * ⚠️ UN BLOQUEO NO CANCELA LAS CITAS QUE YA ESTÁN. Bloquear es cerrar el
 * hueco para lo que venga; lo que ya estaba agendado se reagenda a mano,
 * con su aviso al paciente. Un bloqueo que cancela citas en cascada es una
 * pantalla que borra la tarde de alguien sin que nadie lo decida — y las
 * citas de este producto se cancelan con motivo y con recordatorio, no en
 * silencio.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  eduFormatDayLong,
  eduMinutesToLabel,
  eduShiftDayISO,
  eduUtcToZoned,
  eduZonedToUtc,
  parseEduDayISO,
  parseEduMinuteOfDay,
} from "@/lib/edu/agenda-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL TIPO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Espejo 1:1 del enum `EduAgendaBlockKind` de Prisma, escrito como unión
 * de strings para poder importarlo desde componentes "use client". El
 * candado de que no se desincronicen es un chequeo de TIPOS en
 * edu-agenda-bloqueos.test.ts.
 */
export type EduAgendaBlockKind = "FESTIVO" | "PUENTE" | "MANTENIMIENTO" | "OTRO";

export const EDU_BLOCK_KINDS: EduAgendaBlockKind[] = [
  "FESTIVO",
  "PUENTE",
  "MANTENIMIENTO",
  "OTRO",
];

export const EDU_BLOCK_KIND_LABELS: Record<EduAgendaBlockKind, string> = {
  FESTIVO: "Día festivo",
  PUENTE: "Puente o vacaciones",
  MANTENIMIENTO: "Mantenimiento",
  OTRO: "Otro",
};

export const EDU_BLOCK_KIND_DESCRIPTIONS: Record<EduAgendaBlockKind, string> = {
  FESTIVO: "Día festivo oficial: la clínica no abre.",
  PUENTE: "Puente, periodo vacacional o semana de exámenes.",
  MANTENIMIENTO: "El sillón está descompuesto o en servicio. Suele ser de un solo sillón.",
  OTRO: "Cualquier otra cosa; manda el motivo que escribas.",
};

export function eduBlockParseKind(raw: unknown): EduAgendaBlockKind {
  if (typeof raw !== "string") return "OTRO";
  const v = raw.trim().toUpperCase();
  return (EDU_BLOCK_KINDS as string[]).includes(v) ? (v as EduAgendaBlockKind) : "OTRO";
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS TOPES
// ═══════════════════════════════════════════════════════════════════════

export const EDU_BLOCK_REASON_MAX = 200;
/** Tope de bloqueos que se leen de un rango. */
export const EDU_BLOCK_MAX_ROWS = 200;
/**
 * Un bloqueo no puede durar más de un AÑO. No es una regla de negocio: es
 * el cinturón contra el dedazo de año («2027» donde iba «2026»), que
 * dejaría la agenda de la escuela cerrada para siempre sin que nadie
 * entendiera por qué.
 */
export const EDU_BLOCK_MAX_DIAS = 366;

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL SOLAPE
// ═══════════════════════════════════════════════════════════════════════

export interface EduBlockLike {
  id?: string;
  campusId: string | null;
  chairId: string | null;
  startsAt: Date;
  endsAt: Date;
  kind?: EduAgendaBlockKind;
  reason?: string;
}

/**
 * ¿Dos rangos se pisan?
 *
 * 🔴 SEMIABIERTO POR LA DERECHA: `[inicio, fin)`. Un bloqueo que termina a
 * las 14:00 y una cita que empieza a las 14:00 NO se pisan. Con el
 * intervalo cerrado, cerrar la mañana bloquearía el primer hueco de la
 * tarde y nadie sabría por qué — es el mismo criterio con el que la
 * agenda del vertical compara citas entre sí.
 */
export function eduRangosSePisan(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/**
 * ¿Este bloqueo alcanza a este sillón?
 *
 * La regla del NULL, escrita una sola vez para que no la reimplemente cada
 * pantalla: un bloqueo del instituto alcanza a todos, uno de sede alcanza
 * a los sillones de esa sede, y uno de sillón solo al suyo.
 */
export function eduBlockAlcanzaSillon(
  block: { campusId: string | null; chairId: string | null },
  chair: { id: string; campusId: string },
): boolean {
  if (block.chairId) return block.chairId === chair.id;
  if (block.campusId) return block.campusId === chair.campusId;
  return true;
}

/**
 * El bloqueo que impide agendar en este hueco, o null si no hay ninguno.
 *
 * 🔴 DEVUELVE EL BLOQUEO, NO UN BOOLEANO. Quien intenta agendar tiene que
 * poder leer POR QUÉ no puede («Puente del 15 al 17 · Campus Norte»); un
 * `false` deja a recepción llamando por teléfono a preguntar.
 */
export function eduBlockQueImpide(
  bloques: EduBlockLike[],
  hueco: { startsAt: Date; endsAt: Date; chair: { id: string; campusId: string } },
): EduBlockLike | null {
  for (const b of bloques) {
    if (!eduBlockAlcanzaSillon(b, hueco.chair)) continue;
    if (eduRangosSePisan(b, hueco)) return b;
  }
  return null;
}

/** El texto que se le enseña a quien chocó con un bloqueo. */
export function eduBlockMensaje(block: EduBlockLike): string {
  const kind = block.kind ? EDU_BLOCK_KIND_LABELS[block.kind] : "Bloqueo";
  const motivo = block.reason ? `: ${block.reason}` : "";
  const alcance = block.chairId ? " (ese sillón)" : block.campusId ? " (esa sede)" : " (todo el instituto)";
  return `Esa hora está bloqueada${alcance}. ${kind}${motivo}.`;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS PARSERS
// ═══════════════════════════════════════════════════════════════════════

export function eduBlockParseReason(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 3) {
    throw new Error(
      "Escribe el motivo del bloqueo. Es lo que se lee en la rejilla, y sin él quien lo vea llama por teléfono.",
    );
  }
  return v.slice(0, EDU_BLOCK_REASON_MAX);
}

/**
 * El rango, validado.
 *
 * Tres cosas y las tres tienen víctima: una fecha ilegible deja la agenda
 * cerrada en un instante desconocido; un fin antes del inicio no bloquea
 * nada y la pantalla dice que sí; y un rango de dos años cierra la escuela
 * hasta que alguien lo encuentre.
 */
export function eduBlockParseRango(
  rawInicio: unknown,
  rawFin: unknown,
): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(String(rawInicio ?? ""));
  const endsAt = new Date(String(rawFin ?? ""));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Las fechas del bloqueo no se entienden. Manda las dos en formato ISO.");
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("El final del bloqueo tiene que ser posterior a su inicio.");
  }
  const dias = (endsAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000);
  if (dias > EDU_BLOCK_MAX_DIAS) {
    throw new Error(
      `Ese bloqueo dura ${Math.round(dias)} días. El tope es ${EDU_BLOCK_MAX_DIAS}: revisa el año de las fechas.`,
    );
  }
  return { startsAt, endsAt };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LO QUE VIAJA A LA PANTALLA (Ola C·2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Un bloqueo tal como lo recibe un componente "use client": las dos fechas
 * ya en texto ISO.
 *
 * 🔴 VIVE AQUÍ Y NO EN agenda-bloqueos.ts, que es donde se produce. Ese
 * archivo importa prisma, así que un `import type` desde una pantalla
 * arrastraría el cliente de Prisma al bundle del navegador. Es la misma
 * razón por la que `EduAppointmentRow` vive en agenda-core.
 */
export interface EduBloqueoVista {
  id: string;
  kind: EduAgendaBlockKind;
  reason: string;
  campusId: string | null;
  chairId: string | null;
  /** ISO. */
  startsAt: string;
  /** ISO. */
  endsAt: string;
  createdByName: string;
}

/** "todo el instituto" · "esa sede" · "ese sillón". Una sola vez. */
export type EduBloqueoAlcance = "instituto" | "sede" | "sillon";

export function eduBloqueoAlcance(b: {
  campusId: string | null;
  chairId: string | null;
}): EduBloqueoAlcance {
  if (b.chairId) return "sillon";
  if (b.campusId) return "sede";
  return "instituto";
}

export const EDU_BLOCK_ALCANCE_LABELS: Record<EduBloqueoAlcance, string> = {
  instituto: "Todo el instituto",
  sede: "Toda la sede",
  sillon: "Solo ese sillón",
};

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA BANDA QUE PINTA LA REJILLA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Un bloqueo recortado a UN día, en minutos de reloj de pared.
 *
 * 🔴 MINUTOS DE PARED, no milisegundos desde el inicio del día. La rejilla
 * coloca las citas por su `startLabel` ("08:30" → 510), así que una banda
 * situada por diferencia de instantes se despegaría de las tarjetas
 * exactamente el día del cambio de horario — el único día en que a nadie se
 * le ocurriría mirar. Se convierte con `eduUtcToZoned`, igual que la cita.
 */
export interface EduBloqueoBanda {
  id: string;
  kind: EduAgendaBlockKind;
  reason: string;
  alcance: EduBloqueoAlcance;
  /** Minuto del día en que empieza la banda EN ESTE día (0 si viene de antes). */
  startMinute: number;
  /** Minuto del día en que termina (1440 si sigue mañana). */
  endMinute: number;
  /** Empezó antes de este día. */
  desdeAntes: boolean;
  /** Sigue después de este día. */
  hastaDespues: boolean;
  /** Cubre el día de punta a punta: la columna entera está cerrada. */
  todoElDia: boolean;
}

const MINUTOS_DEL_DIA = 24 * 60;

/**
 * LOS BLOQUEOS QUE TAPAN ESTE DÍA EN ESTA COLUMNA.
 *
 * `chair` en null = la columna es un DÍA (la vista de semana, o Mi día):
 * entonces alcanza cualquier bloqueo, porque no hay un sillón contra el que
 * aplicar la regla del NULL. Se dice y no se disimula: en semana la banda
 * significa "hay un cierre ese día", y el detalle (qué sede, qué sillón) lo
 * lleva escrito.
 *
 * Devuelve las bandas ordenadas por hora de inicio, y descarta las de
 * duración cero: un bloqueo que termina a las 00:00 de este día NO tapa
 * este día (el intervalo es semiabierto, como en todo el vertical).
 */
export function eduBloqueoBandasDelDia(
  bloqueos: readonly EduBloqueoVista[],
  dayISO: string,
  chair: { id: string; campusId: string } | null,
  timeZone: string,
): EduBloqueoBanda[] {
  const out: EduBloqueoBanda[] = [];
  for (const b of bloqueos) {
    if (chair && !eduBlockAlcanzaSillon(b, chair)) continue;

    const ini = new Date(b.startsAt);
    const fin = new Date(b.endsAt);
    if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) continue;

    const zi = eduUtcToZoned(ini, timeZone);
    const zf = eduUtcToZoned(fin, timeZone);
    // Fuera de este día por completo. La comparación de días ISO es
    // lexicográfica y eso es exacto con el formato AAAA-MM-DD.
    if (zi.dayISO > dayISO) continue;
    if (zf.dayISO < dayISO) continue;

    const empiezaAntes = zi.dayISO < dayISO;
    const acabaDespues = zf.dayISO > dayISO;
    const startMinute = empiezaAntes ? 0 : zi.minuteOfDay;
    const endMinute = acabaDespues ? MINUTOS_DEL_DIA : zf.minuteOfDay;
    if (endMinute <= startMinute) continue;

    // 🔴 «SIGUE MAÑANA» NO ES «ACABA A MEDIANOCHE». Un puente «del 15 al
    // 17» se guarda con el corte en las 00:00 del 18 (el intervalo es
    // semiabierto), así que el 17 acaba justo en el borde y NO continúa: si
    // `hastaDespues` mirara solo el día, la banda del 17 pintaría la flecha
    // «→» prometiendo un 18 cerrado que la rejilla enseña abierto — la
    // pantalla diría una cosa y el alta otra.
    const hastaDespues =
      acabaDespues && !(zf.minuteOfDay === 0 && zf.dayISO === eduShiftDayISO(dayISO, 1));
    const desdeAntes = empiezaAntes;

    out.push({
      id: b.id,
      kind: b.kind,
      reason: b.reason,
      alcance: eduBloqueoAlcance(b),
      startMinute,
      endMinute,
      desdeAntes,
      hastaDespues,
      todoElDia: startMinute <= 0 && endMinute >= MINUTOS_DEL_DIA,
    });
  }
  out.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  return out;
}

/**
 * Una línea para la tarjeta de Mi día y para el aviso de la rejilla:
 * «Puente o vacaciones · Fiestas patrias · todo el instituto».
 */
export function eduBloqueoLinea(b: {
  kind: EduAgendaBlockKind;
  reason: string;
  campusId: string | null;
  chairId: string | null;
}): string {
  return `${EDU_BLOCK_KIND_LABELS[b.kind]} · ${b.reason} · ${EDU_BLOCK_ALCANCE_LABELS[
    eduBloqueoAlcance(b)
  ].toLowerCase()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL RANGO TAL COMO LO TECLEA UNA PERSONA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El rango a partir de DÍAS (y horas opcionales) de calendario, en la zona
 * de la escuela.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ NO BASTA CON `eduBlockParseRango` Y SU ISO
 *
 * Quien cierra un puente escribe «del 15 al 17», no dos instantes UTC. Y la
 * traducción de «el 15» a un instante NO la puede hacer el navegador: un
 * `new Date("2026-09-15T00:00")` se interpreta en la zona del DISPOSITIVO,
 * así que la coordinadora que abre el panel desde su casa en otro huso
 * cerraría la clínica con dos horas de desfase — y en un cierre de día
 * entero ese desfase se come la primera cita de la mañana o deja abierta la
 * última de la tarde. La conversión se hace aquí, con la zona de la SEDE.
 *
 * 🔴 «HASTA EL 17» INCLUYE EL 17 ENTERO. El instante que se guarda es la
 * medianoche del 18, porque el intervalo es semiabierto `[inicio, fin)` en
 * todo el vertical. Si se guardara la medianoche del 17, el puente
 * terminaría el día antes de lo que dice la pantalla y el lunes 17 la
 * agenda se abriría sola.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduBlockParseRangoLocal(
  body: {
    desdeDia?: unknown;
    desdeHora?: unknown;
    hastaDia?: unknown;
    hastaHora?: unknown;
  },
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const desdeDia = parseEduDayISO(body?.desdeDia);
  const hastaDia = parseEduDayISO(body?.hastaDia);
  if (!desdeDia || !hastaDia) {
    throw new Error("Elige el día en que empieza el bloqueo y el último día que cubre.");
  }

  const desdeMin = parseEduMinuteOfDay(body?.desdeHora);
  const hastaMin = parseEduMinuteOfDay(body?.hastaHora);

  const startsAt = eduZonedToUtc(desdeDia, desdeMin ?? 0, timeZone);
  // Sin hora de fin, el último día entra ENTERO: el corte es la medianoche
  // del día siguiente. Ver el bloque de arriba.
  const endsAt =
    hastaMin === null
      ? eduZonedToUtc(eduShiftDayISO(hastaDia, 1), 0, timeZone)
      : eduZonedToUtc(hastaDia, hastaMin, timeZone);

  if (!startsAt || !endsAt) {
    throw new Error("Esas fechas no son válidas.");
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("El final del bloqueo tiene que ser posterior a su inicio.");
  }
  const dias = (endsAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000);
  if (dias > EDU_BLOCK_MAX_DIAS) {
    throw new Error(
      `Ese bloqueo dura ${Math.round(dias)} días. El tope es ${EDU_BLOCK_MAX_DIAS}: revisa el año de las fechas.`,
    );
  }
  return { startsAt, endsAt };
}

/**
 * «Del martes 15 de septiembre al jueves 17 de septiembre» o «El martes 15
 * de septiembre, de 09:00 a 14:00», en la zona que se le pase.
 *
 * 🔴 SE LE PASA LA ZONA Y NO SE ADIVINA. La misma función la llaman el
 * servidor (que renderiza la lista) y el navegador (que la vuelve a pintar
 * tras guardar): con la zona explícita las dos dan el MISMO texto y no hay
 * discrepancia de hidratación. Sin ella, el servidor diría "15 de
 * septiembre" y el teléfono de quien esté en otro huso diría "14".
 */
export function eduBloqueoRangoLabel(
  startsAtISO: string,
  endsAtISO: string,
  timeZone: string,
): string {
  const ini = new Date(startsAtISO);
  const fin = new Date(endsAtISO);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) return "—";

  const zi = eduUtcToZoned(ini, timeZone);
  const zf = eduUtcToZoned(fin, timeZone);

  // Un rango que acaba a medianoche cubre el día ANTERIOR entero: se
  // rotula con ese día, que es el que la persona tecleó.
  const finEsMedianoche = zf.minuteOfDay === 0;
  const ultimoDia = finEsMedianoche ? eduShiftDayISO(zf.dayISO, -1) : zf.dayISO;

  const diaEntero = zi.minuteOfDay === 0 && finEsMedianoche;

  if (diaEntero) {
    return ultimoDia === zi.dayISO
      ? `El ${eduFormatDayLong(zi.dayISO)}, todo el día`
      : `Del ${eduFormatDayLong(zi.dayISO)} al ${eduFormatDayLong(ultimoDia)}`;
  }
  if (zi.dayISO === zf.dayISO) {
    return `El ${eduFormatDayLong(zi.dayISO)}, de ${eduMinutesToLabel(
      zi.minuteOfDay,
    )} a ${eduMinutesToLabel(zf.minuteOfDay)}`;
  }
  return `Del ${eduFormatDayLong(zi.dayISO)} ${eduMinutesToLabel(zi.minuteOfDay)} al ${eduFormatDayLong(
    zf.dayISO,
  )} ${eduMinutesToLabel(zf.minuteOfDay)}`;
}
