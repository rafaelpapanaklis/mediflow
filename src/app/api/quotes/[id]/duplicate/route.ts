import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logAudit } from "@/lib/audit";
import { createQuoteWithFolio } from "@/lib/quotes/service";
import { serializeQuote } from "@/lib/quotes/serialize";
import type { QuoteItemInput } from "@/lib/quotes/types";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/** POST /api/quotes/[id]/duplicate — clona el presupuesto como nuevo DRAFT. */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const src = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!src) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad: la respuesta (serializeQuote) echa el nombre del paciente. Un
  // usuario excluido duplicaría el presupuesto y recibiría el nombre del paciente
  // restringido en el eco.
  if (src.patientId) {
    const denied = await assertPatientVisible(src.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  const items: QuoteItemInput[] = src.items.map((it) => ({
    procedureId: it.procedureId ?? null,
    name: it.name,
    toothFdi: it.toothFdi ?? null,
    quantity: Number(it.quantity) || 1,
    unitPrice: Number(it.unitPrice) || 0,
    discount: Number(it.discount) || 0,
    phase: it.phase == null ? null : Number(it.phase),
    notes: it.notes ?? null,
  }));

  const title = `${src.title} (copia)`.slice(0, 160);
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const quote = await createQuoteWithFolio({
    clinicId: ctx.clinicId,
    patientId: src.patientId,
    createdById: ctx.userId,
    title,
    items,
    discountPct: src.discountPct == null ? null : Number(src.discountPct),
    discountAmount: src.discountPct == null ? Number(src.discountAmount) || 0 : null,
    validUntil,
    notes: src.notes ?? null,
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "create",
    changes: { duplicatedFrom: { before: null, after: src.folio } },
  });

  return NextResponse.json(serializeQuote(quote), { status: 201 });
}
