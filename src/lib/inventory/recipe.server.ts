// Inventario B (WS1-T5) — "receta de materiales" por procedimiento del
// catálogo: qué insumos y cuánto gasta UNA realización. Al registrar la
// sesión (treatments/[id]), se multiplica por 1 y se descuenta por FEFO en
// la misma transacción — ver consumeRecipeForSession.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeFefoTx } from "./lots.server";

type Tx = Prisma.TransactionClient | PrismaClient;

// Ver la nota gemela en lots.server.ts: el TypeError cubre el proceso de
// `next dev` que ya tenía el singleton de Prisma vivo antes del `generate`.
function isMissingRelation(e: any): boolean {
  if (e?.code === "P2021" || e?.code === "P2022") return true;
  if (e instanceof TypeError && /Cannot read propert(y|ies) of undefined/.test(e.message ?? "")) return true;
  return false;
}

export interface RecipeLineDTO {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
}

/** Receta completa de un procedimiento, aislada por clínica. */
export async function getRecipe(clinicId: string, procedureId: string, db: Tx = prisma): Promise<RecipeLineDTO[]> {
  try {
    const lines = await (db as PrismaClient).procedureMaterialRecipe.findMany({
      where:   { clinicId, procedureId },
      include: { item: { select: { name: true, unit: true } } },
      orderBy: { createdAt: "asc" },
    });
    return lines.map(l => ({
      itemId:   l.itemId,
      itemName: l.item.name,
      unit:     l.item.unit,
      quantity: Number(l.quantity),
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

export async function upsertRecipeLine(clinicId: string, procedureId: string, itemId: string, quantity: number, db: Tx = prisma): Promise<void> {
  if (!(quantity > 0)) throw new Error("La cantidad debe ser mayor a 0");

  const [procedure, item] = await Promise.all([
    (db as PrismaClient).procedureCatalog.findFirst({ where: { id: procedureId, clinicId } }),
    (db as PrismaClient).inventoryItem.findFirst({ where: { id: itemId, clinicId } }),
  ]);
  if (!procedure) throw new Error("Procedimiento no encontrado");
  if (!item) throw new Error("Insumo no encontrado");

  await (db as PrismaClient).procedureMaterialRecipe.upsert({
    where:  { procedureId_itemId: { procedureId, itemId } },
    create: { clinicId, procedureId, itemId, quantity },
    update: { quantity },
  });
}

export async function deleteRecipeLine(clinicId: string, procedureId: string, itemId: string, db: Tx = prisma): Promise<void> {
  await (db as PrismaClient).procedureMaterialRecipe.deleteMany({ where: { clinicId, procedureId, itemId } });
}

export interface RecipeConsumptionResult {
  itemId: string;
  itemName: string;
  qtyConsumed: number;
}

/**
 * Descuenta la receta completa de un procedimiento dentro de la MISMA
 * transacción `tx` que registra la sesión. Si algún insumo no alcanza,
 * lanza InsufficientStockError (ver lots.server.ts) y la transacción entera
 * se revierte: la sesión no queda a medias con solo parte del descuento.
 * Procedimiento sin receta capturada → no hace nada (no es un error).
 */
export async function consumeRecipeForSession(
  tx: Tx,
  params: { clinicId: string; procedureId: string; treatmentSessionId: string; userId?: string | null; sessionLabel: string },
): Promise<RecipeConsumptionResult[]> {
  let lines: { itemId: string; quantity: Prisma.Decimal; item: { name: string } }[];
  try {
    lines = await (tx as PrismaClient).procedureMaterialRecipe.findMany({
      where:   { clinicId: params.clinicId, procedureId: params.procedureId },
      include: { item: { select: { name: true } } },
    });
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
  if (lines.length === 0) return [];

  const results: RecipeConsumptionResult[] = [];
  for (const line of lines) {
    const qty = Number(line.quantity);
    await consumeFefoTx(tx, {
      clinicId:           params.clinicId,
      itemId:             line.itemId,
      itemName:           line.item.name,
      qty,
      reason:             `Receta — ${params.sessionLabel}`,
      userId:             params.userId ?? null,
      treatmentSessionId: params.treatmentSessionId,
    });
    results.push({ itemId: line.itemId, itemName: line.item.name, qtyConsumed: qty });
  }
  return results;
}
