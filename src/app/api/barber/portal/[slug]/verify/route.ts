import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { normalizeBarberPhone } from "@/lib/barber/booking";
import {
  BARBER_PORTAL_COOKIE,
  packPortalSession,
  portalCookieOptions,
  resolvePortalShop,
  verifyPortalCode,
} from "@/lib/barber/client-portal";

/**
 * POST /api/barber/portal/[slug]/verify — canjear el código por una sesión.
 *
 * Un código correcto abre la sesión del portal (cookie httpOnly firmada) y
 * queda QUEMADO: no vuelve a servir. Todo lo que falla — código viejo,
 * caducado, ya usado, de otra barbería, teléfono inexistente — devuelve
 * exactamente el mismo 401 con el mismo texto.
 */

export const dynamic = "force-dynamic";

/** Freno de fuerza bruta por IP; el tope por código vive en el token. */
const RL = { limit: 15, windowSec: 600 };

const INVALID = "Ese código no es válido o ya venció. Pide uno nuevo.";

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const limited = await persistentRateLimit(req, { ...RL, scope: "barber-portal-verify" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const phone = normalizeBarberPhone(body?.phone);
    const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";

    const shop = await resolvePortalShop(params.slug);
    if (!shop) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });
    if (!phone || code.length !== 6) {
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }

    const result = await verifyPortalCode({ barbershopId: shop.id, phone, code });
    if (!result.ok) return NextResponse.json({ error: INVALID }, { status: 401 });

    const { value, expiresAt } = packPortalSession(result.clientId, shop.id);
    const res = NextResponse.json({ ok: true, name: result.name });
    res.cookies.set(BARBER_PORTAL_COOKIE, value, portalCookieOptions(expiresAt));
    return res;
  } catch (err) {
    console.error("[barber/portal/verify] error:", err);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }
}
