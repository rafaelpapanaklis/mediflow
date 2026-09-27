// Inventario A (WS1-T4) — "Registrar compra": en UNA transacción, suma
// existencias, actualiza el costo (ÚLTIMO costo, ver la nota de
// InventoryPurchase en schema.prisma) al artículo, escribe la bitácora y
// crea el gasto "Insumos" ligado a la compra.
//
// inventory_purchases/inventory_purchase_lines son tablas NUEVAS
// (sql/inventario-proveedores-compras-t4.sql). Mientras no se peguen: la
// pantalla de compras responde 503 (mismo criterio que gastos/route.ts) — no
// hay "degradar en silencio" razonable para una escritura de dinero.
//
// Idempotencia: el cliente genera `idempotencyKey` UNA vez al abrir el modal
// y lo reenvía tal cual en un reintento (doble clic, refresh con el POST en
// vuelo). @@unique([clinicId, idempotencyKey]) en la base es la garantía de
// verdad; el pre-check aquí es solo para no abrir una transacción de más en
// el caso feliz.
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/caja";
import { signMaybeUrls } from "@/lib/storage";
import { validarLineaCompra, montoTotalCompra, type LineaCompra } from "./costo-core";
import { aplicarEntradaDeCompra } from "./costo.server";
import { registrarHistorialInventario } from "./historial.server";
// WS1-T5 (ajuste 2) — enlace automático compra→lote sobre el
// InventoryPurchaseLine.id estable de abajo. Ver la nota completa en el
// propio archivo: nunca toca InventoryItem (eso ya lo hace
// aplicarEntradaDeCompra, arriba), y es silencioso si el SQL de lotes de
// ws1-t5 aún no está aplicado.
import { crearLoteDeLineaDeCompra } from "./compra-lote.server";

// P2021/P2022 (tabla/columna faltante en la base) + los dos casos del
// cliente de Prisma VIEJO en un `next dev` que no se reinicia solo tras
// `npx prisma generate` (medido en vivo por ws1-t5 en este dev.108, ver su
// nota en lots.server.ts): TypeError por un modelo nuevo que no existe como
// propiedad (inventoryPurchase/inventoryPurchaseLine) y
// PrismaClientValidationError por un campo nuevo que ese cliente no conoce
// en un modelo viejo (unitCost al actualizar InventoryItem).
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") return true;
  if (e instanceof Prisma.PrismaClientValidationError) return true;
  return e instanceof TypeError && /Cannot read propert(y|ies) of undefined/.test(e.message ?? "");
}

function esViolacionUnica(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

export class ComprasTablaFaltanteError extends Error {
  code = "COMPRAS_TABLA_FALTANTE" as const;
  constructor() { super("La tabla inventory_purchases no existe aún. Aplica sql/inventario-proveedores-compras-t4.sql en Supabase."); }
}

export class LineaInvalidaError extends Error {
  code = "LINEA_INVALIDA" as const;
}

export class ArticuloNoEncontradoError extends Error {
  code = "ARTICULO_NO_ENCONTRADO" as const;
  constructor() { super("Uno o más artículos de la compra no existen en esta clínica."); }
}

export interface LineaCompraInput extends LineaCompra {
  itemId: string;
  // WS1-T5 (ajuste 2) — opcionales: si vienen, esta línea crea su propio
  // InventoryLot (enlace automático compra→lote). Sin ellos, la existencia
  // sigue entrando al colchón "sin lote" como siempre.
  lotNumber?: string | null;
  expiresAt?: Date | null;
}

export interface DatosCompra {
  clinicId: string;
  providerId: string | null;
  date: Date;
  receiptRef: string | null;
  createdById: string;
  idempotencyKey: string | null;
  lines: LineaCompraInput[];
}

export interface ItemActualizado {
  itemId: string;
  quantity: number;
  unitCost: number;
}

export interface CompraResultado {
  purchaseId: string;
  expenseId: string | null;
  total: number;
  yaExistia: boolean;
  items: ItemActualizado[];
}

async function resultadoDeCompraExistente(
  db: PrismaClient,
  clinicId: string,
  purchaseId: string,
): Promise<CompraResultado> {
  const [purchase, lines] = await Promise.all([
    db.inventoryPurchase.findFirst({ where: { id: purchaseId, clinicId }, include: { expense: { select: { id: true } } } }),
    db.inventoryPurchaseLine.findMany({ where: { purchaseId }, select: { itemId: true, quantity: true, unitCost: true } }),
  ]);
  return {
    purchaseId,
    expenseId: purchase?.expense?.id ?? null,
    total: montoTotalCompra(lines),
    yaExistia: true,
    items: lines.map(l => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost })),
  };
}

export async function registrarCompra(datos: DatosCompra, db: PrismaClient = prisma): Promise<CompraResultado> {
  if (datos.lines.length === 0) {
    throw new LineaInvalidaError("La compra necesita al menos una línea.");
  }
  for (const linea of datos.lines) {
    const err = validarLineaCompra(linea);
    if (err) throw new LineaInvalidaError(err);
  }

  try {
    // Caso feliz: doble clic con la misma llave ya resuelta antes de abrir transacción.
    if (datos.idempotencyKey) {
      const existente = await db.inventoryPurchase.findFirst({
        where: { clinicId: datos.clinicId, idempotencyKey: datos.idempotencyKey },
        select: { id: true },
      });
      if (existente) return resultadoDeCompraExistente(db, datos.clinicId, existente.id);
    }

    return await db.$transaction(async (tx) => {
      const itemIds = Array.from(new Set(datos.lines.map((l) => l.itemId)));
      const items = await tx.inventoryItem.findMany({
        where:  { id: { in: itemIds }, clinicId: datos.clinicId },
        select: { id: true, name: true },
      });
      if (items.length !== itemIds.length) throw new ArticuloNoEncontradoError();
      const nombrePorId = new Map(items.map((i) => [i.id, i.name]));

      const purchase = await tx.inventoryPurchase.create({
        data: {
          clinicId:       datos.clinicId,
          providerId:     datos.providerId,
          date:           datos.date,
          receiptRef:     datos.receiptRef,
          createdById:    datos.createdById,
          idempotencyKey: datos.idempotencyKey,
        },
        select: { id: true },
      });

      const itemsActualizados: ItemActualizado[] = [];
      for (const linea of datos.lines) {
        const purchaseLine = await tx.inventoryPurchaseLine.create({
          data: { purchaseId: purchase.id, itemId: linea.itemId, quantity: linea.quantity, unitCost: linea.unitCost },
        });
        await aplicarEntradaDeCompra(linea.itemId, { quantityDelta: linea.quantity, unitCost: linea.unitCost }, tx);
        // WS1-T5 (ajuste 2) — enlace automático compra→lote. Después de
        // aplicarEntradaDeCompra a propósito: el agregado ya se movió, este
        // lote solo etiqueta parte de ese movimiento, nunca lo repite.
        await crearLoteDeLineaDeCompra(tx, {
          clinicId:       datos.clinicId,
          purchaseLineId: purchaseLine.id,
          itemId:         linea.itemId,
          quantity:       linea.quantity,
          unitCost:       linea.unitCost,
          lotNumber:      linea.lotNumber ?? null,
          expiresAt:      linea.expiresAt ?? null,
        });
        await registrarHistorialInventario({
          itemId:   linea.itemId,
          clinicId: datos.clinicId,
          userId:   datos.createdById,
          change:   linea.quantity,
          reason:   `Compra${nombrePorId.get(linea.itemId) ? ` — ${nombrePorId.get(linea.itemId)}` : ""}`,
          type:     "purchase",
        }, tx);
        const actual = await tx.inventoryItem.findFirst({ where: { id: linea.itemId }, select: { quantity: true } });
        itemsActualizados.push({ itemId: linea.itemId, quantity: actual?.quantity ?? linea.quantity, unitCost: linea.unitCost });
      }

      const total = montoTotalCompra(datos.lines);
      const expense = await tx.expense.create({
        data: {
          clinicId:    datos.clinicId,
          date:        datos.date,
          category:    "Insumos",
          amount:      money(total),
          note:        `Compra de inventario${datos.receiptRef ? ` — comprobante ${datos.receiptRef}` : ""}`,
          createdById: datos.createdById,
          purchaseId:  purchase.id,
        },
        select: { id: true },
      });

      return { purchaseId: purchase.id, expenseId: expense.id, total, yaExistia: false, items: itemsActualizados };
    });
  } catch (e) {
    if (faltaTabla(e)) throw new ComprasTablaFaltanteError();
    if (esViolacionUnica(e) && datos.idempotencyKey) {
      const existente = await db.inventoryPurchase.findFirst({
        where: { clinicId: datos.clinicId, idempotencyKey: datos.idempotencyKey },
        select: { id: true },
      });
      if (existente) return resultadoDeCompraExistente(db, datos.clinicId, existente.id);
    }
    throw e;
  }
}

export interface CompraListada {
  id: string;
  date: string;
  providerName: string | null;
  receiptRef: string | null;
  /** Ajuste 1 — comprobante como archivo (foto o PDF), aparte del folio de texto. */
  receiptFileUrl: string | null;
  receiptFileName: string | null;
  createdByName: string | null;
  total: number;
  expenseId: string | null;
  lines: { itemId: string; itemName: string; quantity: number; unitCost: number }[];
}

/** Ajuste 1 — "quién la registró": createdById es un id suelto SIN @relation
 * a propósito (mismo criterio que AppointmentDeposit.createdById — ver su
 * nota), así que el nombre se resuelve con un lookup aparte, no un include. */
export async function listarCompras(clinicId: string, db: PrismaClient = prisma): Promise<CompraListada[]> {
  try {
    const compras = await db.inventoryPurchase.findMany({
      where:   { clinicId },
      orderBy: { date: "desc" },
      take:    50,
      include: {
        provider: { select: { name: true } },
        expense:  { select: { id: true } },
        lines:    { include: { item: { select: { name: true } } } },
      },
    });
    const userIds = Array.from(new Set(compras.map((c) => c.createdById)));
    const usuarios = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nombrePorUsuario = new Map(usuarios.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    // Ajuste 1: firma TODAS las URLs de comprobante en un round-trip (mismo
    // patrón que /api/xrays) — no N× llamadas por fila.
    const urls = await signMaybeUrls(compras.map((c) => c.receiptFilePath));

    return compras.map((c, i) => ({
      id:              c.id,
      date:            c.date.toISOString(),
      providerName:    c.provider?.name ?? null,
      receiptRef:      c.receiptRef,
      receiptFileUrl:  urls[i] || null,
      receiptFileName: c.receiptFileName,
      createdByName:   nombrePorUsuario.get(c.createdById) ?? null,
      expenseId:       c.expense?.id ?? null,
      total:           montoTotalCompra(c.lines),
      lines:           c.lines.map((l) => ({ itemId: l.itemId, itemName: l.item.name, quantity: l.quantity, unitCost: l.unitCost })),
    }));
  } catch (e) {
    if (faltaTabla(e)) return [];
    throw e;
  }
}
