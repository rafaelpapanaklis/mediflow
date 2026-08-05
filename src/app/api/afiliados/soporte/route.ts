import { NextRequest, NextResponse } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { createAffiliateTicket, listAffiliateTickets } from "@/lib/affiliate-support/service";
import { AffiliateSupportError } from "@/lib/affiliate-support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/afiliados/soporte — lado AFILIADO.
// El route SOLO resuelve la sesión, parsea el input y delega en
// src/lib/affiliate-support/service.ts (sanitiza, valida y aísla).
//   GET  → listAffiliateTickets(ctx.affiliateId)  → { tickets }
//   POST → createAffiliateTicket(ctx.affiliateId) → { ticket } (201)
//
// AISLAMIENTO: el affiliateId sale SIEMPRE de getAffiliateContext(), jamás del
// body ni de la query. Un afiliado no puede ni siquiera enumerar tickets de
// otro. Sesión ausente o cuenta no aprobada → 401.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function errorToResponse(err: unknown): NextResponse {
  if (err instanceof AffiliateSupportError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[afiliados/soporte] error:", err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getAffiliateContext();
    if (!ctx || ctx.status !== "APPROVED") {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const tickets = await listAffiliateTickets(ctx.affiliateId);
    return NextResponse.json({ tickets });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAffiliateContext();
    if (!ctx || ctx.status !== "APPROVED") {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const ticket = await createAffiliateTicket(ctx.affiliateId, {
      subject: body.subject,
      category: body.category,
      priority: body.priority,
      body: body.body,
      // Quién lo abrió sale de la sesión: AffiliateUser no guarda nombre, así
      // que el visible es el del afiliado.
      createdById: ctx.affiliateUserId,
      createdByName: ctx.affiliate?.name ?? null,
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
