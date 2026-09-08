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
