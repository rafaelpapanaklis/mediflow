/**
 * DaleControl INSTITUCIONAL — EL PLAN DE TRATAMIENTO · la parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido (el `now` se pasa siempre). Los estados, el
 * avance, los KPI y la próxima fecha. Lo que toca la base vive en
 * plan-tratamiento.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (fila 25 del informe ws2-t1)
 *
 * «`EduCase` cubre "qué caso y de quién", pero `EduProcedure` es el
 * TARIFARIO del instituto, no un plan por paciente con sesiones y avance.»
 * O sea: la escuela sabe de quién es el caso y cuánto cuesta cada cosa, y
 * no sabe cuántas sesiones lleva la señora ni cuántas le faltan.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL AVANCE NO SE GUARDA EN NINGUNA COLUMNA: SE CUENTA.
 *
 * Es la misma decisión que la cuota de almacenamiento y el cupo de IA, y
 * por la misma razón escrita en el esquema: un contador guardado se
 * desincroniza el día que una escritura falle a la mitad, y entonces o le
 * cierras el plan a quien no ha terminado o le abres uno terminado. Las
 * sesiones hechas se cuentan con `completedAt IS NOT NULL`, y ya.
 *
 * 🔴 EL ESTADO NO SE DERIVA DEL AVANCE. Un plan con todas sus sesiones
 * hechas sigue ACTIVO hasta que alguien lo CIERRA, porque cerrar es un
 * acto con autor y fecha. Y ABANDONADO —el paciente que dejó de venir— es
 * lo contrario de COMPLETADO aunque las dos cosas se vean igual desde la
 * tabla: distinguirlas es media estadística de una escuela.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ESTADO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Espejo 1:1 del enum `EduTreatmentPlanStatus` de Prisma, escrito como
 * unión de strings para poder importarlo desde componentes "use client"
 * sin arrastrar el runtime de Prisma al navegador — igual que todos los
 * anteriores del vertical. El candado de que no se desincronicen es un
 * chequeo de TIPOS en edu-plan-tratamiento.test.ts.
 */
export type EduTreatmentPlanStatus = "ACTIVO" | "PAUSADO" | "COMPLETADO" | "ABANDONADO";

export const EDU_PLAN_STATUSES: EduTreatmentPlanStatus[] = [
  "ACTIVO",
  "PAUSADO",
  "COMPLETADO",
  "ABANDONADO",
];

export const EDU_PLAN_STATUS_LABELS: Record<EduTreatmentPlanStatus, string> = {
  ACTIVO: "Activo",
  PAUSADO: "En pausa",
  COMPLETADO: "Terminado",
  ABANDONADO: "Abandonado",
};

export const EDU_PLAN_STATUS_DESCRIPTIONS: Record<EduTreatmentPlanStatus, string> = {
  ACTIVO: "En curso. Se le pueden marcar sesiones y aparece en el seguimiento.",
  PAUSADO:
    "Parado a propósito (el paciente pidió esperar, falta una autorización). Sigue vivo y no cuenta como atrasado.",
  COMPLETADO: "Terminado, con fecha y con quién lo cerró.",
  ABANDONADO: "El paciente dejó de venir. Se cierra con motivo; no es lo mismo que terminado.",
};

/**
 * A qué estados puede pasar un plan desde donde está, escrito como DATO y
 * no como un `if` que alguien puede olvidar en el segundo endpoint — el
 * mismo patrón que `EDU_PRESCRIPTION_TRANSITIONS`.
 *
 * COMPLETADO y ABANDONADO son terminales: un plan cerrado no se reabre, se
 * abre otro. Reabrir dejaría un `closedAt` mintiendo.
 */
export const EDU_PLAN_TRANSITIONS: Record<EduTreatmentPlanStatus, EduTreatmentPlanStatus[]> = {
  ACTIVO: ["PAUSADO", "COMPLETADO", "ABANDONADO"],
  PAUSADO: ["ACTIVO", "COMPLETADO", "ABANDONADO"],
  COMPLETADO: [],
  ABANDONADO: [],
};

/** Los dos estados que CIERRAN el plan y exigen `closedAt` + motivo. */
export const EDU_PLAN_STATUSES_CERRADOS: EduTreatmentPlanStatus[] = ["COMPLETADO", "ABANDONADO"];

export function eduPlanPuedeTransicionar(
  desde: EduTreatmentPlanStatus,
  hasta: EduTreatmentPlanStatus,
): boolean {
  return (EDU_PLAN_TRANSITIONS[desde] ?? []).includes(hasta);
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS TOPES
// ═══════════════════════════════════════════════════════════════════════

export const EDU_PLAN_NAME_MAX = 160;
export const EDU_PLAN_DESC_MAX = 2000;
export const EDU_PLAN_SESSION_NOTES_MAX = 2000;
/** Tope de sesiones de un plan. Cien es un tratamiento de ortodoncia largo. */
export const EDU_PLAN_MAX_SESIONES = 100;
/** Tope de planes que se listan de un paciente. */
export const EDU_PLAN_MAX_ROWS = 50;

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL AVANCE Y LOS KPI
// ═══════════════════════════════════════════════════════════════════════

export interface EduPlanSesionLike {
  sessionNumber: number;
  completedAt: Date | null;
}

export interface EduPlanKpis {
  /** Sesiones con `completedAt`. */
  hechas: number;
  /** El total: el mayor entre lo estimado y lo que de verdad hay. */
  total: number;
  /** 0-100, entero. */
  avance: number;
  /** La primera sesión sin hacer, o null si no queda ninguna. */
  siguienteNumero: number | null;
  /** Cuándo se hizo la última. */
  ultimaHechaAt: Date | null;
}

/**
 * El avance de un plan.
 *
 * 🔴 EL TOTAL ES EL MAYOR ENTRE LO ESTIMADO Y LO REAL, y eso no es un
 * apaño: `totalSessions` es la ESTIMACIÓN con la que se abrió el plan, y
 * un tratamiento se alarga. Con el estimado a secas, la sesión 13 de un
 * plan de 12 daría un avance del 108 % — un número que nadie puede
 * explicarle a un paciente. Con el mayor de los dos, el plan que se
 * alarga baja su porcentaje, que es exactamente lo que pasó de verdad.
 */
export function eduPlanKpis(
  sesiones: EduPlanSesionLike[],
  totalEstimado: number,
): EduPlanKpis {
  const hechas = sesiones.filter((s) => s.completedAt !== null).length;
  const total = Math.max(totalEstimado > 0 ? totalEstimado : 0, sesiones.length, hechas, 1);
  const avance = Math.min(100, Math.round((hechas / total) * 100));

  const pendientes = sesiones
    .filter((s) => s.completedAt === null)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  // Si no hay ninguna fila pendiente pero todavía faltan sesiones para
  // llegar al estimado, la siguiente es la que sigue por número.
  const siguienteNumero =
    pendientes.length > 0
      ? pendientes[0].sessionNumber
      : hechas < total
        ? hechas + 1
        : null;

  const hechasOrdenadas = sesiones
    .filter((s): s is EduPlanSesionLike & { completedAt: Date } => s.completedAt !== null)
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  return {
    hechas,
    total,
    avance,
    siguienteNumero,
    ultimaHechaAt: hechasOrdenadas[0]?.completedAt ?? null,
  };
}

/**
 * La PRÓXIMA fecha esperada: la última sesión hecha más el intervalo.
 *
 * Si no hay ninguna hecha, se cuenta desde el arranque del plan. Devuelve
 * null cuando ya no queda nada por hacer — un plan sin siguiente sesión no
 * tiene siguiente fecha, y dejar una puesta lo haría salir en la lista de
 * atrasados para siempre.
 */
export function eduPlanProximaFecha(
  kpis: EduPlanKpis,
  startsAt: Date,
  sessionIntervalDays: number,
): Date | null {
  if (kpis.siguienteNumero === null) return null;
  const dias = sessionIntervalDays > 0 ? sessionIntervalDays : 30;
  const base = kpis.ultimaHechaAt ?? startsAt;
  return new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
}

/** ¿Este plan está atrasado a la fecha `now`? */
export function eduPlanAtrasado(
  status: EduTreatmentPlanStatus,
  nextExpectedAt: Date | null,
  now: Date,
): boolean {
  if (status !== "ACTIVO") return false;
  if (!nextExpectedAt) return false;
  return nextExpectedAt.getTime() < now.getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS PARSERS
// ═══════════════════════════════════════════════════════════════════════

export function eduPlanParseStatus(raw: unknown): EduTreatmentPlanStatus | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return (EDU_PLAN_STATUSES as string[]).includes(v) ? (v as EduTreatmentPlanStatus) : null;
}

export function eduPlanParseNombre(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 2) {
    throw new Error("El plan necesita un nombre («Ortodoncia 18 meses», «Rehabilitación»).");
  }
  return v.slice(0, EDU_PLAN_NAME_MAX);
}

/**
 * Un entero dentro de un rango, con el mensaje escrito para una persona.
 *
 * 🔴 SE VALIDA AQUÍ Y NO SOLO EN LA BASE. Un `INTEGER` de Postgres acepta
 * 2 000 000 000 sesiones tan contento, y el error que devolvería sería uno
 * de tipo de dato en inglés en la cara de quien está capturando un plan.
 */
export function eduPlanParseEntero(
  raw: unknown,
  campo: string,
  min: number,
  max: number,
  porDefecto: number,
): number {
  if (raw === undefined || raw === null || raw === "") return porDefecto;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${campo} tiene que ser un número entero entre ${min} y ${max}.`);
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LAS PARTIDAS DEL TARIFARIO
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTO ES UN APAÑO, Y SE DICE ANTES DE QUE NADIE LO DESCUBRA SOLO.
 *
 * Un plan de tratamiento se arma con PARTIDAS del tarifario («endodoncia
 * unirradicular ×1, resina ×3»), y de ahí sale su importe. Lo que la base
 * tiene hoy es UNA columna: `edu_treatment_plans.totalCents`. No existe
 * `edu_treatment_plan_items`, y la Ola C·2 no añade SQL (el de la ola ya
 * está escrito y aplicado; ver el punto 6 del reporte, con el nombre
 * exacto de la tabla que falta).
 *
 * Así que las partidas se guardan en `description` —que es texto y ya
 * existe— dentro de un bloque MARCADO, escrito SOLO por el servidor y en
 * un formato canónico que este módulo sabe leer. No es bonito y no
 * pretende serlo: es lo que permite que «convertir el plan en
 * presupuesto» mande las partidas de verdad y no un renglón único con el
 * total.
 *
 * 🔴 EL PARSER ES TOLERANTE A PROPÓSITO. Si el bloque no está, o alguien
 * lo editó a mano, devuelve `[]` y quien llama cae en el total del plan.
 * Un parser que lanza sobre una columna de texto libre convierte una
 * descripción rara en una pantalla en blanco.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_PLAN_PARTIDAS_MARCA = "— Partidas del tarifario —";

/** Tope de partidas de un plan. El mismo que el del presupuesto. */
export const EDU_PLAN_MAX_PARTIDAS = 30;

export interface EduPlanPartida {
  /** El nombre del procedimiento, congelado. Un tarifario que cambia de
   *  nombre mañana no reescribe lo que se le presupuestó a alguien. */
  name: string;
  quantity: number;
  unitPriceCents: number;
}

/** Un nombre que el formato canónico puede escribir y volver a leer. */
function limpiarNombre(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, " ")
    .replace(/[×@]/g, "-")
    .trim()
    .slice(0, 120);
}

/** El bloque canónico. Una línea por partida: `· nombre ×cant @ centavos`. */
export function eduPlanPartidasSerializar(partidas: EduPlanPartida[]): string {
  if (partidas.length === 0) return "";
  const lineas = partidas
    .slice(0, EDU_PLAN_MAX_PARTIDAS)
    .map((p) => `· ${limpiarNombre(p.name)} ×${p.quantity} @ ${p.unitPriceCents}`);
  return [EDU_PLAN_PARTIDAS_MARCA, ...lineas].join("\n");
}

/**
 * Las partidas escritas en la descripción. `[]` si no hay bloque o si no
 * se entiende: ver el encabezado.
 */
export function eduPlanPartidasParse(description: string | null | undefined): EduPlanPartida[] {
  if (!description) return [];
  const i = description.indexOf(EDU_PLAN_PARTIDAS_MARCA);
  if (i < 0) return [];
  const out: EduPlanPartida[] = [];
  for (const linea of description.slice(i + EDU_PLAN_PARTIDAS_MARCA.length).split("\n")) {
    const m = /^· (.+) ×(\d+) @ (\d+)$/.exec(linea.trim());
    if (!m) continue;
    const quantity = Number.parseInt(m[2], 10);
    const unitPriceCents = Number.parseInt(m[3], 10);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) continue;
    out.push({ name: m[1], quantity, unitPriceCents });
    if (out.length >= EDU_PLAN_MAX_PARTIDAS) break;
  }
  return out;
}

/** El texto que escribió una persona, SIN el bloque del servidor. */
export function eduPlanDescripcionHumana(description: string | null | undefined): string {
  if (!description) return "";
  const i = description.indexOf(EDU_PLAN_PARTIDAS_MARCA);
  return (i < 0 ? description : description.slice(0, i)).trim();
}

/** Junta el texto de la persona con el bloque, respetando el tope. */
export function eduPlanDescripcionCon(
  humana: string | null,
  partidas: EduPlanPartida[],
): string | null {
  const bloque = eduPlanPartidasSerializar(partidas);
  const texto = [eduPlanDescripcionHumana(humana), bloque].filter(Boolean).join("\n\n");
  return texto ? texto.slice(0, EDU_PLAN_DESC_MAX) : null;
}

/** Lo que suman las partidas, en centavos. */
export function eduPlanPartidasTotal(partidas: EduPlanPartida[]): number {
  return partidas.reduce(
    (t, p) => t + Math.max(0, p.quantity) * Math.max(0, p.unitPriceCents),
    0,
  );
}

/**
 * Las partidas con las que se convierte el plan en presupuesto.
 *
 * 🔴 NUNCA DEVUELVE VACÍO si el plan tiene importe: sin bloque legible,
 * el presupuesto sale con UNA partida por el total del plan. Un botón que
 * a veces no hace nada porque una columna de texto no se dejó leer es
 * peor que un presupuesto de un solo renglón.
 */
export function eduPlanPartidasParaPresupuesto(plan: {
  name: string;
  description: string | null;
  totalCents: number;
}): EduPlanPartida[] {
  const partidas = eduPlanPartidasParse(plan.description);
  if (partidas.length > 0) return partidas;
  return [{ name: limpiarNombre(plan.name), quantity: 1, unitPriceCents: Math.max(0, plan.totalCents) }];
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA SESIÓN: fecha, alumno y cita
// ═══════════════════════════════════════════════════════════════════════

/**
 * La fecha en que se HIZO la sesión, si quien la marca la corrige.
 *
 * 🔴 NO SE ACEPTA UNA FECHA FUTURA. Marcar como hecha una sesión de la
 * semana que viene es escribir en el expediente un acto que no ocurrió, y
 * el avance del plan lo daría por bueno. Se admite un minuto de margen
 * para el desfase entre el reloj del navegador y el del servidor.
 */
export function eduPlanParseFechaHecha(raw: unknown, now: Date): Date | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    throw new Error("Esa fecha no se entiende. Usa el selector de fecha.");
  }
  if (d.getTime() > now.getTime() + 60_000) {
    throw new Error(
      "Esa sesión todavía no ha pasado: no se puede marcar como hecha en el futuro.",
    );
  }
  return d;
}

/**
 * Las partidas que PIDE el navegador: `[{ procedureId, quantity }]`.
 *
 * 🔴 AQUÍ NO ENTRA NINGÚN PRECIO, Y ES TODA LA REGLA (d) DE LA CASA. El
 * precio lo pone el tarifario en el servidor; si esta función aceptara un
 * `unitPriceCents`, la pantalla podría presupuestar una endodoncia a un
 * peso y nadie lo notaría hasta el corte de caja.
 */
export function eduPlanParsePartidasPedidas(
  raw: unknown,
): { procedureId: string; quantity: number }[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("Las partidas del plan llegaron con una forma que no se entiende.");
  }
  if (raw.length > EDU_PLAN_MAX_PARTIDAS) {
    throw new Error(
      `El plan trae ${raw.length} partidas y el tope son ${EDU_PLAN_MAX_PARTIDAS}.`,
    );
  }
  const out: { procedureId: string; quantity: number }[] = [];
  const vistos = new Set<string>();
  raw.forEach((r, i) => {
    const it = (r ?? {}) as Record<string, unknown>;
    const procedureId = typeof it.procedureId === "string" ? it.procedureId.trim() : "";
    if (!procedureId) throw new Error(`La partida ${i + 1} no dice qué procedimiento es.`);
    const quantity =
      it.quantity === undefined || it.quantity === null || it.quantity === ""
        ? 1
        : Number.parseInt(String(it.quantity), 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new Error(`La cantidad de la partida ${i + 1} tiene que ser un entero entre 1 y 999.`);
    }
    // El mismo procedimiento dos veces se SUMA en vez de rebotar: es lo
    // que pasa cuando alguien añade «resina» y más abajo vuelve a añadir
    // «resina», y rebotar ahí solo enseña un error por un gesto normal.
    if (vistos.has(procedureId)) {
      const ya = out.find((x) => x.procedureId === procedureId)!;
      ya.quantity = Math.min(999, ya.quantity + quantity);
      return;
    }
    vistos.add(procedureId);
    out.push({ procedureId, quantity });
  });
  return out;
}
