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
