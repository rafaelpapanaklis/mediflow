import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/marketing/crypto";
import {
  OAUTH_SCOPES,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchPageInstagram,
  fetchUserPages,
  verifyOAuthState,
} from "@/lib/marketing/meta-oauth";

export const dynamic = "force-dynamic";

const NONCE_COOKIE = "mkt_oauth_nonce";
const MAX_PAGES = 10;

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const connectionsUrl = (suffix: string) => `${base}/dashboard/marketing/connections${suffix}`;
  // Redirige a Conexiones con un código de error y limpia la cookie de nonce.
  const fail = (reason: string) => {
    const res = NextResponse.redirect(connectionsUrl(`?error=${reason}`));
    res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError || !code || !state) return fail("oauth");

  const ctx = await getAuthContext();
  if (!ctx) return fail("auth");
  if (!ctx.isAdmin) return fail("forbidden");

  // 1) Firma del state válida (no falsificable sin META_APP_SECRET).
  const payload = verifyOAuthState(state);
  if (!payload) return fail("state");

  // 2) Anti-CSRF: el nonce del state debe coincidir con la cookie httpOnly que
  //    pusimos al iniciar (double-submit). Bloquea callbacks inyectados.
  const cookieNonce = req.cookies.get(NONCE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== payload.nonce) return fail("csrf");

  // 3) El token se guarda en la clínica de la SESIÓN viva y exigimos que
  //    coincida con la del state firmado (defensa en profundidad multi-tenant).
  if (payload.clinicId !== ctx.clinicId) return fail("clinic");

  try {
    const shortToken = await exchangeCodeForToken(code);
    const longToken = await exchangeForLongLivedToken(shortToken);
    const pages = await fetchUserPages(longToken);
    if (pages.length === 0) return fail("nopages");

    const clinicId = ctx.clinicId;
    const limited = pages.slice(0, MAX_PAGES);

    // Secuencial: pocas páginas por clínica y evita saturar PgBouncer/Graph.
    for (let i = 0; i < limited.length; i++) {
      const page = limited[i];
      let ig: { id: string; username: string | null } | null = null;
      try {
        ig = await fetchPageInstagram(page.id, page.access_token);
      } catch {
        ig = null; // IG es opcional; una Página sin IG sirve igual para Facebook.
      }
      const pageTokenEnc = encryptToken(page.access_token);

      await prisma.socialAccount.upsert({
        where: {
          clinicId_provider_externalId: { clinicId, provider: "FACEBOOK", externalId: page.id },
        },
        create: {
          clinicId,
          provider: "FACEBOOK",
          externalId: page.id,
          name: page.name,
          accessTokenEnc: pageTokenEnc,
          igBusinessId: ig?.id ?? null,
          scope: OAUTH_SCOPES,
          connected: true,
        },
        update: {
          name: page.name,
          accessTokenEnc: pageTokenEnc,
          igBusinessId: ig?.id ?? null,
          scope: OAUTH_SCOPES,
          connected: true,
        },
      });

      if (ig) {
        // IG publica con el token de la Página vinculada.
        await prisma.socialAccount.upsert({
          where: {
            clinicId_provider_externalId: { clinicId, provider: "INSTAGRAM", externalId: ig.id },
          },
          create: {
            clinicId,
            provider: "INSTAGRAM",
            externalId: ig.id,
            name: ig.username ?? page.name,
            accessTokenEnc: pageTokenEnc,
            igBusinessId: ig.id,
            scope: OAUTH_SCOPES,
            connected: true,
          },
          update: {
            name: ig.username ?? page.name,
            accessTokenEnc: pageTokenEnc,
            igBusinessId: ig.id,
            scope: OAUTH_SCOPES,
            connected: true,
          },
        });
      }
    }

    const res = NextResponse.redirect(connectionsUrl("?ok=1"));
    res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err: any) {
    // Solo el mensaje de Graph; jamás el token.
    console.error("[marketing/oauth/callback]", err?.message ?? "error");
    return fail("exchange");
  }
}
