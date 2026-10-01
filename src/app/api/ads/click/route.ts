import { NextRequest, NextResponse } from "next/server";
import {
  ADS_CLICK_COOKIE,
  ADS_CLICK_COOKIE_MAX_AGE,
  cookieParaClic,
  extraerClickIds,
} from "@/lib/ads/click-ids";
import {
  META_CLICK_COOKIE,
  META_CLICK_COOKIE_MAX_AGE,
  cookieParaMeta,
  extraerFbclid,
} from "@/lib/ads/meta-click";
import {
  UTM_COOKIE_MAX_AGE,
  UTM_PRIMERO_COOKIE,
  UTM_ULTIMO_COOKIE,
  cookiesParaUtm,
  extraerUtm,
} from "@/lib/ads/utm";

// Cada visita lee y escribe cookies: nada de caché compartida.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/ads/click — siembra la cookie `dc_ads` con el clic de Google Ads
 * (gclid / gbraid / wbraid) con el que llegó la persona. WS1-T6.
 *
 * WS1-T10 suma, en la MISMA llamada y sin cambiar lo de Google: `dc_meta` con el
 * fbclid de Meta, y `dc_utm1` / `dc_utm2` con los UTM del primer y del último
 * toque (ver @/lib/ads/meta-click y @/lib/ads/utm).
 *
 * La llama <AdsClickCapture/> desde las rutas públicas cuando la URL trae un id
 * de clic o UTM. Es Set-Cookie del SERVIDOR (httpOnly) porque Safari borra a los
 * 7 días las cookies escritas por JS. No toca la base ni lee nada del usuario:
 * valida la forma de lo que llega y escribe cookies en el navegador de quien las
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

    const crudo = cuerpo && typeof cuerpo === "object" ? (cuerpo as Record<string, unknown>) : null;
    const valorMeta = cookieParaMeta(extraerFbclid(crudo), req.cookies.get(META_CLICK_COOKIE)?.value);
    const valoresUtm = cookiesParaUtm(extraerUtm(crudo), {
      primero: req.cookies.get(UTM_PRIMERO_COOKIE)?.value,
      ultimo: req.cookies.get(UTM_ULTIMO_COOKIE)?.value,
    });

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
    // WS1-T10: Meta y UTM, mismos atributos que dc_ads.
    const sembrar = (name: string, value: string | null, maxAge: number) => {
      if (!value) return;
      res.cookies.set({ name, value, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
    };
    sembrar(META_CLICK_COOKIE, valorMeta, META_CLICK_COOKIE_MAX_AGE);
    sembrar(UTM_PRIMERO_COOKIE, valoresUtm.primero, UTM_COOKIE_MAX_AGE);
    sembrar(UTM_ULTIMO_COOKIE, valoresUtm.ultimo, UTM_COOKIE_MAX_AGE);
    return res;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
