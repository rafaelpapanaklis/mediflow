import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { serializeQuote } from "@/lib/quotes/serialize";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

type Action = "present" | "accept" | "reject";

/**
 * POST /api/quotes/[id]/status  Body: { action: "present" | "accept" | "reject" }
 *
 * - present: DRAFT/EXPIRED → PRESENTED. Genera acceptToken (liga pública) y
 *   asegura una vigencia futura (default +30 días si faltaba o ya venció).
 * - accept:  marca ACCEPTED manualmente desde el panel (sin firma del paciente).
 * - reject:  marca REJECTED.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const action = body.action as Action;
  if (action !== "present" && action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, status: true, acceptToken: true, validUntil: true },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  const now = new Date();

  if (action === "present") {
    if (quote.status === "ACCEPTED" || quote.status === "REJECTED") {
      return NextResponse.json(
        { error: "El presupuesto ya está cerrado" },
        { status: 409 },
      );
    }
    data.status = "PRESENTED";
    data.presentedAt = now;
    if (!quote.acceptToken) data.acceptToken = randomBytes(20).toString("hex");
    const vu = quote.validUntil ? new Date(quote.validUntil) : null;
    if (!vu || vu.getTime() <= now.getTime()) {
      data.validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  } else if (action === "accept") {
    if (quote.status === "ACCEPTED") {
      return NextResponse.json({ error: "El presupuesto ya fue aceptado" }, { status: 409 });
    }
    if (quote.status === "REJECTED") {
      return NextResponse.json({ error: "El presupuesto fue rechazado" }, { status: 409 });
    }
    data.status = "ACCEPTED";
    data.acceptedAt = now;
  } else {
    // reject
    if (quote.status === "ACCEPTED") {
      return NextResponse.json({ error: "El presupuesto ya fue aceptado" }, { status: 409 });
    }
    data.status = "REJECTED";
    data.rejectedAt = now;
  }

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data,
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "update",
    changes: { status: { before: quote.status, after: updated.status } },
  });

  return NextResponse.json(serializeQuote(updated));
}
