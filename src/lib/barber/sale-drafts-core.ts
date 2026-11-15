// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — notas «Por cobrar»: la parte sin sesión.
//
// Sin "server-only" y sin importar prisma: cash.ts (que las pruebas cargan
// en Node pelado) la usa para marcar la nota como cobrada dentro de la
// transacción del ticket.
//
// La nota guarda QUÉ se va a cobrar, nunca cuánto: los precios salen del
// catálogo al cobrar, por el mismo createSale de Caja.
// ═══════════════════════════════════════════════════════════════════════
import type { Prisma } from "@prisma/client";

export const SALE_DRAFT_MAX_LINES = 50;
export const SALE_DRAFT_NOTES_MAX = 500;

export interface SaleDraftLine {
  kind: "service" | "product";
  id: string;
  qty: number;
}

export interface SaleDraftPayload {
  items: SaleDraftLine[];
  barberId: string | null;
  /** Descuento en pesos (texto decimal) o null. */
  discount: string | null;
  /** Descuento en % (texto decimal) o null. Excluye a `discount`. */
  discountPct: string | null;
  notes: string | null;
}

export class SaleDraftInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleDraftInputError";
  }
}

function idOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

function decimalText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  const text = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new SaleDraftInputError(`${field}: inválido`);
  const n = Number(text);
  if (!(n > 0) || n > max) throw new SaleDraftInputError(`${field}: fuera de rango`);
  return text;
}

/**
 * Valida la FORMA de lo que manda la pantalla (sin tocar la base). Que los
 * servicios, productos y barbero sean de la barbería lo comprueba el servidor.
 */
export function normalizeSaleDraftPayload(raw: unknown): SaleDraftPayload {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawItems = Array.isArray(r.items) ? r.items : [];
  if (rawItems.length === 0) throw new SaleDraftInputError("La nota necesita al menos un servicio o producto.");
  if (rawItems.length > SALE_DRAFT_MAX_LINES) throw new SaleDraftInputError(`Máximo ${SALE_DRAFT_MAX_LINES} líneas.`);
  const items = rawItems.map((it, i): SaleDraftLine => {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const kind = o.kind === "service" || o.kind === "product" ? o.kind : null;
    const id = idOf(o.id);
    const qty = o.qty === undefined ? 1 : Number(o.qty);
    if (!kind || !id) throw new SaleDraftInputError(`Línea ${i + 1}: inválida.`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new SaleDraftInputError(`Línea ${i + 1}: cantidad de 1 a 99.`);
    return { kind, id, qty };
  });
  const discount = decimalText(r.discount, "Descuento", 9_999_999.99);
  const discountPct = decimalText(r.discountPct, "Descuento en %", 100);
  if (discount && discountPct) throw new SaleDraftInputError("El descuento va en pesos o en porcentaje, no los dos.");
  const notes = typeof r.notes === "string" ? r.notes.trim().slice(0, SALE_DRAFT_NOTES_MAX) || null : null;
  if (notes && notes.startsWith("[CANCELADA]")) throw new SaleDraftInputError("La nota no puede empezar con la marca de cancelación.");
  return { items, barberId: idOf(r.barberId), discount, discountPct, notes };
}

/** ¿Existe la tabla? `to_regclass` nunca falla (no aborta una transacción). */
export async function saleDraftsReady(db: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<Array<{ ok: boolean }>>`
      SELECT to_regclass('public.barber_sale_drafts') IS NOT NULL AS "ok"
    `;
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Marca la nota como COBRADA por ese ticket, dentro de la transacción del
 * cobro. Una sola vez: exige que siga abierta, que sea de la barbería y que el
 * cliente coincida. Devuelve false si no se pudo (la transacción debe caer).
 */
export async function markSaleDraftChargedTx(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  args: { draftId: string; barbershopId: string; clientId: string | null; saleId: string; userId: string },
): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE "barber_sale_drafts"
    SET "status" = 'CHARGED', "saleId" = ${args.saleId}, "closedAt" = NOW(),
        "closedByUserId" = ${args.userId}, "updatedAt" = NOW()
    WHERE "id" = ${args.draftId} AND "barbershopId" = ${args.barbershopId}
      AND "status" = 'OPEN' AND "clientId" IS NOT DISTINCT FROM ${args.clientId}::text
  `;
  return n === 1;
}

/**
 * Cancelar el ticket que salió de una nota «Por cobrar» la REABRE: vuelve a
 * OPEN, sin ticket, para cobrarse de nuevo o descartarse (ronda 2, M1). Es lo
 * coherente con Caja: cancelar regresa lo que el ticket se llevó (stock,
 * membresía, estrellas, anticipo). Va en la MISMA transacción que la
 * cancelación. Devuelve cuántas notas reabrió (0 si el ticket no venía de una).
 */
export async function reopenSaleDraftOfCancelledSaleTx(
  tx: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  args: { saleId: string; barbershopId: string; userId: string },
): Promise<number> {
  if (!(await saleDraftsReady(tx))) return 0;
  return tx.$executeRaw`
    UPDATE "barber_sale_drafts"
    SET "status" = 'OPEN', "saleId" = NULL, "closedAt" = NULL, "closedByUserId" = NULL,
        "updatedByUserId" = ${args.userId}, "updatedAt" = NOW()
    WHERE "saleId" = ${args.saleId} AND "barbershopId" = ${args.barbershopId} AND "status" = 'CHARGED'
  `;
}
