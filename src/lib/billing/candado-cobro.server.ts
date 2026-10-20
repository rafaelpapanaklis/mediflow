import { prisma } from "@/lib/prisma";

/**
 * CANDADO POR CLÍNICA de «Pagar mi plan» y «Subir de plan y pagar» (ws1-t2, duodécima vuelta de t4 — X2).
 *
 * Dos capas, porque ninguna basta sola:
 *
 *  1. `failban.acquireLock` (Upstash si hay `UPSTASH_REDIS_REST_URL/TOKEN`; si no, la memoria de la instancia). Es rápida,
 *     pero SIN Upstash solo protege dentro de UNA instancia serverless, y con Upstash caído deja pasar (fail-open).
 *     El código NO exige Upstash: sin las variables degrada a memoria con un aviso en el log.
 *  2. ESTE candado en la base, que funciona entre TODAS las instancias sin depender de Upstash. Mismo patrón que
 *     `reservarAvisoDeCobro` (aviso-cobro-tope.ts): una transacción CORTA con `pg_advisory_xact_lock` por clínica que lee
 *     la última marca y escribe la reserva en la bitácora (`audit_logs`, sin tabla ni SQL nuevos). NO se mantiene la
 *     transacción abierta durante el cobro (retendría una conexión del pooler decenas de segundos): la reserva es una FILA
 *     con vigencia (`ttlSec`); soltar escribe otra fila «libre». Si el proceso muere con la reserva puesta, caduca sola.
 *
 * Ante un fallo de la base NO se bloquea el cobro (mejor sin candado que dejar a la clínica sin poder pagar): devuelve
 * «tomado» y lo anota en el log; la capa 1 y las claves de idempotencia de Stripe siguen protegiendo.
 * Con DUEÑO: soltar solo escribe «libre» si la última reserva vigente es de ese dueño (una petición lenta cuyo candado
 * caducó y tomó otra no suelta el de la otra). Nunca se borra nada.
 */

export const ENTIDAD_CANDADO_COBRO = "candado_cobro_plan";

export interface TxCandado {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  auditLog: {
    findFirst(args: any): Promise<{ action: string; createdAt: Date; changes: unknown } | null>;
    create(args: any): Promise<unknown>;
  };
}
export interface DbCandado {
  $transaction<T>(fn: (tx: TxCandado) => Promise<T>, opciones?: { maxWait?: number; timeout?: number }): Promise<T>;
}

const duenoDe = (changes: unknown): string | null => {
  const d = (changes as { dueno?: { after?: unknown } } | null)?.dueno?.after;
  return typeof d === "string" ? d : null;
};

const ESPERA_TX = { maxWait: 8000, timeout: 8000 };

async function ultimaMarca(tx: TxCandado, clinicId: string) {
  return tx.auditLog.findFirst({
    where: { clinicId, entityType: ENTIDAD_CANDADO_COBRO, entityId: clinicId },
    orderBy: { createdAt: "desc" },
    select: { action: true, createdAt: true, changes: true },
  });
}

/** `true` = el candado quedó tomado por `dueno`; `false` = otra operación de cobro de esta clínica sigue en curso. */
export async function tomarCandadoEnBase(
  args: { clinicId: string; userId: string; dueno: string; ttlSec: number; ahora?: Date },
  db: DbCandado = prisma as unknown as DbCandado,
): Promise<boolean> {
  if (!args.clinicId) return true; // sin clinicId no hay a quién bloquear (y Prisma descartaría el filtro)
  const ahora = args.ahora ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pago-pendiente:${args.clinicId}`}))`;
      const ultima = await ultimaMarca(tx, args.clinicId);
      if (ultima && ultima.action === "reserva" && ahora.getTime() - ultima.createdAt.getTime() < args.ttlSec * 1000) return false;
      await tx.auditLog.create({
        data: {
          clinicId: args.clinicId,
          userId: args.userId,
          entityType: ENTIDAD_CANDADO_COBRO,
          entityId: args.clinicId,
          action: "reserva",
          changes: { dueno: { before: null, after: args.dueno } },
        },
      });
      return true;
    }, ESPERA_TX);
  } catch (e) {
    console.warn("[candado-cobro] no se pudo tomar el candado en la base (sigue sin él):", (e as Error)?.message ?? e);
    return true;
  }
}

/** Suelta SOLO si la última reserva vigente es de `dueno`. Nunca lanza (si falla, caduca sola). */
export async function soltarCandadoEnBase(
  args: { clinicId: string; userId: string; dueno: string; ttlSec: number; ahora?: Date },
  db: DbCandado = prisma as unknown as DbCandado,
): Promise<void> {
  if (!args.clinicId) return;
  const ahora = args.ahora ?? new Date();
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pago-pendiente:${args.clinicId}`}))`;
      const ultima = await ultimaMarca(tx, args.clinicId);
      if (!ultima || ultima.action !== "reserva" || duenoDe(ultima.changes) !== args.dueno) return;
      await tx.auditLog.create({
        data: {
          clinicId: args.clinicId,
          userId: args.userId,
          entityType: ENTIDAD_CANDADO_COBRO,
          entityId: args.clinicId,
          action: "libre",
          changes: { dueno: { before: args.dueno, after: null } },
        },
      });
    }, ESPERA_TX);
  } catch (e) {
    console.warn("[candado-cobro] no se pudo soltar el candado en la base (caduca solo):", (e as Error)?.message ?? e);
  }
}

/** Quién tiene hoy el candado de la clínica (su `dueno`), o null. Solo para escoger el mensaje; nunca lanza. */
export async function duenoDelCandadoEnBase(
  args: { clinicId: string; ttlSec: number; ahora?: Date },
  db: DbCandado = prisma as unknown as DbCandado,
): Promise<string | null> {
  if (!args.clinicId) return null;
  const ahora = args.ahora ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const ultima = await ultimaMarca(tx, args.clinicId);
      if (!ultima || ultima.action !== "reserva" || ahora.getTime() - ultima.createdAt.getTime() >= args.ttlSec * 1000) return null;
      return duenoDe(ultima.changes);
    }, ESPERA_TX);
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
 * instancias). Si la base dice «ocupado» se suelta la rápida y se responde «ocupado». Soltar libera las dos.
 */
export function crearCandadoDeCobro(
  args: { clinicId: string; userId: string },
  capas: { rapida?: CapaRapida; db?: DbCandado; ahora?: () => Date } = {},
) {
  const rapida = capas.rapida ?? capaRapidaReal;
  const db = capas.db ?? (prisma as unknown as DbCandado);
  const ahora = () => (capas.ahora ?? (() => new Date()))();
  return {
    tomar: async (clave: string, ttlSec: number, dueno: string): Promise<boolean> => {
      if (!(await rapida.adquirir(clave, ttlSec, dueno))) return false;
      const enBase = await tomarCandadoEnBase({ clinicId: args.clinicId, userId: args.userId, dueno, ttlSec, ahora: ahora() }, db);
      if (!enBase) {
        await rapida.liberar(clave, dueno).catch(() => {});
        return false;
      }
      return true;
    },
    soltar: async (clave: string, dueno: string): Promise<void> => {
      await soltarCandadoEnBase({ clinicId: args.clinicId, userId: args.userId, dueno, ttlSec: 0, ahora: ahora() }, db);
      await rapida.liberar(clave, dueno).catch(() => {});
    },
    quien: async (): Promise<string | null> => duenoDelCandadoEnBase({ clinicId: args.clinicId, ttlSec: 90, ahora: ahora() }, db),
  };
}
