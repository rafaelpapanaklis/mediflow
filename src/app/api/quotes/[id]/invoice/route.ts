import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * POST /api/quotes/[id]/invoice — genera una factura BORRADOR a partir de un
 * presupuesto ACEPTADO. Idempotente: si ya se generó (y sigue existiendo),
 * devuelve la misma factura sin duplicar.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
  if (quote.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: "Solo se factura un presupuesto aceptado" },
      { status: 409 },
    );
  }

  // Idempotencia: si ya hay factura viva, regrésala.
  if (quote.invoiceId) {
    const existing = await prisma.invoice.findFirst({
      where: { id: quote.invoiceId, clinicId: ctx.clinicId },
      select: { id: true, invoiceNumber: true },
    });
    if (existing) {
      return NextResponse.json({ invoiceId: existing.id, invoiceNumber: existing.invoiceNumber, already: true });
    }
  }

  const items = quote.items.map((it) => ({
    description: it.toothFdi ? `${it.name} (${it.toothFdi})` : it.name,
    quantity: Number(it.quantity) || 1,
    unitPrice: Number(it.unitPrice) || 0,
    total: Number(it.lineTotal) || 0,
  }));
  const subtotal = Number(quote.subtotal) || 0;
  const discount = Number(quote.discountAmount) || 0;
  const total = Number(quote.total) || 0;

  let created: { id: string; invoiceNumber: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await prisma.invoice.count({ where: { clinicId: ctx.clinicId } });
    const invoiceNumber = `MF-${String(count + 1 + attempt).padStart(4, "0")}`;
    try {
      const inv = await prisma.invoice.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: quote.patientId,
          invoiceNumber,
          items: items as unknown as Prisma.InputJsonValue,
          subtotal,
          discount,
          total,
          paid: 0,
          balance: total,
          status: "DRAFT",
          notes: `Generada desde presupuesto ${quote.folio}`,
        },
        select: { id: true, invoiceNumber: true },
      });
      created = inv;
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  if (!created) {
    return NextResponse.json({ error: "No se pudo asignar folio de factura" }, { status: 500 });
  }

  await prisma.quote.update({ where: { id: quote.id }, data: { invoiceId: created.id } });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: created.id,
    action: "create",
    changes: { fromQuote: { before: null, after: quote.folio } },
  });

  return NextResponse.json({ invoiceId: created.id, invoiceNumber: created.invoiceNumber }, { status: 201 });
}
