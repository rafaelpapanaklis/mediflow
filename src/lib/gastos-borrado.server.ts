// ═══════════════════════════════════════════════════════════════════════════
// GASTOS: borrado LÓGICO y edición con rastro (ws1-t2, auditoría de dinero
// F11: «quien tiene expenses.edit borra un gasto de $8,000 y la utilidad del
// mes sube $8,000 sin dejar rastro ni copia»).
//
// Las columnas `expenses."deletedAt"` / `"deletedById"` llegan con
// sql/ws1-t2-gastos-borrado-logico.sql, que pega Rafael. NO están en
// schema.prisma a propósito: el cliente de Prisma se comparte con dev.108 y,
// con el campo en el modelo, cualquier lectura sin `select` reventaría con
// P2022 mientras el SQL no se pegue. Por eso todo lo de esas columnas va por
// SQL crudo detrás de una sonda:
//   · sin el SQL → borrar sigue siendo físico (como hoy), pero ya deja en la
//     bitácora una copia del gasto (monto, categoría, fecha, nota);
//   · con el SQL → borrar marca `deletedAt` y el gasto deja de contar en
//     Finanzas, la lista y Sabina, pero la fila se conserva.
// La sonda pregunta a information_schema (nunca falla) y recuerda la
// respuesta en globalThis (sobrevive a las recargas de next dev): sin
// columna no se lanza ninguna consulta que la nombre.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const SONDA = Symbol.for("dalecontrol.gastos.columnaBorrado");
type Sonda = { existe: boolean; at: number };
/** Un «no está» se vuelve a preguntar cada 10 min; un «sí está» es para siempre. */
const RE_PREGUNTAR_MS = 10 * 60_000;

/** ¿Existe la columna `expenses.deletedAt`? Si la sonda falla, `false` sin recordarlo. */
export async function hayBorradoLogico(db: Db = prisma): Promise<boolean> {
  const g = globalThis as unknown as Record<symbol, Sonda | undefined>;
  const s = g[SONDA];
  if (s && (s.existe || Date.now() - s.at < RE_PREGUNTAR_MS)) return s.existe;
  try {
    const filas = await db.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'deletedAt'
      ) AS existe`;
    const existe = (filas as Array<{ existe: boolean }>)?.[0]?.existe === true;
    g[SONDA] = { existe, at: Date.now() };
    return existe;
  } catch {
    return false;
  }
}

/** Solo para las pruebas: olvida lo que se sabía de la columna. */
export function olvidarSondaDeGastos(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[SONDA];
}

/**
 * Filtro EXTRA de Prisma para leer solo gastos VIVOS de la clínica: `{}` si no
 * hay borrado lógico o no hay ninguno borrado, y si no `id notIn` los
 * borrados. Se añade al `where` de quien lista o suma gastos.
 */
export async function filtroGastosVivos(clinicId: string, db: Db = prisma): Promise<{ id?: { notIn: string[] } }> {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  if (!(await hayBorradoLogico(db))) return {};
  try {
    const filas = (await db.$queryRaw`
      SELECT "id" FROM "expenses" WHERE "clinicId" = ${clinicId} AND "deletedAt" IS NOT NULL`) as Array<{ id: string }>;
    const ids = (filas ?? []).map((f) => f.id);
    return ids.length ? { id: { notIn: ids } } : {};
  } catch (e) {
    console.warn("[gastos] no se pudieron leer los gastos borrados:", e);
    return {};
  }
}

export interface GastoParaBitacora {
  id: string;
  date: Date;
  category: string;
  amount: number;
  note: string | null;
  purchaseId?: string | null;
}

/** Lo que guarda la bitácora de un gasto: la copia que permite reconstruirlo. */
export function copiaDeGasto(g: GastoParaBitacora): Record<string, unknown> {
  return {
    fecha: g.date instanceof Date ? g.date.toISOString() : g.date,
    categoria: g.category,
    monto: g.amount,
    nota: g.note ?? null,
    ...(g.purchaseId ? { compraDeInventario: g.purchaseId } : {}),
  };
}

/**
 * Busca un gasto VIVO de la clínica (no borrado lógicamente). `null` si no
 * existe, es de otra clínica o ya se borró.
 */
export async function buscarGastoVivo(id: string, clinicId: string, db: Db = prisma): Promise<GastoParaBitacora | null> {
  if (!clinicId || !id) return null;
  const vivos = await filtroGastosVivos(clinicId, db);
  const g = await db.expense.findFirst({
    where: { id, clinicId, ...(vivos.id ? { AND: [{ id: vivos.id }] } : {}) },
    select: { id: true, date: true, category: true, amount: true, note: true },
  });
  return g ?? null;
}

/**
 * Borra un gasto de la clínica: lógico si está la columna, físico si no.
 * Devuelve cuántas filas tocó (0 = ya no estaba o ya estaba borrado).
 */
export async function borrarGasto(
  args: { id: string; clinicId: string; userId: string },
  db: Db = prisma,
): Promise<{ count: number; logico: boolean }> {
  const { id, clinicId, userId } = args;
  if (!clinicId || !id) return { count: 0, logico: false };
  if (await hayBorradoLogico(db)) {
    const count = await db.$executeRaw`
      UPDATE "expenses" SET "deletedAt" = NOW(), "deletedById" = ${userId}
       WHERE "id" = ${id} AND "clinicId" = ${clinicId} AND "deletedAt" IS NULL`;
    return { count: Number(count) || 0, logico: true };
  }
  const { count } = await db.expense.deleteMany({ where: { id, clinicId } });
  return { count, logico: false };
}
