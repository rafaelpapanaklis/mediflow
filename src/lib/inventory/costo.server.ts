// Inventario A (WS1-T4) — capa de Prisma para el costo unitario.
//
// `unitCost` es columna NUEVA de InventoryItem (sql/inventario-costo-t4.sql).
// InventoryItem lo leen y escriben pantallas FUERA de esta tarea (Ejercicios,
// Ortopédicos, el widget de stock bajo de Hoy) con un SELECT por default que
// pide TODAS las columnas del modelo — si la columna no existe aún en la
// base, esas pantallas se caerían con P2022 aunque no les importe el costo.
// Por eso TODA lectura/escritura de InventoryItem que toca `unitCost` pasa
// por aquí: pide el SELECT completo y, si truena por columna faltante,
// reintenta con el SELECT viejo y rellena unitCost en 0 — nunca null (0 es
// "no cuesta nada"; null se leía como "$0 de valor" sin decir por qué).
// Mismo criterio de tolerancia que src/lib/inventory/lots.server.ts: lecturas
// degradan en silencio, escrituras que de verdad necesitan la columna nueva
// SÍ propagan el error (no hay dónde guardar el dato si no existe la columna).
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | PrismaClient;

export function faltaColumnaCosto(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022";
}

/** Forma de InventoryItem ANTES de ws1-t4 — la que siguen esperando Ejercicios,
 * Ortopédicos y el resto de pantallas que no saben de `unitCost`. */
const SELECT_BASE = {
  id: true, clinicId: true, name: true, description: true, category: true,
  emoji: true, quantity: true, minQuantity: true, unit: true, price: true,
  createdAt: true, updatedAt: true,
} as const;

const SELECT_CON_COSTO = { ...SELECT_BASE, unitCost: true } as const;

export type ItemBase = Prisma.InventoryItemGetPayload<{ select: typeof SELECT_BASE }>;
export type ItemConCosto = ItemBase & { unitCost: number };

function conCostoPorDefecto(row: ItemBase): ItemConCosto {
  return { ...row, unitCost: 0 };
}

export interface FiltroInventario {
  clinicId: string;
  category?: string;
}

/** GET /api/inventory y el listado de la página — misma tolerancia que arriba. */
export async function listarInventario(filtro: FiltroInventario, db: Db = prisma): Promise<ItemConCosto[]> {
  const where = { clinicId: filtro.clinicId, ...(filtro.category ? { category: filtro.category } : {}) };
  const orderBy = [{ category: "asc" as const }, { name: "asc" as const }];
  try {
    return await (db as PrismaClient).inventoryItem.findMany({ where, orderBy, select: SELECT_CON_COSTO });
  } catch (e) {
    if (!faltaColumnaCosto(e)) throw e;
    const rows = await (db as PrismaClient).inventoryItem.findMany({ where, orderBy, select: SELECT_BASE });
    return rows.map(conCostoPorDefecto);
  }
}

export async function obtenerInventoryItem(
  where: { id: string; clinicId: string },
  db: Db = prisma,
): Promise<ItemConCosto | null> {
  try {
    return await (db as PrismaClient).inventoryItem.findFirst({ where, select: SELECT_CON_COSTO });
  } catch (e) {
    if (!faltaColumnaCosto(e)) throw e;
    const row = await (db as PrismaClient).inventoryItem.findFirst({ where, select: SELECT_BASE });
    return row ? conCostoPorDefecto(row) : null;
  }
}

export interface DatosNuevoItem {
  clinicId: string;
  name: string;
  description: string | null;
  category: string;
  emoji: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  price: number | null;
  /** 0 = "no cuesta nada", nunca null (ver nota del archivo). */
  unitCost: number;
}

export async function crearInventoryItem(data: DatosNuevoItem, db: Db = prisma): Promise<ItemConCosto> {
  try {
    return await (db as PrismaClient).inventoryItem.create({ data, select: SELECT_CON_COSTO });
  } catch (e) {
    if (!faltaColumnaCosto(e)) throw e;
    const { unitCost, ...base } = data;
    const created = await (db as PrismaClient).inventoryItem.create({ data: base, select: SELECT_BASE });
    return conCostoPorDefecto(created);
  }
}

export type DatosActualizarItem = Partial<{
  name: string;
  description: string | null;
  minQuantity: number;
  unit: string;
  price: number | null;
  emoji: string;
  unitCost: number;
  quantity: number;
  updatedAt: Date;
}>;

/** Cubre los tres PATCH de hoy (delta, set directo, metadata) — todos pasan por aquí. */
export async function actualizarInventoryItem(
  id: string,
  data: DatosActualizarItem,
  db: Db = prisma,
): Promise<ItemConCosto> {
  try {
    return await (db as PrismaClient).inventoryItem.update({ where: { id }, data, select: SELECT_CON_COSTO });
  } catch (e) {
    if (!faltaColumnaCosto(e)) throw e;
    const { unitCost, ...base } = data;
    const updated = await (db as PrismaClient).inventoryItem.update({ where: { id }, data: base, select: SELECT_BASE });
    return conCostoPorDefecto(updated);
  }
}
