import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { replaceQuoteContent, parseValidUntil } from "@/lib/quotes/service";
import { serializeQuote } from "@/lib/quotes/serialize";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/** GET /api/quotes/[id] — un presupuesto de la clínica de la sesión. */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  return NextResponse.json(serializeQuote(quote));
}

/**
 * PATCH /api/quotes/[id] — edita un presupuesto. Solo en estado editable
 * (DRAFT o PRESENTED). Reemplaza ítems y recalcula totales en el servidor.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, status: true, total: true },
  });
  if (!existing) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  if (existing.status !== "DRAFT" && existing.status !== "PRESENTED") {
    return NextResponse.json(
      { error: "Solo se pueden editar presupuestos en borrador o presentados" },
      { status: 409 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? (body.items as never[]) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Agrega al menos un concepto" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 160)
    : "Presupuesto";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
  const validUntil = parseValidUntil(body.validUntil);

  const quote = await replaceQuoteContent({
    quoteId: existing.id,
    clinicId: ctx.clinicId,
    title,
    items,
    discountPct: body.discountPct == null ? null : Number(body.discountPct),
    discountAmount: body.discountAmount == null ? null : Number(body.discountAmount),
    validUntil,
    notes,
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "update",
    changes: { total: { before: Number(existing.total), after: Number(quote.total) } },
  });

  return NextResponse.json(serializeQuote(quote));
}

/** DELETE /api/quotes/[id] — borra un presupuesto (solo DRAFT). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, status: true, folio: true },
  });
  if (!existing) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Solo se pueden eliminar presupuestos en borrador" },
      { status: 409 },
    );
  }

  await prisma.quote.delete({ where: { id: existing.id } });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: existing.id,
    action: "delete",
    changes: { folio: { before: existing.folio, after: null } },
  });

  return NextResponse.json({ success: true });
}
