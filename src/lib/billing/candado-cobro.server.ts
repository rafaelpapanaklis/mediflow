import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * CANDADO POR CLÍNICA de «Pagar mi plan» y «Subir de plan y pagar» (ws1-t2, decimotercera vuelta de t4 — Z7, Z18, Z19).
 *
 * Dos capas:
 *
 *  1. `failban.acquireLock` (Upstash si hay `UPSTASH_REDIS_REST_URL/TOKEN`; si no, la memoria de la instancia). Rápida, pero
 *     sin Upstash solo ve las peticiones de SU instancia, y con Upstash caído deja pasar. El código NO exige Upstash.
 *  2. ESTE candado en la base, que ve a TODAS las instancias. Es una sola fila por clínica en `billing_email_logs`
 *     (tabla interna de cobros que ninguna pantalla lista; `invoiceId` es UNIQUE y ya se usa como llave de «una sola vez»
 *     por otros avisos), manejada con comparar-y-cambiar atómico:
 *       · tomar  = `UPDATE … SET kind='candado_tomado', email=<dueño>, createdAt=(now() AT TIME ZONE 'UTC') WHERE llave AND (libre OR vencida según el reloj de la BASE)`;
 *         si no hay fila todavía, `INSERT … ON CONFLICT DO NOTHING` con la hora de la base (la llave UNIQUE hace que de dos que compiten solo una entre);
 *       · soltar = `UPDATE … SET kind='candado_libre' WHERE llave AND kind='candado_tomado' AND email=<dueño>`.
 *     No usa transacción larga (con `connection_limit=1` por instancia retendría la única conexión mientras se cobra y el
 *     resto de las consultas de la petición se quedarían esperando), ni `audit_logs` (Z18/Z19: no ensucia /dashboard/auditoria
 *     ni la actividad, y no hay nada que atribuir a quien suplanta), ni se borra nada (la misma fila se reutiliza).
 *     Vigencia `ttlSec`: si el proceso muere con el candado puesto, caduca solo.
 *
 * Z7: si la base FALLA al tomar el candado NO se deja pasar: se responde `error` y el llamador pide «intenta de nuevo en
 * unos segundos» sin cobrar. Soltar nunca lanza (si falla, caduca solo).
 */

export type ResultadoCandado = "tomado" | "ocupado" | "error";

const KIND_TOMADO = "candado_tomado";
const KIND_LIBRE = "candado_libre";

export interface DbCandado {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  billingEmailLog: {
    updateMany(args: any): Promise<{ count: number }>;
    findUnique(args: any): Promise<{ kind: string } | null>;
  };
}

/** La llave única de la clínica en `billing_email_logs.invoiceId`. */
export const llaveCandadoCobro = (clinicId: string) => `candado-cobro:${clinicId}`;

/**
 * AB5: TODA la hora del candado es la de la BASE, expresada en UTC: `now() AT TIME ZONE 'UTC'` es un `timestamp` sin zona,
 * igual que la columna `createdAt` (`timestamp(3)`, donde Prisma guarda UTC), así que NI el reloj de una instancia NI la zona
 * de la sesión (que si no fuera UTC desfasaría `now()` horas contra la columna) cambian la comparación.
 */
// (Prisma no admite fragmentos de SQL dentro de las plantillas: cada consulta lo escribe en línea.)

/**
 * `true` = el candado quedó tomado por `dueno`.
 *
 * AA7: la vigencia se compara con el reloj de la BASE, no con el de cada instancia. AA16: si el UPDATE no toma nada se MIRA
 * (`findUnique`) antes de volver a intentar el INSERT. AB5: la PRIMERA toma de una clínica también es un INSERT con la hora de
 * la base (`ON CONFLICT DO NOTHING`: si dos compiten solo una inserta y la otra queda «ocupado», sin errores que imprimir).
 */
export async function tomarCandadoEnBase(
  args: { clinicId: string; dueno: string; ttlSec: number },
  db: DbCandado = prisma as unknown as DbCandado,
): Promise<ResultadoCandado> {
  if (!args.clinicId) return "error"; // sin clinicId no se sabe a quién bloquear (y Prisma descartaría el filtro)
  const llave = llaveCandadoCobro(args.clinicId);
  const ttl = Math.max(1, Math.floor(args.ttlSec));
  try {
    const tomadas = await db.$executeRaw`UPDATE "billing_email_logs"
      SET "kind" = ${KIND_TOMADO}, "email" = ${args.dueno}, "createdAt" = (now() AT TIME ZONE 'UTC')
      WHERE "invoiceId" = ${llave} AND ("kind" = ${KIND_LIBRE} OR "createdAt" < (now() AT TIME ZONE 'UTC') - (${ttl}::int * interval '1 second'))`;
    if (tomadas > 0) return "tomado";
    // Sin UPDATE: o la fila existe y está tomada (vigente) → ocupado, sin tocar el INSERT; o todavía no existe → se crea.
    if (await db.billingEmailLog.findUnique({ where: { invoiceId: llave }, select: { kind: true } })) return "ocupado";
    const creadas = await db.$executeRaw`INSERT INTO "billing_email_logs" ("id", "invoiceId", "clinicId", "kind", "email", "createdAt")
      VALUES (${randomUUID()}, ${llave}, ${args.clinicId}, ${KIND_TOMADO}, ${args.dueno}, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("invoiceId") DO NOTHING`;
    return creadas > 0 ? "tomado" : "ocupado"; // 0 = otra instancia la creó justo antes (carrera de la primera vez)
  } catch (e) {
    // Incluye «la tabla no existe» (P2021 / 42P01: falta correr sql/billing-email-log.sql): NO se cobra sin candado.
    console.error("[candado-cobro] no se pudo tomar el candado en la base (¿falta la tabla billing_email_logs? sql/billing-email-log.sql):", (e as Error)?.message ?? e);
    return "error";
  }
}

/** Suelta SOLO si el candado sigue siendo de `dueno`. Nunca lanza. */
export async function soltarCandadoEnBase(args: { clinicId: string; dueno: string }, db: DbCandado = prisma as unknown as DbCandado): Promise<void> {
  if (!args.clinicId) return;
  try {
    await db.billingEmailLog.updateMany({
      where: { invoiceId: llaveCandadoCobro(args.clinicId), kind: KIND_TOMADO, email: args.dueno },
      data: { kind: KIND_LIBRE },
    });
  } catch (e) {
    console.warn("[candado-cobro] no se pudo soltar el candado en la base (caduca solo):", (e as Error)?.message ?? e);
  }
}

/** Quién tiene hoy el candado de la clínica (su dueño: `pagar:<id>` / `subir:<id>`), o null. Solo para escoger el mensaje. */
export async function duenoDelCandadoEnBase(args: { clinicId: string; ttlSec: number }, db: DbCandado = prisma as unknown as DbCandado): Promise<string | null> {
  if (!args.clinicId) return null;
  const ttl = Math.max(1, Math.floor(args.ttlSec));
  try {
    const f = await db.$queryRaw<Array<{ email: string }>>`SELECT "email" FROM "billing_email_logs"
      WHERE "invoiceId" = ${llaveCandadoCobro(args.clinicId)} AND "kind" = ${KIND_TOMADO}
        AND "createdAt" >= (now() AT TIME ZONE 'UTC') - (${ttl}::int * interval '1 second')`;
    return f[0]?.email ?? null;
  } catch {
    return null;
  }
}

// ── El candado completo (las dos capas) para las dos acciones ─────────────────────────────────────────────────────

export interface CapaRapida {
  adquirir(clave: string, ttlSec: number, dueno: string): Promise<boolean>;
  liberar(clave: string, dueno: string): Promise<void>;
}

/** Capa 1 real: failban (Upstash, o memoria de la instancia). */
const capaRapidaReal: CapaRapida = {
  adquirir: async (clave, ttlSec, dueno) => (await import("@/lib/failban")).acquireLock(clave, ttlSec, dueno),
  liberar: async (clave, dueno) => (await import("@/lib/failban")).releaseLock(clave, dueno),
};

/**
 * El `candado` que reciben `pagarPendiente` y `subirYPagar`: primero la capa rápida; si la consiguió, la de la base (entre
 * instancias). Si la base dice «ocupado» o falla, se suelta la rápida y se devuelve eso (Z7: un fallo NO deja pasar).
 */
export function crearCandadoDeCobro(
  args: { clinicId: string },
  capas: { rapida?: CapaRapida; db?: DbCandado } = {},
) {
  const rapida = capas.rapida ?? capaRapidaReal;
  const db = capas.db ?? (prisma as unknown as DbCandado);
  return {
    tomar: async (clave: string, ttlSec: number, dueno: string): Promise<ResultadoCandado> => {
      if (!(await rapida.adquirir(clave, ttlSec, dueno))) return "ocupado";
      const enBase = await tomarCandadoEnBase({ clinicId: args.clinicId, dueno, ttlSec }, db);
      if (enBase !== "tomado") await rapida.liberar(clave, dueno).catch(() => {});
      return enBase;
    },
    soltar: async (clave: string, dueno: string): Promise<void> => {
      await soltarCandadoEnBase({ clinicId: args.clinicId, dueno }, db);
      await rapida.liberar(clave, dueno).catch(() => {});
    },
    quien: async (): Promise<string | null> => duenoDelCandadoEnBase({ clinicId: args.clinicId, ttlSec: 90 }, db),
  };
}

// ── Contador de intentos de «Subir» (AB2/AB3) ─────────────────────────────────────────────────────────────────────
//
// Después de un 5xx de Stripe en «Subir», el siguiente intento tiene que llevar una clave de idempotencia NUEVA (Stripe repite
// un 5xx guardado con la misma clave durante 24 h). El contador vive en NUESTRA base —NO en Stripe: ni en la metadata de una
// factura anulada (que quizá no se pueda editar) ni en una escritura con clave que pudiera repetir su propio 500—, en una fila
// por clínica de la misma tabla (`invoiceId = subir-intento:<clínica>`, `kind = contador_subir`; el contador va en `email`, que es
// el único campo de texto libre: sin columnas ni SQL nuevos). La fila se reutiliza y nunca se borra.

const KIND_CONTADOR = "contador_subir";
const KIND_CAMBIO = "cambio_subir";
export const llaveIntentosSubir = (clinicId: string) => `subir-intento:${clinicId}`;
/** La fila que recuerda el ÚLTIMO fallo AMBIGUO del paso del cambio de plan (V3c/AC3): su `createdAt` es la hora de ese fallo. */
export const llaveCambioSubir = (clinicId: string) => `subir-cambio:${clinicId}`;

/** Cuánto dura "hubo un fallo del cambio de plan que quizá sí se aplicó" (AC3): minutos, no horas. */
export const MINUTOS_CAMBIO_AMBIGUO = 15;

export interface EstadoIntentosSubir {
  /** Cuántas veces falló un «Subir» de esta clínica tras tocar Stripe (cualquier paso). */
  intento: number;
  /**
   * AC3: ¿hubo, en los últimos `MINUTOS_CAMBIO_AMBIGUO` min, un fallo 5xx/de red del paso del CAMBIO de plan (el único que pudo
   * aplicarse en Stripe aunque la respuesta se perdiera)? Un fallo del precio, de la anulación, de la tarjeta… NO cuenta.
   */
  cambioReciente: boolean;
}

/**
 * EL criterio del contador, igual para leer y para sumar (AC5): solo cuenta un texto de 1 a 9 dígitos (cabe en `int`);
 * cualquier otra cosa (" 3", "1e3", "99999999999", vacío) vale 0. Se escribe en SQL para que lectura y suma no puedan discrepar.
 */
// (Prisma no admite fragmentos de SQL dentro de las plantillas: la lectura y la suma repiten el MISMO `CASE` literal.)

/** `null` = no se pudo leer (quien llama NO sigue: regla de oro). Sin filas → `{ intento: 0, cambioReciente: false }`. */
export async function leerIntentosSubir(clinicId: string, db: DbCandado = prisma as unknown as DbCandado): Promise<EstadoIntentosSubir | null> {
  if (!clinicId) return null;
  try {
    const filas = await db.$queryRaw<Array<{ intento: number | string; cambio_reciente: boolean }>>`SELECT
        COALESCE((SELECT (CASE WHEN "email" ~ '^[0-9]{1,9}$' THEN "email"::int ELSE 0 END) FROM "billing_email_logs"
                  WHERE "invoiceId" = ${llaveIntentosSubir(clinicId)} AND "kind" = ${KIND_CONTADOR}), 0) AS "intento",
        EXISTS (SELECT 1 FROM "billing_email_logs"
                WHERE "invoiceId" = ${llaveCambioSubir(clinicId)} AND "kind" = ${KIND_CAMBIO}
                  AND "createdAt" >= (now() AT TIME ZONE 'UTC') - (${MINUTOS_CAMBIO_AMBIGUO}::int * interval '1 minute')) AS "cambio_reciente"`;
    const f = filas[0];
    return { intento: Math.max(0, Math.floor(Number(f?.intento) || 0)), cambioReciente: !!f?.cambio_reciente };
  } catch (e) {
    console.error("[candado-cobro] no se pudo leer el contador de intentos de «Subir»:", (e as Error)?.message ?? e);
    return null;
  }
}

/** Crea la fila si no existe y, si existe, la actualiza (hora de la base en UTC). Una sola función para las dos filas. */
async function tocarFila(db: DbCandado, clinicId: string, llave: string, kind: string, suma: boolean): Promise<void> {
  const actualizar = () =>
    suma
      ? db.$executeRaw`UPDATE "billing_email_logs"
          SET "email" = ((CASE WHEN "email" ~ '^[0-9]{1,9}$' THEN "email"::int ELSE 0 END) + 1)::text, "createdAt" = (now() AT TIME ZONE 'UTC')
          WHERE "invoiceId" = ${llave} AND "kind" = ${kind}`
      : db.$executeRaw`UPDATE "billing_email_logs" SET "createdAt" = (now() AT TIME ZONE 'UTC') WHERE "invoiceId" = ${llave} AND "kind" = ${kind}`;
  if ((await actualizar()) > 0) return;
  const creadas = await db.$executeRaw`INSERT INTO "billing_email_logs" ("id", "invoiceId", "clinicId", "kind", "email", "createdAt")
    VALUES (${randomUUID()}, ${llave}, ${clinicId}, ${kind}, '1', (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("invoiceId") DO NOTHING`;
  if (creadas === 0) await actualizar(); // otra instancia la creó justo antes
}

/**
 * Suma 1 al contador y, si el fallo fue AMBIGUO en el paso del cambio de plan (5xx o red: quizá Stripe sí lo aplicó), marca la
 * hora de ese fallo. Nunca lanza: si falla, el siguiente intento saldría con la misma clave y se vería en el log.
 */
export async function sumarIntentoSubir(
  clinicId: string,
  opciones: { cambioAmbiguo?: boolean } = {},
  db: DbCandado = prisma as unknown as DbCandado,
): Promise<void> {
  if (!clinicId) return;
  try {
    await tocarFila(db, clinicId, llaveIntentosSubir(clinicId), KIND_CONTADOR, true);
    if (opciones.cambioAmbiguo) await tocarFila(db, clinicId, llaveCambioSubir(clinicId), KIND_CAMBIO, false);
  } catch (e) {
    console.error("[candado-cobro] no se pudo sumar el contador de intentos de «Subir»:", (e as Error)?.message ?? e);
  }
}
