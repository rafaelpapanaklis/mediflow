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
 *       · tomar  = `UPDATE … SET kind='candado_tomado', email=<dueño>, createdAt=now() WHERE llave AND (libre OR vencida según now() de la BASE)`;
 *         si no hay fila todavía, `INSERT` (la llave UNIQUE hace que de dos que compiten solo uno entre: P2002 = ocupado);
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
    create(args: any): Promise<unknown>;
    updateMany(args: any): Promise<{ count: number }>;
    findUnique(args: any): Promise<{ kind: string } | null>;
  };
}

/** La llave única de la clínica en `billing_email_logs.invoiceId`. */
export const llaveCandadoCobro = (clinicId: string) => `candado-cobro:${clinicId}`;

/**
 * `true` = el candado quedó tomado por `dueno`.
 *
 * AA7: la vigencia se compara con el reloj de la BASE (`now()`), no con el de cada instancia: dos instancias con la hora
 * desfasada no se pisan el candado. AA16: si el UPDATE no toma nada se MIRA antes de volver a intentar el INSERT (un «Pagar»
 * que espera hacía ~30 INSERT con P2002 en 15 s y Prisma imprime cada error aunque se atrape).
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
      SET "kind" = ${KIND_TOMADO}, "email" = ${args.dueno}, "createdAt" = now()
      WHERE "invoiceId" = ${llave} AND ("kind" = ${KIND_LIBRE} OR "createdAt" < now() - (${ttl}::int * interval '1 second'))`;
    if (tomadas > 0) return "tomado";
    // Sin UPDATE: o la fila existe y está tomada (vigente) → ocupado, sin tocar el INSERT; o todavía no existe → se crea.
    if (await db.billingEmailLog.findUnique({ where: { invoiceId: llave }, select: { kind: true } })) return "ocupado";
    try {
      // `createdAt` lo pone el DEFAULT de la base (su reloj).
      await db.billingEmailLog.create({ data: { invoiceId: llave, clinicId: args.clinicId, kind: KIND_TOMADO, email: args.dueno } });
      return "tomado";
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return "ocupado"; // otra instancia la creó justo antes (carrera de la primera vez)
      throw e;
    }
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
        AND "createdAt" >= now() - (${ttl}::int * interval '1 second')`;
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
