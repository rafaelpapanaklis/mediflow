import { NextRequest, NextResponse } from "next/server";
import {
  ADS_CLICK_COOKIE,
  ADS_CLICK_COOKIE_MAX_AGE,
  cookieParaClic,
  extraerClickIds,
} from "@/lib/ads/click-ids";

// Cada visita lee y escribe cookies: nada de caché compartida.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/ads/click — siembra la cookie `dc_ads` con el clic de Google Ads
 * (gclid / gbraid / wbraid) con el que llegó la persona. WS1-T6.
 *
 * La llama <AdsClickCapture/> desde las rutas públicas cuando la URL trae un id
 * de clic. Es Set-Cookie del SERVIDOR (httpOnly) porque Safari borra a los 7
 * días las cookies escritas por JS. No toca la base ni lee nada del usuario:
 * valida la forma de los ids y escribe una cookie en el navegador de quien la
 * pide, así que no necesita sesión. Siempre 204: medir nunca da error a nadie.
 */
export async function POST(req: NextRequest) {
  try {
    const texto = await req.text();
    if (texto.length > 2048) return new NextResponse(null, { status: 204 });
    let cuerpo: unknown = null;
    try { cuerpo = JSON.parse(texto); } catch { /* cuerpo inválido → sin cookie */ }

    const ids = extraerClickIds(cuerpo && typeof cuerpo === "object" ? (cuerpo as Record<string, unknown>) : null);
    const valor = cookieParaClic(ids, req.cookies.get(ADS_CLICK_COOKIE)?.value);

    const res = new NextResponse(null, { status: 204 });
    if (valor) {
      res.cookies.set({
        name: ADS_CLICK_COOKIE,
        value: valor,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ADS_CLICK_COOKIE_MAX_AGE,
      });
    }
    return res;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
