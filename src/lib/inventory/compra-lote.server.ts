// Inventario B (WS1-T5, ajuste 2) — enlace AUTOMÁTICO compra → lote, sobre
// el InventoryPurchaseLine.id ESTABLE que deja ws1-t4 (coordinado: su
// commit c5f0be03 y REPORTE-ws1-t4.md dicen "id ESTABLE — ws1-t5 cuelga su
// tabla de lotes de aquí").
//
// Cardinalidad 1:1 línea↔lote: InventoryLot.purchaseLineId es un campo
// escalar (una sola línea de origen), así que "crea o suma" aquí significa
// "idempotente por purchaseLineId": si esta línea YA generó su lote (una
// re-ejecución, o dos llamadas por seguridad), NO se duplica ni se suma dos
// veces — se crea EXACTAMENTE un lote por línea que trae lote y/o
// caducidad. Esto NO fusiona con un lote de OTRA compra que comparta el
// mismo número de lote físico (dos entregas del mismo lote del proveedor
// quedan como dos filas en InventoryLot, cada una con su propio
// purchaseLineId) — si Rafael quiere que se sumen, es un cambio deliberado
// aparte (ver preguntas abiertas del reporte).
//
// IMPORTANTE: esta función NUNCA toca InventoryItem.quantity/quantityPrecise.
// Eso ya lo hace aplicarEntradaDeCompra (ws1-t4, costo.server.ts) en la
// MISMA transacción, antes de llamar aquí. Si esto también tocara el
// agregado, la existencia quedaría contada DOS VECES (una por la compra,
// otra por el lote) — la reconciliación de lots.server.ts detectaría el
// sobrante en la siguiente lectura y lo recortaría, pero es innecesario:
// basta con no tocarlo aquí.
//
// Sin lote ni caducidad en la línea (el caso de hoy, compras sin ese dato
// capturado): no hace nada — la existencia sigue entrando al colchón "sin
// lote" vía la reconciliación normal de lots.server.ts, exactamente como
// antes de este ajuste.
//
// Resiliente a que el SQL de LOTES (sql/inventario-lotes-caducidad-t5-
// estructura.sql) todavía no esté aplicado, aunque el de COMPRAS de t4 sí
// lo esté: la compra se registra igual (con su costo, existencia y gasto),
// solo que sin lote — nunca bloquea "Registrar compra" por esto.
import { Prisma, type PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

function faltaTablaDeLotes(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") return true;
  if (e instanceof Prisma.PrismaClientValidationError) return true;
  return e instanceof TypeError && /Cannot read propert(y|ies) of undefined/.test((e as Error).message ?? "");
}

export interface LoteDeCompra {
  clinicId: string;
  purchaseLineId: string;
  itemId: string;
  quantity: number;
  unitCost: number | null;
  lotNumber: string | null;
  expiresAt: Date | null;
}

/**
 * Crea el InventoryLot de una línea de compra que trae lote y/o caducidad.
 * Idempotente por purchaseLineId. No toca InventoryItem — ver nota del
 * archivo. Silenciosa si la tabla de lotes aún no existe (no bloquea la
 * compra de t4 por un SQL que no es el suyo).
 */
export async function crearLoteDeLineaDeCompra(tx: Tx, datos: LoteDeCompra): Promise<void> {
  if (!datos.lotNumber && !datos.expiresAt) return; // sin dato de lote: nada que hacer
  if (!(datos.quantity > 0)) return;

  try {
    const existente = await (tx as PrismaClient).inventoryLot.findFirst({
      where: { purchaseLineId: datos.purchaseLineId },
      select: { id: true },
    });
    if (existente) return; // ya procesada — idempotente por purchaseLineId

    const lote = await (tx as PrismaClient).inventoryLot.create({
      data: {
        clinicId:       datos.clinicId,
        itemId:         datos.itemId,
        lotNumber:      datos.lotNumber,
        expiresAt:      datos.expiresAt,
        quantity:       datos.quantity,
        remaining:      datos.quantity,
        unitCost:       datos.unitCost,
        purchaseLineId: datos.purchaseLineId,
      },
      select: { id: true },
    });
    await (tx as PrismaClient).inventoryLotMovement.create({
      data: {
        lotId:    lote.id,
        clinicId: datos.clinicId,
        change:   datos.quantity,
        reason:   "Alta por compra",
      },
    });
  } catch (e) {
    if (faltaTablaDeLotes(e)) return; // el SQL de lotes de ws1-t5 aún no está — la compra sigue sin lote
    throw e;
  }
}
