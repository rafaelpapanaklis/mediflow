import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { configOAuth, guardarConexion, urlBaseApp } from "@/lib/anticipos/cuenta.server";
import { canjearCodigo, leerCuenta } from "@/lib/anticipos/mp-oauth";
import {
  COOKIE_OAUTH_MP,
  COOKIE_OAUTH_MP_PATH,
  desempacarIda,
  mismoState,
} from "@/lib/anticipos/oauth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mercadopago/oauth/callback — WS1-T5.
 *
 * Esta URL exacta es la «Redirect URL» que se registra en la aplicación de
 * DaleControl en Mercado Pago. Mercado Pago vuelve aquí con `code` y `state`.
 *
 * Solo conecta si: el `state` coincide con el de la cookie, la sesión es de la
 * MISMA clínica y la MISMA persona que salió, y esa persona sigue teniendo
 * settings.edit. El token se guarda cifrado y no sale de aquí.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = urlBaseApp() ?? url.origin;
  const volver = (q: string) => {
    const res = NextResponse.redirect(`${base}/dashboard/settings/anticipos?${q}`);
    res.cookies.set(COOKIE_OAUTH_MP, "", { path: COOKIE_OAUTH_MP_PATH, maxAge: 0 });
    return res;
  };

  const ida = desempacarIda(req.cookies.get(COOKIE_OAUTH_MP)?.value);
  if (!ida || !mismoState(ida.state, url.searchParams.get("state"))) {
    return volver("mp=error&motivo=estado");
  }
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return volver("mp=cancelado");

  const ctx = await getAuthContext();
  if (!ctx || ctx.clinicId !== ida.clinicId || ctx.userId !== ida.userId) {
    return volver("mp=error&motivo=sesion");
  }
  if (denyIfMissingPermission(ctx, "settings.edit")) return volver("mp=error&motivo=permiso");

  const cfg = configOAuth();
  if (!cfg) return volver("mp=error&motivo=plataforma");

  let tokens;
  try {
    tokens = await canjearCodigo(cfg, code, ida.verifier, {
      tokenDePrueba: process.env.MERCADOPAGO_OAUTH_TEST_TOKEN === "1",
    });
  } catch (e) {
    console.error(`[mp-oauth] canje fallido (clínica ${ctx.clinicId}): ${(e as Error).message}`);
    return volver("mp=error&motivo=canje");
  }

  const cuenta = await leerCuenta(tokens.accessToken).catch(() => null);
  try {
    await guardarConexion({ clinicId: ctx.clinicId, userId: ctx.userId, tokens, cuenta });
  } catch (e) {
    console.error(`[mp-oauth] no se guardó la conexión (clínica ${ctx.clinicId}): ${(e as Error).message}`);
    return volver("mp=error&motivo=guardar");
  }

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "clinic",
    entityId: ctx.clinicId,
    action: "update",
    changes: {
      mercadoPago: {
        before: null,
        after: `conectada (${cuenta?.nickname ?? `cuenta ••••${tokens.userId.slice(-4)}`})`,
      },
    },
    ...extractAuditMeta(req),
  });

  return volver("mp=conectada");
}
