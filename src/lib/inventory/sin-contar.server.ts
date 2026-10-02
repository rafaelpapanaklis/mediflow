// «Sin contar» — un artículo en cero del que NADIE ha dicho jamás cuánto hay.
//
// Por qué existe (ticket 3 de BEVADENT, 12f): al abrir Inventario por primera
// vez la página siembra ~109 artículos dentales con `quantity: 0` (page.tsx).
// Nadie los contó, pero la pantalla los pintaba «Agotado» (rojo) y «Hoy» avisaba
// «109 insumos agotados». «Agotado» es una afirmación («había y se acabó»); un
// artículo que nunca se contó no lo afirma: lo que falta es capturar su
// existencia.
//
// Cómo se sabe que nunca se contó (sin columna nueva, sin SQL): existencias en
// cero Y ni una fila en la bitácora `inventory_history` (ajustes, descuentos de
// sesión, compras y altas con cantidad escriben ahí) Y ningún lote. En cuanto
// alguien ajusta, compra, da de alta con cantidad o consume una unidad, el
// artículo deja de ser «sin contar» para siempre — incluso si vuelve a cero:
// ahí sí está agotado de verdad. Contar «cero» a propósito (PATCH quantity=0
// sobre un artículo en cero) también deja huella: ver PATCH /api/inventory/[id].
//
// Falla hacia lo de siempre: si la lectura de la bitácora falla, no se declara
// nada «sin contar» (se vería «Agotado», como antes) en vez de esconder un
// agotado real.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listarInventario, type ItemConCosto } from "./costo.server";

type Db = PrismaClient;

/** Un artículo con existencias en cero y sin historia: nunca se contó. */
export function esSinContar(quantity: number, conMovimientos: boolean): boolean {
  return quantity <= 0 && !conMovimientos;
}

/**
 * Ids (de `items`, que YA son de la clínica) de los artículos en cero que
 * nunca se contaron. Solo consulta por los que están en cero: un artículo con
 * existencias está contado por definición.
 */
export async function idsSinContar(
  clinicId: string,
  items: ReadonlyArray<{ id: string; quantity: number }>,
  db: Db = prisma,
): Promise<Set<string>> {
  const ceros = items.filter((i) => i.quantity <= 0).map((i) => i.id);
  if (ceros.length === 0) return new Set();
  try {
    // El filtro de tenant va por la relación (la columna clinicId de la
    // bitácora es nueva y las filas viejas la traen vacía).
    const [historia, lotes] = await Promise.all([
      db.inventoryHistory.findMany({
        where: { itemId: { in: ceros }, item: { clinicId } },
        select: { itemId: true },
        distinct: ["itemId"],
      }),
      db.inventoryLot
        .findMany({ where: { clinicId, itemId: { in: ceros } }, select: { itemId: true }, distinct: ["itemId"] })
        // Sin el SQL de lotes aplicado: simplemente no hay lotes que mirar.
        .catch(() => [] as Array<{ itemId: string }>),
    ]);
    const conMovimientos = new Set<string>([...historia.map((h) => h.itemId), ...lotes.map((l) => l.itemId)]);
    return new Set(ceros.filter((id) => esSinContar(0, conMovimientos.has(id))));
  } catch (e) {
    console.error("[inventory] no se pudo saber qué artículos están sin contar:", (e as Error)?.message ?? e);
    return new Set();
  }
}

export type ItemConConteo = ItemConCosto & { sinContar: boolean };

/** `listarInventario` + la marca `sinContar` de cada artículo (pantalla y GET /api/inventory). */
export async function listarInventarioConConteo(
  filtro: { clinicId: string; category?: string },
  db: Db = prisma,
): Promise<ItemConConteo[]> {
  const items = await listarInventario(filtro, db);
  const sin = await idsSinContar(filtro.clinicId, items, db);
  return items.map((i) => ({ ...i, sinContar: sin.has(i.id) }));
}
