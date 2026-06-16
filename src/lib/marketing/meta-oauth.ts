// ═══════════════════════════════════════════════════════════════════
// OAuth de Meta (Facebook Login) para conectar Páginas + Instagram (WS-MKT-T4).
// State anti-CSRF firmado (HMAC) atado a clinicId+userId+nonce; intercambio
// code→token corto→token largo; descubrimiento de Páginas e IG vinculado.
// NUNCA se loguea ni se devuelve al cliente ningún token.
// ═══════════════════════════════════════════════════════════════════
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { graphGet } from "./meta-graph";

export const OAUTH_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export interface OAuthStatePayload {
  clinicId: string;
  userId: string;
  nonce: string;
}

function stateSecret(): string {
  const s = process.env.META_APP_SECRET;
  if (!s) throw new Error("META_APP_SECRET no configurado");
  return s;
}

/** Firma el state como `payload.sig` (HMAC-SHA256). El payload va en claro pero
 *  no se puede falsificar sin el secreto; el nonce se cruza con una cookie. */
export function signOAuthState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const idx = state.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  let expected: string;
  try {
    expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      obj &&
      typeof obj.clinicId === "string" &&
      typeof obj.userId === "string" &&
      typeof obj.nonce === "string"
    ) {
      return obj as OAuthStatePayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** URL del diálogo de OAuth de Meta. redirect_uri DEBE coincidir con el del intercambio. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    redirect_uri: process.env.META_OAUTH_REDIRECT ?? "",
    state,
    scope: OAUTH_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

/** code → access token corto. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const data = await graphGet("oauth/access_token", {
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: process.env.META_OAUTH_REDIRECT ?? "",
    code,
  });
  if (!data?.access_token) throw new Error("Meta no devolvió access_token");
  return String(data.access_token);
}

/** token corto → token de usuario de larga duración (~60 días). */
export async function exchangeForLongLivedToken(shortToken: string): Promise<string> {
  const data = await graphGet("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: shortToken,
  });
  if (!data?.access_token) throw new Error("Meta no devolvió el token de larga duración");
  return String(data.access_token);
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string; // page token (largo si el user token es largo)
}

/** Páginas que administra el usuario, con su page access token. */
export async function fetchUserPages(userToken: string): Promise<MetaPage[]> {
  const data = await graphGet("me/accounts", {
    fields: "id,name,access_token",
    limit: "100",
    access_token: userToken,
  });
  const list = Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((p: any) => p?.id && p?.access_token)
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name ?? "Página"),
      access_token: String(p.access_token),
    }));
}

export interface PageInstagram {
  id: string;
  username: string | null;
}

/** Cuenta de Instagram Business vinculada a una Página (si existe). */
export async function fetchPageInstagram(
  pageId: string,
  pageToken: string,
): Promise<PageInstagram | null> {
  const data = await graphGet(pageId, {
    fields: "instagram_business_account{id,username}",
    access_token: pageToken,
  });
  const ig = data?.instagram_business_account;
  if (!ig?.id) return null;
  return { id: String(ig.id), username: ig.username ? String(ig.username) : null };
}
