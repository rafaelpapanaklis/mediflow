import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { configOAuth, plataformaAnticipos, urlBaseApp } from "@/lib/anticipos/cuenta.server";
import { aleatorioUrl, urlDeAutorizacion } from "@/lib/anticipos/mp-oauth";
import {
  COOKIE_OAUTH_MP,
  COOKIE_OAUTH_MP_MAX_AGE_S,
  COOKIE_OAUTH_MP_PATH,
  empacarIda,
} from "@/lib/anticipos/oauth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mercadopago/oauth/conectar — WS1-T5.
 *
 * Manda al administrador de la clínica a Mercado Pago para que autorice a
 * DaleControl a cobrar en SU cuenta. Es la única forma de que exista
 * `marketplace_fee` (ver src/lib/anticipos/mp-oauth.ts). Nada se guarda hasta
 * que vuelve por el callback.
 */
export async function GET(req: NextRequest) {
  const base = urlBaseApp() ?? new URL(req.url).origin;
  const pantalla = `${base}/dashboard/settings/anticipos`;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.redirect(`${base}/login`);
  const denied = denyIfMissingPermission(ctx, "settings.edit");
  if (denied) return NextResponse.redirect(`${pantalla}?mp=error&motivo=permiso`);

  const cfg = configOAuth();
  if (!cfg || !plataformaAnticipos().lista) {
    return NextResponse.redirect(`${pantalla}?mp=error&motivo=plataforma`);
  }

  const state = aleatorioUrl(32);
  const verifier = aleatorioUrl(48);
  const res = NextResponse.redirect(urlDeAutorizacion(cfg, state, verifier));
  res.cookies.set(COOKIE_OAUTH_MP, empacarIda({ state, verifier, clinicId: ctx.clinicId, userId: ctx.userId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_OAUTH_MP_PATH,
    maxAge: COOKIE_OAUTH_MP_MAX_AGE_S,
  });
  return res;
}
