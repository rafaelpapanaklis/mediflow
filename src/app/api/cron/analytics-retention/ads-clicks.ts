// Borrado del clic de anuncios (clinic_ads_clicks) a los 12 meses del registro.
//
// La tabla la crea sql/ws1-t6-ads-clics.sql (PR #424) y NO tiene modelo en
// prisma/schema.prisma: por eso aquí todo es SQL crudo. Una fila por clínica
// (clinicId es la PK) con el gclid/gbraid/wbraid con el que llegó y "createdAt",
// que es el momento en que se registró la cuenta (lo escribe /api/auth/register
// al crear la clínica). Es ese "createdAt" —no "clickedAt"— el que cuenta los
// 12 meses: el aviso de privacidad promete «12 meses desde que se registra la
// cuenta» (sección 8 de /privacidad).
//
// Se reutiliza purgeInBatches de ./purge: la PK es clinicId, así que "los ids"
// del BatchDeleter son ids de clínica. Mismo reparto que el resto del cron:
// primero elegir los más viejos, luego borrarlos por id, en lotes.
//
// TOLERA QUE LA TABLA NO EXISTA (42P01): el código de este cron puede llegar a
// producción antes que el SQL, o en una base que nunca lo recibió. En ese caso
// se deja constancia en el resumen y el cron sigue con lo demás.

import { purgeInBatches, type BatchDeleter, type PurgeOptions, type PurgeResult } from "./purge";

/** Cuánto se conserva el clic ligado a una cuenta: 12 meses desde el registro.
 *  Decisión de Rafael (ws7), 26-sep-2026. Si cambia, cambia también el texto de
 *  la sección 8 de /privacidad. */
export const ADS_CLICK_RETENTION_MONTHS = 12;

/** Nombre de la tabla, para reconocer el error de «no existe». */
export const ADS_CLICKS_TABLE = "clinic_ads_clicks";

/** Corte en meses de calendario (no 360 días): «12 meses» es de fecha a fecha.
 *  Si el día no existe en el mes de destino (29-feb → 2025), JS lo desborda al
 *  1.º del mes siguiente; es el corte más benigno y da igual para un cron diario. */
export function cutoffMonthsAgo(months: number, now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Acceso mínimo a SQL crudo. PrismaClient lo cumple tal cual; la prueba lo
 *  implementa con un array en memoria. */
export interface RawSqlClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** ¿El error es «la tabla no existe» (SQLSTATE 42P01)? Prisma lo envuelve en un
 *  P2010 con el SQLSTATE en meta.code; según el conector puede venir también en
 *  `code` o solo en el mensaje. */
export function isMissingTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown };
  if (err.code === "42P01" || err.meta?.code === "42P01") return true;
  const text = `${typeof err.message === "string" ? err.message : ""} ${
    typeof err.meta?.message === "string" ? err.meta.message : ""
  }`;
  return (
    /42P01/.test(text) ||
    new RegExp(`relation\\s+(?:"?public"?\\.)?"?${ADS_CLICKS_TABLE}"?\\s+does not exist`, "i").test(text)
  );
}

/** Los más viejos que el corte, por "createdAt" (la fila = el momento del registro). */
export function adsClickDeleter(db: RawSqlClient): BatchDeleter {
  return {
    pickOldest: async (cutoff, take) => {
      const rows = await db.$queryRaw<Array<{ clinicId: string }>>`
        SELECT "clinicId" FROM "clinic_ads_clicks"
        WHERE "createdAt" < ${cutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${take}`;
      return rows.map((r) => r.clinicId);
    },
    deleteByIds: async (ids) =>
      Number(
        await db.$executeRaw`
          DELETE FROM "clinic_ads_clicks"
          WHERE "clinicId" = ANY(${ids}::text[])`,
      ),
  };
}

export interface AdsClicksResult extends PurgeResult {
  /** Corte aplicado (ISO). */
  cutoff: string;
  /** Por qué no se hizo nada, si la tabla no existe. No es un error. */
  skipped: string | null;
}

/**
 * Borra en lotes los clics con más de ADS_CLICK_RETENTION_MONTHS meses.
 *
 * Lanza cualquier error que NO sea «la tabla no existe»: eso lo apunta la ruta
 * en `errors` como el resto de purgas. Idempotente: el corte es un umbral
 * absoluto, la segunda vuelta no encuentra nada.
 */
export async function purgeAdsClicks(
  db: RawSqlClient,
  now: Date,
  opts: PurgeOptions = {},
): Promise<AdsClicksResult> {
  const cutoff = cutoffMonthsAgo(ADS_CLICK_RETENTION_MONTHS, now);
  try {
    const r = await purgeInBatches(adsClickDeleter(db), cutoff, opts);
    return { ...r, cutoff: cutoff.toISOString(), skipped: null };
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
    console.warn(
      `[cron/analytics-retention] ${ADS_CLICKS_TABLE} no existe todavía (42P01): se omite el borrado del clic de anuncios. Aplica sql/ws1-t6-ads-clics.sql.`,
    );
    return {
      deleted: 0,
      batches: 0,
      done: true,
      cutoff: cutoff.toISOString(),
      skipped: `la tabla ${ADS_CLICKS_TABLE} no existe (42P01)`,
    };
  }
}
