import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { signMaybeUrl, BUCKETS } from "@/lib/storage";
import { QuoteDocument, type QuotePdfItem } from "@/lib/pdf/quote-document";

/**
 * buildQuotePdf — query + logo + firma + render del PDF de un presupuesto.
 *
 * Multi-tenant: si se pasa `clinicId`, el presupuesto DEBE pertenecer a esa
 * clínica (rutas del dashboard). Devuelve null si no existe / no pertenece.
 */

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  PRESENTED: "Presentado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  EXPIRED: "Vencido",
};

async function fetchImageDataUrl(url: string | null): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 2_000_000) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function buildQuotePdf(
  id: string,
  clinicId?: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const quote = await prisma.quote.findFirst({
    where: clinicId ? { id, clinicId } : { id },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      clinic: {
        select: {
          name: true, address: true, city: true, phone: true, email: true, logoUrl: true,
        },
      },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) return null;

  // Logo (URL pública) y firma estampada (path privado → signed URL → bytes).
  const signedSignatureUrl = quote.signatureUrl
    ? await signMaybeUrl(quote.signatureUrl, 120, BUCKETS.PATIENT_FILES).catch(() => "")
    : "";
  const [logoDataUrl, signatureDataUrl] = await Promise.all([
    fetchImageDataUrl(quote.clinic.logoUrl),
    signedSignatureUrl ? fetchImageDataUrl(signedSignatureUrl) : Promise.resolve(null),
  ]);

  const items: QuotePdfItem[] = quote.items.map((it) => ({
    name: it.name,
    toothFdi: it.toothFdi ?? null,
    quantity: Number(it.quantity) || 1,
    unitPrice: Number(it.unitPrice) || 0,
    discount: Number(it.discount) || 0,
    lineTotal: Number(it.lineTotal) || 0,
    phase: it.phase == null ? null : Number(it.phase),
    notes: it.notes ?? null,
  }));

  const element = createElement(QuoteDocument, {
    clinicName: quote.clinic.name,
    clinicAddress: quote.clinic.address ?? null,
    clinicCity: quote.clinic.city ?? null,
    clinicPhone: quote.clinic.phone ?? null,
    clinicEmail: quote.clinic.email ?? null,
    logoDataUrl,
    patientName: `${quote.patient.firstName} ${quote.patient.lastName}`,
    folio: quote.folio,
    title: quote.title,
    statusLabel: STATUS_LABEL[quote.status] ?? quote.status,
    issuedAt: quote.createdAt.toISOString(),
    validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
    items,
    subtotal: Number(quote.subtotal) || 0,
    discountAmount: Number(quote.discountAmount) || 0,
    total: Number(quote.total) || 0,
    notes: quote.notes ?? null,
    acceptedAt: quote.acceptedAt ? quote.acceptedAt.toISOString() : null,
    signatureDataUrl,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);
  const fileName = `presupuesto-${quote.folio}-${quote.id.slice(0, 8)}.pdf`;
  return { buffer, fileName };
}
