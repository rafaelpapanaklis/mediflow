import { NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { aleatorioUrl, urlDeAutorizacion } from "@/lib/anticipos/mp-oauth";
import { configOAuthBarber, plataformaMpBarber, urlBaseApp } from "@/lib/barber/mercadopago";
import {
  BARBER_MP_COOKIE,
  BARBER_MP_COOKIE_MAX_AGE_S,
  BARBER_MP_COOKIE_PATH,
  BARBER_MP_SETTINGS_PATH,
  empacarIdaBarber,
  matrizDelDueno,
} from "@/lib/barber/mercadopago-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/barber/mercadopago/oauth/conectar — ws6-t5.
 *
 * Manda al DUEÑO de la barbería a Mercado Pago para que autorice a
 * DaleControl a cobrar en SU cuenta (misma aplicación que el dental, con la
 * redirect URI de barber). Nada se guarda hasta que vuelve por el callback.
 * Es un enlace (navegación), no un fetch: cada error vuelve a Configuración
 * con `?mp=error&motivo=…` y la tarjeta lo explica.
 */
export async function GET(req: NextRequest) {
  const base = urlBaseApp() ?? new URL(req.url).origin;
  const pantalla = `${base}${BARBER_MP_SETTINGS_PATH}`;

  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.redirect(`${base}/barber/entrar`);
  // «Ver como barbería» (ws6-t1): esto no es soporte, es de la cuenta del dueño.
  if (ctx.verComo) return NextResponse.redirect(`${pantalla}?mp=error&motivo=ver_como#pagos-en-linea`);
  // (respuestaSiVerComo responde JSON; esta ruta es una navegación y vuelve a la pantalla.)
  const rootId = matrizDelDueno(ctx);
  if (!rootId) return NextResponse.redirect(`${pantalla}?mp=error&motivo=permiso#pagos-en-linea`);

  const cfg = configOAuthBarber();
  if (!cfg || !plataformaMpBarber().lista) {
    return NextResponse.redirect(`${pantalla}?mp=error&motivo=plataforma#pagos-en-linea`);
  }

  const state = aleatorioUrl(32);
  const verifier = aleatorioUrl(48);
  const res = NextResponse.redirect(urlDeAutorizacion(cfg, state, verifier));
  res.cookies.set(
    BARBER_MP_COOKIE,
    empacarIdaBarber({ state, verifier, barbershopId: rootId, barberUserId: ctx.barberUserId }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: BARBER_MP_COOKIE_PATH,
      maxAge: BARBER_MP_COOKIE_MAX_AGE_S,
    },
  );
  return res;
}
