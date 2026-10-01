import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/caja";

// ═══════════════════════════════════════════════════════════════════
// La LISTA de gastos de un periodo (tabla expenses). Vivía dentro de
// GET /api/gastos; salió aquí, sin tocar la consulta, para que la lean la
// pantalla de Finanzas (por la ruta) y Sabina (herramienta `gastos`) con la
// misma función: lista = tarjeta = utilidad = lo que dice Sabina.
//
// El clinicId lo pone quien llama, desde la sesión.
// ═══════════════════════════════════════════════════════════════════

/** Cliente de base abierto: `prisma` en producción, el de solo lectura de Sabina en sus herramientas. */
export type GastosDb = any;

/** La tabla expenses puede no existir aún (sql/expenses.sql se corre a mano). */
// ws1-t4: purchaseId y la relación `purchase` (→ InventoryPurchase/
// InventoryProvider) son campos NUEVOS de un modelo VIEJO (Expense). Además
// de P2021/P2022 (columna faltante en la base), un `next dev` que ya tenía
// el singleton de Prisma cargado antes de `npx prisma generate` no lo
// reconstruye solo (medido en vivo por ws1-t5, ver su nota en
// lots.server.ts): con ese cliente viejo, pedir un campo que su DMMF no
// conoce tira `PrismaClientValidationError` (sin `.code`). Se trata igual.
export function isMissingTable(e: any): boolean {
  if (e?.code === "P2021" || e?.code === "P2022") return true;
  return e instanceof Prisma.PrismaClientValidationError;
}

export interface GastoSerializado {
  id: string;
  date: string;
  category: string;
  amount: number;
  note: string | null;
  purchaseId: string | null;
  providerName: string | null;
}

export function serializeGasto(g: {
  id: string; date: Date; category: string; amount: number; note: string | null;
  purchaseId?: string | null; purchase?: { provider: { name: string } | null } | null;
}): GastoSerializado {
  return {
    id:         g.id,
    date:       g.date.toISOString(),
    category:   g.category,
    amount:     money(g.amount ?? 0),
    note:       g.note ?? null,
    // ws1-t4: si el gasto nació de una compra de inventario, lo dice —
    // purchaseId es columna NUEVA (sql/inventario-proveedores-compras-t4.sql).
    purchaseId:   g.purchaseId ?? null,
    providerName: g.purchase?.provider?.name ?? null,
  };
}

/**
 * Los gastos de la clínica en [from, expenseTo], del más reciente al más
 * antiguo. `expenseTo` sale de `expenseWindowEnd` (@/lib/finanzas-periodo).
 * Sin la tabla, `tablaFaltante: true` y lista vacía (nunca un 500).
 */
export async function listarGastosDelPeriodo(
  params: { clinicId: string; from: Date; expenseTo: Date },
  db: GastosDb = prisma,
): Promise<{ gastos: GastoSerializado[]; tablaFaltante?: true }> {
  const { clinicId, from, expenseTo } = params;
  // `clinicId: undefined` no filtra nada en Prisma: sin clínica no se consulta.
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  const where = { clinicId, date: { gte: from, lte: expenseTo } };
  const orderBy = { date: "desc" as const };

  try {
    try {
      // ws1-t4: purchaseId/purchase.provider — columna y tabla nuevas. Si el
      // SQL de compras aún no se pegó, esto truena con P2022/P2021 y cae al
      // select de siempre (catch de abajo), sin que Gastos deje de listar.
      const rows = await db.expense.findMany({
        where, orderBy,
        select: {
          id: true, date: true, category: true, amount: true, note: true, purchaseId: true,
          purchase: { select: { provider: { select: { name: true } } } },
        },
      });
      return { gastos: rows.map(serializeGasto) };
    } catch (inner: any) {
      if (!isMissingTable(inner)) throw inner;
      const rows = await db.expense.findMany({
        where, orderBy,
        select: { id: true, date: true, category: true, amount: true, note: true },
      });
      return { gastos: rows.map(serializeGasto) };
    }
  } catch (err: any) {
    if (isMissingTable(err)) return { gastos: [], tablaFaltante: true };
    throw err;
  }
}
