// Costo de la receta de materiales de cada procedimiento (ws1-t6, H18):
// Σ cantidad × costo unitario del insumo. Alimenta GASTO/MARGEN del catálogo
// cuando el procedimiento no tiene gasto manual. Aislado por clínica.
//
// Tolerante: sin la tabla de recetas (P2021) o sin la columna `unitCost`
// (P2022, SQL de costo sin pegar) devuelve lo que pueda; nunca tumba el catálogo.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { faltaColumnaCosto } from "./costo.server";

export function sumarCostoDeReceta(
  lineas: ReadonlyArray<{ procedureId: string; quantity: number; unitCost: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lineas) {
    const q = Number(l.quantity);
    const c = Number(l.unitCost);
    if (!Number.isFinite(q) || !Number.isFinite(c)) continue;
    out[l.procedureId] = Math.round(((out[l.procedureId] ?? 0) + q * c) * 100) / 100;
  }
  return out;
}

/**
 * `cliente` es opcional y solo lo pasa Sabina (su `ctx.db`, de solo lectura) para
 * leer el costo con ESTA misma función; sin él, el `prisma` del repo, como siempre.
 */
export async function costoDeRecetaPorProcedimiento(clinicId: string, cliente?: unknown): Promise<Record<string, number>> {
  if (!clinicId) return {}; // jamás una consulta sin tenant
  const db = (cliente ?? prisma) as PrismaClient;
  const leer = (conCosto: boolean) =>
    db.procedureMaterialRecipe.findMany({
      where: { clinicId },
      select: { procedureId: true, quantity: true, item: { select: conCosto ? { unitCost: true } : { id: true } } },
    });
  try {
    let filas: Array<{ procedureId: string; quantity: unknown; item: { unitCost?: number } }>;
    try {
      filas = (await leer(true)) as typeof filas;
    } catch (e) {
      if (!faltaColumnaCosto(e)) throw e;
      filas = (await leer(false)) as typeof filas; // sin costo capturado: todo 0 → sin gasto
    }
    return sumarCostoDeReceta(
      filas.map((f) => ({ procedureId: f.procedureId, quantity: Number(f.quantity), unitCost: f.item?.unitCost ?? 0 })),
    );
  } catch {
    return {};
  }
}
