import { NextRequest, NextResponse } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import {
  addAffiliateSupportMessage,
  getTicketForAffiliate,
} from "@/lib/affiliate-support/service";
import { AffiliateSupportError } from "@/lib/affiliate-support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/afiliados/soporte/[id]/messages — lado AFILIADO.
//   POST → { body } → addAffiliateSupportMessage(...) → { message } (201)
//
// AISLAMIENTO (lo más importante de este handler):
//  1. La propiedad del ticket se comprueba ANTES de escribir, con
//     getTicketForAffiliate(ctx.affiliateId, id) — where compuesto
//     { id, affiliateId }. Si no es suyo: 404, nunca 403.
//  2. authorType se FUERZA a "affiliate" y `internalNote` se ignora aunque
//     venga en el body: un afiliado no puede hacerse pasar por soporte ni
//     crear notas internas.
//  3. El nombre del autor sale de la sesión, no del request.
// El ticket cerrado lo rechaza el service con 409.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function errorToResponse(err: unknown): NextResponse {
  if (err instanceof AffiliateSupportError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[afiliados/soporte/[id]/messages] error:", err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAffiliateContext();
    if (!ctx || ctx.status !== "APPROVED") {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    // Candado de propiedad: addAffiliateSupportMessage no recibe affiliateId
    // (el admin también la usa), así que el dueño se verifica aquí. Un ticket
    // ajeno devuelve null → 404 y jamás llega a escribirse nada.
    const owned = await getTicketForAffiliate(ctx.affiliateId, params.id);
    if (!owned) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

    const message = await addAffiliateSupportMessage(params.id, {
      body: body.body,
      authorType: "affiliate", // forzado: nunca se lee del request
      authorId: ctx.affiliateUserId,
      authorName: ctx.affiliate?.name ?? null,
      // internalNote se omite a propósito: el afiliado no puede crear notas.
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
