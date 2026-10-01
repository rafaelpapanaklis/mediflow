// ws1-t8 · M3 — Límite de intentos del 2FA y códigos TOTP de un solo uso.
//
// ANTES: cada ruta de /api/auth/2fa/* llevaba `rateLimit(req, 6, 15 min)`, que
// vive EN MEMORIA, por IP y por instancia serverless. Con la contraseña de la
// víctima, repartir los intentos entre IPs e instancias multiplicaba el
// presupuesto sin límite. Y un código TOTP válido servía tantas veces como se
// enviara durante su ventana (~90 s con la tolerancia de ±1 paso).
//
// AHORA:
//   • El presupuesto es por CUENTA (supabaseId de la sesión, no algo del
//     cliente), compartido entre verify, enable, disable y recovery-codes —
//     cambiar de ruta no da intentos nuevos— y persistente (Upstash vía
//     persistentRateLimit; sin Upstash cae a memoria, como todo failban).
//   • Dos ventanas: 6 por 15 min (el mismo margen que tenía el humano que se
//     equivoca) y 30 por día, que es lo que de verdad acota la fuerza bruta:
//     30 intentos contra 3 códigos válidos de 1 000 000 por intento.
//   • Más un freno por IP generoso (anti-ráfaga), antes de resolver la sesión.
//   • Cada paso TOTP aceptado se marca usado (SET NX con caducidad) para esa
//     persona: el mismo código no entra dos veces.
//
// Solo Node (otplib + failban). Nunca desde el middleware.
import { authenticator } from "otplib";
import type { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit, acquireLock } from "@/lib/failban";

// Ventana ±1 paso (±30 s), la misma que fija two-factor.ts: es el mismo
// singleton de otplib, y las dos tienen que verificar igual.
authenticator.options = { window: 1 };

const PASO_SEGUNDOS = 30;

export const LIMITES_2FA = {
  /** Freno por IP, antes de saber de quién es la sesión. */
  ip: { limit: 30, windowSec: 15 * 60 },
  /** Por cuenta: el humano que se equivoca nunca debe chocar con esto. */
  cuenta15m: { limit: 6, windowSec: 15 * 60 },
  /** Por cuenta y día: el techo real contra la fuerza bruta. */
  cuentaDia: { limit: 30, windowSec: 24 * 60 * 60 },
  /** /setup no valida códigos (genera un secreto): presupuesto aparte. */
  setup: { limit: 8, windowSec: 15 * 60 },
} as const;

/** Anti-ráfaga por IP para cualquier ruta del 2FA. 429 o null. */
export function limitar2faPorIp(req: NextRequest): Promise<NextResponse | null> {
  return persistentRateLimit(req, { scope: "2fa:ip", ...LIMITES_2FA.ip });
}

/**
 * Presupuesto de intentos de CÓDIGO de esta persona (verify, enable, disable,
 * recovery-codes comparten llave). 429 o null. Va después de resolver la
 * sesión: el id sale de ahí, nunca de la petición.
 */
export async function limitar2faPorCuenta(
  req: NextRequest,
  supabaseId: string,
): Promise<NextResponse | null> {
  const corto = await persistentRateLimit(req, {
    id: supabaseId,
    scope: "2fa:cuenta:15m",
    ...LIMITES_2FA.cuenta15m,
  });
  if (corto) return corto;
  return persistentRateLimit(req, {
    id: supabaseId,
    scope: "2fa:cuenta:dia",
    ...LIMITES_2FA.cuentaDia,
  });
}

/** Presupuesto de /api/auth/2fa/setup por persona. */
export function limitar2faSetup(req: NextRequest, supabaseId: string): Promise<NextResponse | null> {
  return persistentRateLimit(req, { id: supabaseId, scope: "2fa:setup", ...LIMITES_2FA.setup });
}

/**
 * Paso TOTP (contador de 30 s desde epoch) con el que casa el código, o null
 * si no casa. Mismo formato y tolerancia que verifyTotp de two-factor.ts.
 */
export function pasoTotp(token: string, secret: string, ahoraMs: number = Date.now()): number | null {
  if (!secret) return null;
  const t = (token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(t)) return null;
  let delta: number | null = null;
  try {
    delta = authenticator.checkDelta(t, secret);
  } catch {
    return null;
  }
  if (delta === null || delta === undefined) return null;
  return Math.floor(ahoraMs / 1000 / PASO_SEGUNDOS) + delta;
}

/**
 * ¿Es la PRIMERA vez que esta persona usa este paso? Marca el paso como usado
 * (SET NX, 3 min: más que la vida de un código con la tolerancia ±1).
 */
export function marcarPasoTotpUsado(supabaseId: string, paso: number): Promise<boolean> {
  return acquireLock(`2fa:totp:${supabaseId}:${paso}`, 3 * 60);
}

export type ResultadoTotp = "ok" | "incorrecto" | "reusado";

/**
 * Verifica un TOTP de un solo uso: casa con el secreto Y su paso no se había
 * usado ya. Es lo que tienen que llamar las rutas, no verifyTotp a secas.
 */
export async function consumirTotp(
  supabaseId: string,
  token: string,
  secret: string,
): Promise<ResultadoTotp> {
  const paso = pasoTotp(token, secret);
  if (paso === null) return "incorrecto";
  return (await marcarPasoTotpUsado(supabaseId, paso)) ? "ok" : "reusado";
}

export const MENSAJE_TOTP_REUSADO = "Ese código ya se usó. Espera el siguiente en tu app.";
