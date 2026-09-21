// Lógica de la purga de analítica, separada de la ruta a propósito: así se
// prueba entera sin base de datos, sin red y sin Next (ver __tests__/purge.test.ts).
//
// Por qué por LOTES y no un DELETE de golpe: analytics_events es la tabla donde
// escribe el panel de TODAS las clínicas en cada click. Un
// `DELETE FROM analytics_events WHERE created_at < ...` de decenas de miles de
// filas se lleva los locks de la tabla el tiempo que dure y las escrituras del
// tracker se quedan esperando. En lotes pequeños cada transacción dura
// milisegundos y las escrituras se cuelan entre lote y lote.

/**
 * Cuánto se guardan los EVENTOS (analytics_events). 90 días.
 *
 * Justificación: los únicos lectores de esta tabla son el heatmap
 * (`type="click"`, /api/admin/analytics/heatmap) y el panel de Páginas
 * (`type="pageview"` + `custom name="page_time"`, /api/admin/analytics). Los dos
 * consultan siempre dentro del rango de fechas del filtro, que por defecto son
 * **30 días** (parseAnalyticsFilters en src/lib/analytics/query.ts). 90 días dan
 * tres meses completos —el trimestre, y comparar un mes contra el anterior— o
 * sea el triple de lo que el panel pide por defecto. Más atrás el detalle
 * click-a-click no lo mira nadie: para el histórico largo están las sesiones.
 */
export const EVENT_RETENTION_DAYS = 90;

/**
 * Cuánto se guardan las SESIONES (analytics_sessions). 365 días.
 *
 * Son ~36 filas al día (~13 000 al año) y llevan ya agregados los KPI que sí se
 * miran a largo plazo: visitas, visitantes únicos, geo, fuentes, rebote,
 * duración, identidad. Caben de sobra un año y cuestan poquísimo.
 *
 * ⚠️ Consecuencia deliberada, y hay que saberla: entre el día 90 y el 365 el
 * panel enseña visitas/geo/fuentes pero NO pageviews por página ni heatmap,
 * porque esos salen de los eventos. Si Rafael quiere fidelidad completa a un
 * año, se sube EVENT_RETENTION_DAYS (ver el cálculo de crecimiento en el
 * reporte) y no hace falta tocar nada más.
 */
export const SESSION_RETENTION_DAYS = 365;

/** Filas por lote. Pequeño a propósito: cada DELETE dura milisegundos. */
export const PURGE_BATCH = 2_000;

/** Tope de lotes por corrida, para no pasarse de maxDuration. Con 2 000 por
 *  lote son hasta 80 000 filas por corrida; el ritmo real es ~3 300/día. */
export const MAX_BATCHES = 40;

/** Acceso mínimo a una tabla. La ruta lo implementa con Prisma; la prueba, con
 *  un array en memoria. */
export interface BatchDeleter {
  /** Ids de las filas más viejas que `cutoff`, como mucho `take`. */
  pickOldest(cutoff: Date, take: number): Promise<string[]>;
  /** Borra esas ids. Devuelve cuántas borró de verdad. */
  deleteByIds(ids: string[]): Promise<number>;
}

export interface PurgeResult {
  deleted: number;
  batches: number;
  /** true = ya no queda nada más viejo que el corte. false = se acabó el tope
   *  de lotes o el tiempo; la corrida de mañana sigue donde ésta lo dejó. */
  done: boolean;
}

export interface PurgeOptions {
  batchSize?: number;
  maxBatches?: number;
  /** Instante (ms epoch) a partir del cual ya no se empieza otro lote. */
  deadlineAt?: number;
  /** Inyectable para probar el freno por tiempo. */
  nowMs?: () => number;
}

/** Corte: todo lo anterior a esta fecha se va. */
export function cutoffFor(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Borra en lotes lo anterior a `cutoff`.
 *
 * IDEMPOTENTE: el corte es un umbral absoluto, no un cursor guardado. Correrlo
 * dos veces seguidas no falla — la segunda vuelta no encuentra nada y devuelve
 * `{ deleted: 0, batches: 0, done: true }`.
 */
export async function purgeInBatches(
  deleter: BatchDeleter,
  cutoff: Date,
  opts: PurgeOptions = {},
): Promise<PurgeResult> {
  const batchSize = opts.batchSize ?? PURGE_BATCH;
  const maxBatches = opts.maxBatches ?? MAX_BATCHES;
  const nowMs = opts.nowMs ?? Date.now;

  let deleted = 0;
  let batches = 0;

  while (batches < maxBatches) {
    if (opts.deadlineAt !== undefined && nowMs() >= opts.deadlineAt) {
      return { deleted, batches, done: false }; // sin tiempo: se corta limpio
    }
    const ids = await deleter.pickOldest(cutoff, batchSize);
    if (ids.length === 0) return { deleted, batches, done: true };

    const n = await deleter.deleteByIds(ids);
    deleted += n;
    batches += 1;

    // Freno por falta de progreso: si había ids pero no se borró ninguna fila
    // (otra corrida se adelantó, o el DELETE no pegó), `pickOldest` devolvería
    // exactamente los mismos ids en la vuelta siguiente y se quemarían los 40
    // lotes en consultas inútiles. Se corta y se deja constancia con done:false.
    if (n === 0) return { deleted, batches, done: false };

    // Lote incompleto = era el último que había.
    if (ids.length < batchSize) return { deleted, batches, done: true };
  }

  return { deleted, batches, done: false }; // tope de lotes: mañana sigue
}
