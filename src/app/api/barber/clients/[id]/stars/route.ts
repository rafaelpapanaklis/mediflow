import { NextResponse } from "next/server";
import { BarberForbiddenError } from "@/lib/barber-auth";
import {
  adjustClientStars,
  canHandleStars,
  deliverClientBonus,
  getClientCardLink,
  getStaffStarsView,
  revokeClientCard,
  starsErrorBody,
} from "@/lib/barber/stars";
import { gateBarberClients, readJson, serverError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * /api/barber/clients/[id]/stars — la tarjeta de estrellas desde la ficha.
 *
 * GET  → la tarjeta como la ve la barbería (con motivos y quién).
 * POST → { action: "adjust", delta: 1 | -1, reason }   dar / quitar una estrella
 *        { action: "deliver", bonusId, note? }          marcar bono como entregado
 *        { action: "link" }                             enlace personal de la tarjeta
 *        { action: "revoke" }                           revocar el enlace y sacar otro
 *
 * El cuerpo NUNCA trae un número de estrellas: se cuentan en el servidor.
 * Las acciones exigen cash.manage (quien cobra, Recepción incluida); el rol
 * Barbero solo alcanza a SUS clientes (el recorte va dentro de stars.ts).
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;
  try {
    const stars = await getStaffStarsView(gate.ctx, params.id);
    if (!stars) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json(
      { stars, canHandle: canHandleStars(gate.ctx) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return serverError("stars.get", e);
  }
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;
  try {
    const body = await readJson(req);
    switch (body.action) {
      case "adjust":
        return NextResponse.json({
          stars: await adjustClientStars(gate.ctx, { clientId: params.id, delta: body.delta, reason: body.reason }),
        });
      case "deliver":
        return NextResponse.json({
          stars: await deliverClientBonus(gate.ctx, { clientId: params.id, bonusId: body.bonusId, note: body.note }),
        });
      case "link":
        return NextResponse.json({ link: await getClientCardLink(gate.ctx, params.id) });
      case "revoke":
        return NextResponse.json({ link: await revokeClientCard(gate.ctx, params.id) });
      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof BarberForbiddenError) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    const known = starsErrorBody(e);
    if (known) return NextResponse.json(known.body, { status: known.status });
    return serverError("stars.post", e);
  }
}
