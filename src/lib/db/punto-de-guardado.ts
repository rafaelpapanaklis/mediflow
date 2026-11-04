import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * El cliente con el que habla un helper: el global (`prisma`) o el `tx` de una
 * transacción interactiva que ya abrió quien llama (ws1-t11 v4).
 *
 * Por qué importa: un helper que usa el `prisma` GLOBAL desde dentro de una
 * `$transaction` interactiva pide OTRA conexión al pooler mientras la de la
 * transacción sigue ocupada (2 por operación; con el pooler lleno, timeouts),
 * y además lo que escribe queda FUERA de la transacción.
 */
export type ClienteDb = typeof prisma | Prisma.TransactionClient;

/**
 * ¿Es el `tx` de una transacción interactiva? El cliente de transacción no trae
 * `$transaction` pero sí `$executeRawUnsafe`. Se piden las DOS cosas: un doble de
 * prueba de `prisma` sin `$transaction` no es una transacción (si no, se le
 * pedirían SAVEPOINT que no sabe hacer).
 */
export function esTransaccion(db: ClienteDb): db is Prisma.TransactionClient {
  const c = db as { $transaction?: unknown; $executeRawUnsafe?: unknown };
  return typeof c.$transaction !== "function" && typeof c.$executeRawUnsafe === "function";
}

/**
 * Corre `paso` de forma que, si FALLA dentro de una transacción, no la deja
 * abortada. En Postgres cualquier error dentro de una transacción la aborta
 * entera («current transaction is aborted»); los helpers que reintentan ante
 * un P2002 (el folio de la factura o del presupuesto) o que se tragan un error
 * a propósito (el saldo a favor, el doctor de la factura) dejarían de funcionar
 * con un `tx`. Con un SAVEPOINT el error deshace solo ESTE paso y la
 * transacción sigue viva. Fuera de una transacción no hace nada: llama a `paso`.
 */
export async function conPuntoDeGuardado<T>(db: ClienteDb, paso: () => Promise<T>): Promise<T> {
  if (!esTransaccion(db)) return paso();
  // Nombre fijo por formato (solo [a-z0-9_]): no viene de nadie de fuera.
  const nombre = `pg_${randomBytes(6).toString("hex")}`;
  await db.$executeRawUnsafe(`SAVEPOINT ${nombre}`);
  try {
    const r = await paso();
    await db.$executeRawUnsafe(`RELEASE SAVEPOINT ${nombre}`);
    return r;
  } catch (e) {
    // Si la transacción de fuera ya murió (p. ej. por timeout), el ROLLBACK TO también falla: ese error
    // no debe tapar el original, que es el que explica qué pasó (nota de t2, ws1-t11 v7).
    try {
      await db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${nombre}`);
    } catch (eRollback) {
      console.warn("[punto-de-guardado] no se pudo deshacer el punto de guardado (¿la transacción ya terminó?):", (eRollback as Error)?.message ?? eRollback);
    }
    throw e;
  }
}
