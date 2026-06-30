import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createInvoiceFromQuote, InvoiceFolioError } from "@/lib/quotes/create-invoice-from-quote";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * POST /api/quotes/[id]/invoice — genera una factura BORRADOR a partir de un
 * presupuesto ACEPTADO. Idempotente: si ya se generó (y sigue existiendo),
 * devuelve la misma factura sin duplicar. La lógica de creación vive en
 * createInvoiceFromQuote (compartida con la facturación automática al crear).
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

  try {
    const { invoice, already } = await createInvoiceFromQuote(quote, ctx);
    return NextResponse.json(
      { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, already },
      { status: already ? 200 : 201 },
    );
  } catch (e) {
    if (e instanceof InvoiceFolioError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    throw e;
  }
}
