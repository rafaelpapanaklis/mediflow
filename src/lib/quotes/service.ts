// Capa de datos del módulo Presupuestos: saneo de ítems, folio con reintento y
// recarga scoped. La usan todas las rutas /api/quotes.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_INVOICE_FOLIO_DIGITS } from "@/lib/invoices/next-invoice-number-core";
import { computeTotals, formatFolio } from "./compute";
import type { QuoteItemInput } from "./types";

export const QUOTE_INCLUDE = {
  items: { orderBy: { sortOrder: "asc" as const } },
  createdBy: { select: { firstName: true, lastName: true } },
  patient: { select: { firstName: true, lastName: true } },
};

function sanitizeFdi(s?: string | null): string | null {
  if (!s) return null;
  const cleaned = String(s)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d{1,2}$/.test(x))
    .slice(0, 32);
  return cleaned.length ? cleaned.join(",") : null;
}

/**
 * Sanea ítems del editor: descarta líneas sin nombre y ANULA cualquier
 * procedureId que no pertenezca a la clínica (defensa multi-tenant).
 */
export async function sanitizeItems(
  clinicId: string,
  rawItems: QuoteItemInput[],
): Promise<QuoteItemInput[]> {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const ids = Array.from(
    new Set(items.map((i) => i.procedureId).filter((x): x is string => !!x)),
  );
  let validIds = new Set<string>();
  if (ids.length > 0) {
    const found = await prisma.procedureCatalog.findMany({
      where: { clinicId, id: { in: ids } },
      select: { id: true },
    });
    validIds = new Set(found.map((f) => f.id));
  }
  return items
    .filter((i) => i && typeof i.name === "string" && i.name.trim().length > 0)
    .map((i) => ({
      procedureId: i.procedureId && validIds.has(i.procedureId) ? i.procedureId : null,
      name: String(i.name).trim().slice(0, 200),
      toothFdi: sanitizeFdi(i.toothFdi),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount ?? 0,
      phase: i.phase ?? null,
      notes: i.notes ? String(i.notes).slice(0, 500) : null,
    }));
}

function buildItemsData(items: ReturnType<typeof computeTotals>["items"]): any[] {
  return items.map((it, i) => ({
    procedureId: it.procedureId ?? null,
    name: it.name,
    toothFdi: it.toothFdi ?? null,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discount: it.discount,
    lineTotal: it.lineTotal,
    phase: it.phase ?? null,
    notes: it.notes ?? null,
    sortOrder: i,
  }));
}

/**
 * Mayor folio de presupuesto emitido en la clínica (o null si no hay ninguno
 * numérico). Espejo de lastInvoiceFolio (@/lib/invoices/next-invoice-number):
 * el folio sale del MÁXIMO REALMENTE EMITIDO, nunca de un COUNT de filas — con
 * huecos por borrado (los DRAFT se borran en duro), count+1 apunta a un folio
 * ya emitido → P2002 permanente. Se toma el ÚLTIMO bloque de dígitos y se
 * compara como NÚMERO; el filtro por longitud evita que un folio absurdo
 * reviente el CAST (22003). Tabla física: "quotes" (@@map del modelo Quote).
 */
async function lastQuoteFolio(clinicId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ max: bigint | number | null }[]>`
    SELECT MAX(CAST(digits AS BIGINT)) AS max
    FROM (
      SELECT substring("folio" from '([0-9]+)[^0-9]*$') AS digits
      FROM "quotes"
      WHERE "clinicId" = ${clinicId}
    ) s
    WHERE digits IS NOT NULL AND length(digits) <= ${MAX_INVOICE_FOLIO_DIGITS}
  `;
  const raw = rows[0]?.max ?? null;
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * ¿El error es un P2002 del índice de folio (@@unique([clinicId, folio]))?
 * isInvoiceNumberConflict del core NO sirve aquí: su detector exige
 * "invoiceNumber" en meta.target. Mismo criterio documentado allá: sin target
 * no podemos distinguirlo y asumimos que es el folio — reintentar es inocuo
 * (el folio se recalcula) y si era otro índice el P2002 reaparece en cada
 * intento hasta agotar los reintentos.
 */
function isQuoteFolioConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
  return text === "" || text.includes("folio");
}

/**
 * Crea un presupuesto asignando folio P-000N por clínica, con reintento ante
 * carrera. El folio sale de MAX(último bloque de dígitos) + 1 — nunca de
 * count+1 (ver lastQuoteFolio) — y se recalcula en CADA intento.
 */
export async function createQuoteWithFolio(args: {
  clinicId: string;
  patientId: string;
  createdById: string | null;
  title: string;
  items: QuoteItemInput[];
  discountPct?: number | null;
  discountAmount?: number | null;
  validUntil: Date | null;
  notes: string | null;
}) {
  const sanitized = await sanitizeItems(args.clinicId, args.items);
  const totals = computeTotals(sanitized, {
    discountPct: args.discountPct,
    discountAmount: args.discountAmount,
  });
  const itemsData = buildItemsData(totals.items);

  for (let attempt = 0; attempt < 8; attempt++) {
    const folio = formatFolio(((await lastQuoteFolio(args.clinicId)) ?? 0) + 1);
    try {
      return await prisma.quote.create({
        data: {
          clinicId: args.clinicId,
          patientId: args.patientId,
          createdById: args.createdById,
          folio,
          title: args.title,
          subtotal: totals.subtotal,
          discountPct: args.discountPct == null ? null : Math.min(100, Math.max(0, Number(args.discountPct))),
          discountAmount: totals.discountAmount,
          total: totals.total,
          validUntil: args.validUntil,
          notes: args.notes,
          items: { create: itemsData },
        },
        include: QUOTE_INCLUDE,
      });
    } catch (e) {
      // Solo la carrera de folio se reintenta (recalculando el MAX); cualquier
      // otro error —incluido un P2002 de otro índice con target— se propaga.
      if (isQuoteFolioConflict(e)) continue;
      throw e;
    }
  }
  throw new Error("No se pudo asignar un folio único");
}

/**
 * Reemplaza por completo título / ítems / descuentos / vigencia / notas de un
 * presupuesto en DRAFT (transacción: borra ítems viejos, recrea, recalcula).
 *
 * `tx` opcional: si el caller ya está dentro de una transacción (el PATCH, que
 * además re-sincroniza la factura BORRADOR ligada — FIN-05), se ejecuta en ESA
 * transacción para que presupuesto y factura cambien juntos o no cambie nada.
 */
export async function replaceQuoteContent(args: {
  quoteId: string;
  clinicId: string;
  title: string;
  items: QuoteItemInput[];
  discountPct?: number | null;
  discountAmount?: number | null;
  validUntil: Date | null;
  notes: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const sanitized = await sanitizeItems(args.clinicId, args.items);
  const totals = computeTotals(sanitized, {
    discountPct: args.discountPct,
    discountAmount: args.discountAmount,
  });
  const itemsData = buildItemsData(totals.items);

  const run = async (db: Prisma.TransactionClient) => {
    await db.quoteItem.deleteMany({ where: { quoteId: args.quoteId } });
    return db.quote.update({
      where: { id: args.quoteId },
      data: {
        title: args.title,
        subtotal: totals.subtotal,
        discountPct: args.discountPct == null ? null : Math.min(100, Math.max(0, Number(args.discountPct))),
        discountAmount: totals.discountAmount,
        total: totals.total,
        validUntil: args.validUntil,
        notes: args.notes,
        items: { create: itemsData },
      },
      include: QUOTE_INCLUDE,
    });
  };
  return args.tx ? run(args.tx) : prisma.$transaction(run);
}

/** Default de vigencia: 30 días. Acepta ISO o null. */
export function parseValidUntil(raw: unknown, fallbackDays = 30): Date {
  if (raw) {
    const d = new Date(String(raw));
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000);
}
