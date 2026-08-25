import { NextResponse, type NextRequest } from "next/server";
import { failbanGuard, persistentRateLimit, recordAuthFailure, recordAuthSuccess } from "@/lib/failban";
import {
  PORTAL_INVALID_CODE_MESSAGE,
  REALTY_PORTAL_COOKIE,
  normalizePortalPhone,
  packPortalSession,
  portalCookieOptions,
  portalCsrfBlocked,
  verifyPortalCode,
  type RealtyPortalIdentity,
} from "@/lib/realty/portal-auth";

/**
 * POST /api/realty/portal/auth/verify — canjear el código por una sesión.
 *
 * Un código correcto abre la sesión del portal (cookie httpOnly firmada) y
 * queda QUEMADO: no vuelve a servir. Todo lo que falla —código viejo,
 * caducado, ya usado, teléfono inexistente— devuelve exactamente el mismo
 * 401 con el mismo texto.
 *
 * DOS FRENOS, y en este orden:
 *   1. persistentRateLimit → ráfagas por IP (no cuenta como "fallo").
 *   2. failbanGuard        → fuerza bruta por IP Y por teléfono, con
 *      bloqueo creciente. Corta ANTES que el rate-limit en el camino de
 *      fallos, que es justo lo que queremos.
 * Más el tope de 5 intentos que vive en el propio token.
 *
 * 🔴 LAS DOS CARAS: si el teléfono es inquilino en una inmobiliaria y
 * propietario en otra, NO se elige por él. La cookie sale "a medias" y se
 * le manda a elegir. Con una sola cara entra directo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL = { limit: 15, windowSec: 600 };

function destino(identity: RealtyPortalIdentity): string {
  return identity.role === "INQUILINO" ? "/i/portal/inquilino" : "/i/portal/propietario";
}

export async function POST(req: NextRequest) {
  try {
    const csrf = portalCsrfBlocked(req);
    if (csrf) return csrf;

    const limited = await persistentRateLimit(req, { ...RL, scope: "realty-portal-verify" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const phone = normalizePortalPhone(body?.phone);
    const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";

    if (!phone || code.length !== 6) {
      return NextResponse.json({ error: PORTAL_INVALID_CODE_MESSAGE }, { status: 401 });
    }

    const target = { scope: "realty-portal-verify", account: phone };
    const locked = await failbanGuard(req, target);
    if (locked) return locked;

    const result = await verifyPortalCode(phone, code);
    if (!result.ok) {
      await recordAuthFailure(req, target);
      return NextResponse.json({ error: PORTAL_INVALID_CODE_MESSAGE }, { status: 401 });
    }
    await recordAuthSuccess(req, target);

    const unica = result.identities.length === 1 ? result.identities[0] : null;
    const packed = packPortalSession(
      phone,
      unica ? { role: unica.role, accountId: unica.accountId } : null,
    );
    if (!packed) {
      // Producción sin COOKIE_SECRET ni SUPABASE_SERVICE_ROLE_KEY: no se
      // puede firmar la cookie. FALLA CERRADO — jamás una sesión sin firma.
      console.error("[realty/portal/verify] sin secreto de cookie: no se puede abrir sesión");
      return NextResponse.json(
        { error: "No pudimos abrir tu sesión. Intenta más tarde." },
        { status: 503 },
      );
    }

    const res = NextResponse.json({
      ok: true,
      next: unica ? destino(unica) : "/i/portal/elegir",
    });
    res.cookies.set(REALTY_PORTAL_COOKIE, packed.value, portalCookieOptions(packed.expiresAt));
    return res;
  } catch (err) {
    console.error("[realty/portal/verify] error:", err);
    return NextResponse.json({ error: PORTAL_INVALID_CODE_MESSAGE }, { status: 401 });
  }
}
