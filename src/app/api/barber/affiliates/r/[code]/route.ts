import { NextResponse, type NextRequest } from "next/server";
import {
  BARBER_AFF_COOKIE,
  BARBER_AFF_COOKIE_MAX_AGE,
  BARBER_AFF_VISITOR_COOKIE,
  BARBER_AFF_VISITOR_MAX_AGE,
  newBarberVisitorId,
  packBarberAttribution,
  parseBarberAttribution,
  parseBarberVisitorId,
  recordBarberAffiliateClick,
  resolveBarberAffiliateCode,
} from "@/lib/barber/affiliates";

/**
 * GET /api/barber/affiliates/r/<CODE> — la liga del socio.
 *
 * RUTA NUEVA Y PROPIA DEL VERTICAL. La /r/<code> del dental NO se toca ni se
 * comparte: allá el código resuelve un Affiliate (persona externa) y siembra
 * dc_aff; aquí resuelve una BARBERÍA y siembra dcb_aff. Dos programas, dos
 * cookies, cero cruce en el mismo navegador.
 *
 * Qué hace: siembra la cookie de atribución de PRIMER TOQUE (90 días),
 * cuenta el clic y manda al visitante al registro de barberías limpio, sin
 * ?ref= colgando: el visitante ya no tiene que conservar el querystring
 * hasta darse de alta, la cookie lo hace por él.
 *
 * NUNCA devuelve 404 ni error. Un link roto, caducado o de un socio
 * desactivado —pegado en un grupo de WhatsApp o impreso en un QR— tiene que
 * llevar al registro, no a un muro. Sin atribución, pero al registro.
 *
 * Los bots tampoco se bloquean: reciben su redirección y su cookie igual que
 * cualquiera, solo que no suman clic (looksLikeBarberBot).
 */

// Cada visita lee y escribe cookies. Si Next cacheara esta ruta, dos
// visitantes distintos compartirían el mismo Set-Cookie y la atribución se
// cruzaría entre socios.
export const dynamic = "force-dynamic";
// hashBarberIp usa node:crypto (createHash), que no existe en Edge.
export const runtime = "nodejs";

/** Registro de barberías. 302 (NextResponse.redirect es 307 por default). */
function redirectToSignup(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/barber/registro", req.url), 302);
}

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const res = redirectToSignup(req);

  try {
    // a) Cookie de visitante: identifica al NAVEGADOR para deduplicar clics.
    //    Quien ya la trae conserva la suya — si se regenerara en cada visita,
    //    cada recarga sería un navegador nuevo y sobrecontaríamos.
    let vid = parseBarberVisitorId(req.cookies.get(BARBER_AFF_VISITOR_COOKIE)?.value);
    if (!vid) {
      vid = newBarberVisitorId();
      res.cookies.set({
        name: BARBER_AFF_VISITOR_COOKIE,
        value: vid,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: BARBER_AFF_VISITOR_MAX_AGE,
      });
    }

    const target = await resolveBarberAffiliateCode(params?.code ?? "");
    if (!target || !target.isActive) return res;

    // b) PRIMER TOQUE: si ya hay una cookie vigente NO se sobrescribe ni se
    //    renueva, ni por otro socio. El primero se queda la atribución sus
    //    90 días; al expirar deja de atribuir a nadie.
    const current = parseBarberAttribution(req.cookies.get(BARBER_AFF_COOKIE)?.value);
    if (!current) {
      const packed = packBarberAttribution({ code: target.code, firstTouchAt: Date.now() });
      if (packed) {
        res.cookies.set({
          name: BARBER_AFF_COOKIE,
          value: packed,
          // httpOnly + Set-Cookie desde el servidor a propósito: Safari (ITP)
          // borra a los 7 días lo que escribe document.cookie, y casi todo el
          // tráfico de estas ligas es móvil.
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: BARBER_AFF_COOKIE_MAX_AGE,
        });
      }
    }

    // c) Métrica. Va al final y no puede alterar la redirección.
    await recordBarberAffiliateClick({
      target,
      vid,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[barber afiliados] liga", err);
  }

  return res;
}
