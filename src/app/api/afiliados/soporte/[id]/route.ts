import { NextRequest, NextResponse } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import {
  getTicketForAffiliate,
  markTicketReadByAffiliate,
} from "@/lib/affiliate-support/service";
import { AffiliateSupportError } from "@/lib/affiliate-support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/afiliados/soporte/[id] — lado AFILIADO.
//   GET   → getTicketForAffiliate(ctx.affiliateId, id) → { ticket, messages }
//   PATCH → { action: "read" } → markTicketReadByAffiliate(...) → { ok: true }
//
// AISLAMIENTO: el id de la URL NUNCA basta. Las dos funciones del service
// filtran con un where compuesto { id, affiliateId } contra el affiliateId de
// la SESIÓN, así que cambiar el id en la barra de direcciones no sirve de
// nada. Si el ticket no es suyo se responde 404 —nunca 403: un 403 confirmaría
// que ese ticket existe—.
// Las notas internas de soporte se descartan en el `where` de Prisma dentro
// del service: no viajan a este handler siquiera.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function errorToResponse(err: unknown): NextResponse {
  if (err instanceof AffiliateSupportError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[afiliados/soporte/[id]] error:", err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAffiliateContext();
    if (!ctx || ctx.status !== "APPROVED") {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const detail = await getTicketForAffiliate(ctx.affiliateId, params.id);
    if (!detail) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

    return NextResponse.json(detail); // { ticket, messages }
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAffiliateContext();
    if (!ctx || ctx.status !== "APPROVED") {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Body opcional: hoy la única acción es "read" (apagar el badge de
    // respuesta nueva). Cualquier otra acción se rechaza explícitamente para
    // que agregar una nueva sea una decisión consciente.
    const body = await req.json().catch(() => null);
    const action = body && typeof body.action === "string" ? body.action : "read";
    if (action !== "read") {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }

    // updateMany con where { id, affiliateId }: si el ticket es de otro
    // afiliado no toca nada y la respuesta es idéntica — cero filtración.
    await markTicketReadByAffiliate(ctx.affiliateId, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
