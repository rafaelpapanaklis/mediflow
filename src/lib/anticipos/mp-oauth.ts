// OAuth de Mercado Pago para conectar la cuenta de la CLÍNICA (WS1-T5).
//
// ¿Por qué OAuth y no «pega tu access token» como labs y proveedores?
// Por la comisión. `marketplace_fee` solo llega a DaleControl si el token con el
// que se crea el cobro lo emitió la aplicación de DaleControl por OAuth: con un
// token que la clínica genera en SU propia aplicación no hay marketplace y la
// comisión no tiene a dónde ir. La comisión sale en 0, pero se construye desde
// el primer día porque meterla después obligaría a reconectar a cada clínica.
// De paso, la clínica no copia ni pega ningún secreto: autoriza y listo.
//
// Documentación: https://www.mercadopago.com.mx/developers/es/docs/security/oauth
//
// Aquí solo hay HTTP y armado de URLs. NUNCA se escribe un token en un log ni
// en un mensaje de error: los errores dicen el status, no el cuerpo.

import { createHash, randomBytes } from "crypto";

const AUTH_URL = "https://auth.mercadopago.com/authorization";
const API = "https://api.mercadopago.com";

export interface ConfigOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokensMp {
  accessToken: string;
  refreshToken: string | null;
  /** Segundos de vida (MP da 180 días). */
  expiresIn: number;
  userId: string;
  liveMode: boolean | null;
}

export interface CuentaMp {
  id: string;
  nickname: string | null;
  email: string | null;
}

/** Valor aleatorio URL-safe (state y code_verifier de PKCE). */
export function aleatorioUrl(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** code_challenge S256 de PKCE. */
export function retoPkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** URL a la que se manda al administrador de la clínica para que autorice. */
export function urlDeAutorizacion(cfg: ConfigOAuth, state: string, codeVerifier: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: cfg.redirectUri,
    code_challenge: retoPkce(codeVerifier),
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q.toString()}`;
}

function leerTokens(data: Record<string, unknown>): TokensMp {
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const userId = data.user_id != null ? String(data.user_id) : "";
  if (!accessToken || !userId) throw new Error("Mercado Pago no devolvió el token de la cuenta");
  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 0;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresIn,
    userId,
    liveMode: typeof data.live_mode === "boolean" ? data.live_mode : null,
  };
}

async function postToken(body: Record<string, string>): Promise<TokensMp> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // `error`/`message` de MP son códigos cortos («invalid_grant»); el cuerpo
    // entero no se loguea por si trajera algo sensible.
    const codigo = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "";
    throw new Error(`Mercado Pago rechazó el token (${res.status}${codigo ? ` ${codigo}` : ""})`);
  }
  return leerTokens(data);
}

/** Canjea el `code` del callback por los tokens de la cuenta de la clínica. */
export function canjearCodigo(
  cfg: ConfigOAuth,
  code: string,
  codeVerifier: string,
  opciones: { tokenDePrueba?: boolean } = {},
): Promise<TokensMp> {
  return postToken({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
    ...(opciones.tokenDePrueba ? { test_token: "true" } : {}),
  });
}

/** Renueva el access token con el refresh token (antes de que caduquen los 180 días). */
export function renovarTokens(
  cfg: Pick<ConfigOAuth, "clientId" | "clientSecret">,
  refreshToken: string,
): Promise<TokensMp> {
  return postToken({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Con qué cuenta quedó conectada (apodo y correo, para enseñarlo en pantalla). */
export async function leerCuenta(accessToken: string): Promise<CuentaMp | null> {
  const res = await fetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (data.id == null) return null;
  return {
    id: String(data.id),
    nickname: typeof data.nickname === "string" ? data.nickname : null,
    email: typeof data.email === "string" ? data.email : null,
  };
}
