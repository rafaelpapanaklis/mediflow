// Inventario A (WS1-T4) — bitácora de InventoryHistory con usuario, clinicId
// y tipo (antes solo tenía itemId/change/reason y nada la leía).
//
// clinicId/userId/type son columnas NUEVAS (sql/inventario-costo-t4.sql).
// Nada fuera de este módulo consulta InventoryHistory hoy (ver diagnóstico
// REPORTE-ws1-t8.md, "3 · INVENTARIO Y GASTOS"), así que no hay otro SELECT
// que proteger — pero SÍ toleramos que las columnas no existan aún: la
// bitácora es de apoyo, y perder una línea de historial es mucho más barato
// que tumbar el ajuste de existencias / el descuento de una sesión que la
// dispara. Por eso la escritura ATRAPA el error (P2021/P2022 o cualquier
// otro) y solo lo reporta a consola — nunca deja que una bitácora rota
// tumbe la operación real.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | PrismaClient;

export interface DatosHistorialInventario {
  itemId: string;
  change: number;
  reason?: string | null;
  clinicId?: string;
  userId?: string;
  /** "adjust" (ajuste manual) | "session" (descuento por sesión de
   * tratamiento) | "purchase" (entrada por compra, ws1-t4). */
  type?: "adjust" | "session" | "purchase";
}

export async function registrarHistorialInventario(datos: DatosHistorialInventario, db: Db = prisma): Promise<void> {
  try {
    await (db as PrismaClient).inventoryHistory.create({
      data: {
        itemId:   datos.itemId,
        change:   datos.change,
        reason:   datos.reason ?? null,
        clinicId: datos.clinicId ?? null,
        userId:   datos.userId ?? null,
        type:     datos.type ?? "adjust",
      },
    });
  } catch (e) {
    console.error("[inventory-history] no se pudo escribir la bitácora:", (e as Error)?.message ?? e);
  }
}
