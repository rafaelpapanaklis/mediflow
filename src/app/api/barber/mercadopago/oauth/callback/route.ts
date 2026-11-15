import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { canjearCodigo, leerCuenta } from "@/lib/anticipos/mp-oauth";
import { mismoState } from "@/lib/anticipos/oauth-cookie";
import { configOAuthBarber, guardarConexion, urlBaseApp } from "@/lib/barber/mercadopago";
import {
  BARBER_MP_COOKIE,
  BARBER_MP_COOKIE_PATH,
  BARBER_MP_SETTINGS_PATH,
  desempacarIdaBarber,
  matrizDelDueno,
} from "@/lib/barber/mercadopago-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/barber/mercadopago/oauth/callback — ws6-t5.
 *
 * ⚠️ Esta URL exacta (con el dominio de NEXT_PUBLIC_APP_URL delante) es la
 * «Redirect URL» de BARBER que se registra en la aplicación de DaleControl en
 * Mercado Pago, junto a la del dental (/api/mercadopago/oauth/callback).
 *
 * Solo conecta si: el `state` coincide con el de la cookie, la sesión es la
 * MISMA persona que salió, sigue siendo DUEÑA de la MISMA cadena. El token
 * se guarda cifrado y no sale de aquí.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = urlBaseApp() ?? url.origin;
  const volver = (q: string) => {
    const res = NextResponse.redirect(`${base}${BARBER_MP_SETTINGS_PATH}?${q}#pagos-en-linea`);
    res.cookies.set(BARBER_MP_COOKIE, "", { path: BARBER_MP_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const ida = desempacarIdaBarber(req.cookies.get(BARBER_MP_COOKIE)?.value);
  if (!ida || !mismoState(ida.state, url.searchParams.get("state"))) {
    return volver("mp=error&motivo=estado");
  }
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return volver("mp=cancelado");

  const ctx = await getBarberContext();
  if (!ctx || ctx.barberUserId !== ida.barberUserId) return volver("mp=error&motivo=sesion");
  const rootId = matrizDelDueno(ctx);
  if (!rootId) return volver("mp=error&motivo=permiso");
  if (rootId !== ida.barbershopId) return volver("mp=error&motivo=sesion");

  const cfg = configOAuthBarber();
  if (!cfg) return volver("mp=error&motivo=plataforma");

  let tokens;
  try {
    tokens = await canjearCodigo(cfg, code, ida.verifier, {
      tokenDePrueba: process.env.MERCADOPAGO_OAUTH_TEST_TOKEN === "1",
    });
  } catch (e) {
    console.error(`[barber-mp-oauth] canje fallido (barbería ${rootId}): ${(e as Error).message}`);
    return volver("mp=error&motivo=canje");
  }

  const cuenta = await leerCuenta(tokens.accessToken).catch(() => null);
  try {
    await guardarConexion({ rootId, barberUserId: ctx.barberUserId, tokens, cuenta });
  } catch (e) {
    console.error(`[barber-mp-oauth] no se guardó la conexión (barbería ${rootId}): ${(e as Error).message}`);
    return volver("mp=error&motivo=guardar");
  }
  return volver("mp=conectada");
}
