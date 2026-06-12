// Serialización Prisma → DTO. Convierte Decimal a number y Date a ISO antes de
// cruzar a cualquier client component (Decimal/Date no son serializables).

import type {
  QuoteDTO,
  QuoteItemDTO,
  QuoteStatus,
  PublicQuoteView,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(x: any): number {
  if (x == null) return 0;
  const v = Number(x);
  return isFinite(v) ? v : 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numOrNull(x: any): number | null {
  if (x == null) return null;
  const v = Number(x);
  return isFinite(v) ? v : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function iso(x: any): string | null {
  if (!x) return null;
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x.toISOString();
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeQuoteItem(it: any): QuoteItemDTO {
  return {
    id: it.id,
    procedureId: it.procedureId ?? null,
    name: it.name,
    toothFdi: it.toothFdi ?? null,
    quantity: Math.floor(num(it.quantity)) || 1,
    unitPrice: num(it.unitPrice),
    discount: num(it.discount),
    lineTotal: num(it.lineTotal),
    phase: it.phase == null ? null : Math.floor(num(it.phase)),
    notes: it.notes ?? null,
    sortOrder: Math.floor(num(it.sortOrder)),
  };
}

/** Convierte un Quote de Prisma (con items, y opcionalmente patient/createdBy). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeQuote(q: any): QuoteDTO {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (q.items ?? [])
    .slice()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => num(a.sortOrder) - num(b.sortOrder))
    .map(serializeQuoteItem);

  const createdByName = q.createdBy
    ? `${q.createdBy.firstName ?? ""} ${q.createdBy.lastName ?? ""}`.trim() || null
    : null;
  const patientName = q.patient
    ? `${q.patient.firstName ?? ""} ${q.patient.lastName ?? ""}`.trim() || null
    : null;

  return {
    id: q.id,
    clinicId: q.clinicId,
    patientId: q.patientId,
    folio: q.folio,
    title: q.title,
    status: (q.status as QuoteStatus) ?? "DRAFT",
    validUntil: iso(q.validUntil),
    subtotal: num(q.subtotal),
    discountPct: numOrNull(q.discountPct),
    discountAmount: num(q.discountAmount),
    total: num(q.total),
    notes: q.notes ?? null,
    acceptToken: q.acceptToken ?? null,
    presentedAt: iso(q.presentedAt),
    acceptedAt: iso(q.acceptedAt),
    rejectedAt: iso(q.rejectedAt),
    signed: !!q.signatureUrl,
    invoiceId: q.invoiceId ?? null,
    treatmentPlanId: q.treatmentPlanId ?? null,
    createdAt: iso(q.createdAt) ?? "",
    updatedAt: iso(q.updatedAt) ?? "",
    createdByName,
    patientName,
    items,
  };
}

/**
 * Vista pública (solo lectura) para /presupuesto/[token]. `signatureUrl` ya
 * debe venir firmada (signed URL de corta vida) o null — la firma se genera en
 * la ruta, no aquí.
 */
export function toPublicView(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  opts: {
    clinicName: string;
    clinicLogoUrl: string | null;
    patientFirstName: string;
    signatureUrl: string | null;
    expired: boolean;
  },
): PublicQuoteView {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (q.items ?? [])
    .slice()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => num(a.sortOrder) - num(b.sortOrder))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => ({
      name: it.name,
      toothFdi: it.toothFdi ?? null,
      quantity: Math.floor(num(it.quantity)) || 1,
      unitPrice: num(it.unitPrice),
      discount: num(it.discount),
      lineTotal: num(it.lineTotal),
      phase: it.phase == null ? null : Math.floor(num(it.phase)),
      notes: it.notes ?? null,
    }));

  return {
    folio: q.folio,
    title: q.title,
    status: (q.status as QuoteStatus) ?? "DRAFT",
    validUntil: iso(q.validUntil),
    expired: opts.expired,
    subtotal: num(q.subtotal),
    discountAmount: num(q.discountAmount),
    total: num(q.total),
    notes: q.notes ?? null,
    acceptedAt: iso(q.acceptedAt),
    clinicName: opts.clinicName,
    clinicLogoUrl: opts.clinicLogoUrl,
    patientFirstName: opts.patientFirstName,
    signatureUrl: opts.signatureUrl,
    items,
  };
}
