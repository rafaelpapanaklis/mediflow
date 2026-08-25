import { NextResponse, type NextRequest } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { MX_PHONE_ERROR } from "@/lib/phone-mx";
import {
  PORTAL_CODE_SENT_MESSAGE,
  normalizePortalPhone,
  portalCsrfBlocked,
  requestPortalCode,
} from "@/lib/realty/portal-auth";

/**
 * POST /api/realty/portal/auth/code — pedir el código de acceso.
 *
 * 🔴 ENUMERACIÓN DE TELÉFONOS: la respuesta es IDÉNTICA exista o no la
 * persona — mismo status, mismo texto — y requestPortalCode() hace el
 * mismo trabajo de CPU en los dos caminos para que tampoco el tiempo lo
 * delate. Este endpoint NO tiene forma de contestar "ese número no está
 * registrado", ni siquiera por accidente: requestPortalCode es `void`.
 *
 * Un teléfono MAL ESCRITO sí se avisa (400). Eso no revela si alguien está
 * dado de alta, y sin el aviso la persona se queda mirando una pantalla
 * que dice "ya te mandamos el código" para un número que no existe.
 *
 * El mensaje lo manda T6 (categoría AUTHENTICATION). Fuera de producción
 * el código queda en el log del servidor para poder probar el flujo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Por IP. El tope por teléfono (reenvíos) vive en requestPortalCode. */
const RL = { limit: 10, windowSec: 600 };

export async function POST(req: NextRequest) {
  try {
    const csrf = portalCsrfBlocked(req);
    if (csrf) return csrf;

    const limited = await persistentRateLimit(req, { ...RL, scope: "realty-portal-code" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const phone = normalizePortalPhone(body?.phone);
    if (!phone) return NextResponse.json({ error: MX_PHONE_ERROR }, { status: 400 });

    await requestPortalCode(phone);

    return NextResponse.json({ ok: true, message: PORTAL_CODE_SENT_MESSAGE });
  } catch (err) {
    console.error("[realty/portal/code] error:", err);
    // Ni siquiera el 500 puede depender de si la persona existe.
    return NextResponse.json(
      { error: "No pudimos enviar el código. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
