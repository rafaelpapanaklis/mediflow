// Capa de datos del módulo Presupuestos: saneo de ítems, folio con reintento y
// recarga scoped. La usan todas las rutas /api/quotes.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Crea un presupuesto asignando folio P-000N por clínica, con reintento ante carrera. */
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
    const count = await prisma.quote.count({ where: { clinicId: args.clinicId } });
    const folio = formatFolio(count + 1 + attempt);
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
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("No se pudo asignar un folio único");
}

/**
 * Reemplaza por completo título / ítems / descuentos / vigencia / notas de un
 * presupuesto en DRAFT (transacción: borra ítems viejos, recrea, recalcula).
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
}) {
  const sanitized = await sanitizeItems(args.clinicId, args.items);
  const totals = computeTotals(sanitized, {
    discountPct: args.discountPct,
    discountAmount: args.discountAmount,
  });
  const itemsData = buildItemsData(totals.items);

  return prisma.$transaction(async (tx) => {
    await tx.quoteItem.deleteMany({ where: { quoteId: args.quoteId } });
    return tx.quote.update({
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
  });
}

/** Default de vigencia: 30 días. Acepta ISO o null. */
export function parseValidUntil(raw: unknown, fallbackDays = 30): Date {
  if (raw) {
    const d = new Date(String(raw));
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000);
}
