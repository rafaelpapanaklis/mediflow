import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAuthContext } from "@/lib/auth-context";
import { buildAuthUrl, signOAuthState } from "@/lib/marketing/meta-oauth";

export const dynamic = "force-dynamic";

const NONCE_COOKIE = "mkt_oauth_nonce";

/**
 * Inicia el OAuth de Meta. Es una navegación de nivel superior (no fetch), así
 * que en error redirigimos a la página de Conexiones en vez de devolver JSON.
 * Genera un nonce anti-CSRF: va firmado dentro del state y también en una cookie
 * httpOnly; el callback exige que ambos coincidan.
 */
export async function GET(req: NextRequest) {
  // Base del redirect: env pública si existe, si no el origin de la request
  // (evita un redirect relativo que NextResponse.redirect rechazaría).
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const connectionsUrl = (suffix: string) => `${base}/dashboard/marketing/connections${suffix}`;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.redirect(connectionsUrl("?error=auth"));
  if (!ctx.isAdmin) return NextResponse.redirect(connectionsUrl("?error=forbidden"));

  if (
    !process.env.META_APP_ID ||
    !process.env.META_APP_SECRET ||
    !process.env.META_OAUTH_REDIRECT
  ) {
    return NextResponse.redirect(connectionsUrl("?error=config"));
  }

  const nonce = randomBytes(16).toString("hex");
  const state = signOAuthState({ clinicId: ctx.clinicId, userId: ctx.userId, nonce });

  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // se envía en la navegación de retorno desde Meta
    path: "/",
    maxAge: 600, // 10 minutos
  });
  return res;
}
