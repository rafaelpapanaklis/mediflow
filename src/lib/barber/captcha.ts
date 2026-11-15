import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIp } from "@/lib/failban";
import {
  BARBER_CAPTCHA_ERRORS,
  BARBER_CAPTCHA_SECRET_ENV,
  BARBER_CAPTCHA_SITE_KEY_ENV,
  TURNSTILE_SITEVERIFY_URL,
  barberCaptchaConfig,
  classifySiteverify,
  cleanCaptchaToken,
  type BarberCaptchaAction,
  type BarberCaptchaErrorCode,
} from "@/lib/barber/captcha-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — el captcha del lado del SERVIDOR (una sola pieza).

   Lo usan las cuatro puertas públicas que un bot puede martillar:
     · la reserva          POST /api/barber/public/booking/[slug]
     · la fila virtual     POST /api/barber/walkins/public
     · el código de «mi cuenta»  POST /api/barber/portal/[slug]/code
     · el alta de barberías      POST /api/barber/auth/register

   El token se verifica SIEMPRE aquí, con Cloudflare, ANTES de crear nada.
   Lo que pinte o deje de pintar el navegador no decide nada.

   Sin las dos variables → `verified: false` y la puerta sigue abierta como
   antes. Se avisa en el log una vez por puerta y por proceso (en Vercel,
   una vez por arranque en frío), para que no pase desapercibido sin llenar
   el log con una línea por reserva.
   ═══════════════════════════════════════════════════════════════════════ */

/** Cuánto se le espera a Cloudflare. Pasado esto: «reintenta», nunca un 500. */
const SITEVERIFY_TIMEOUT_MS = 8_000;

export type BarberCaptchaCheck =
  /** verified=true: persona comprobada. false: captcha sin configurar. */
  | { ok: true; verified: boolean }
  | { ok: false; code: BarberCaptchaErrorCode };

const warnedOff = new Set<string>();

/**
 * La llave del SITIO que se le pasa al widget, o null si el captcha está
 * apagado. Se lee en el servidor, en cada petición, y viaja como prop: así el
 * navegador y la verificación SIEMPRE opinan lo mismo (si la llave se
 * horneara en el bundle podría quedar un navegador sin widget frente a un
 * servidor que exige token).
 */
export function barberCaptchaSiteKey(): string | null {
  return barberCaptchaConfig(process.env)?.siteKey ?? null;
}

/** ¿El captcha está encendido? (las dos variables puestas) */
export function barberCaptchaEnabled(): boolean {
  return barberCaptchaConfig(process.env) !== null;
}

function warnOffOnce(scope: string): void {
  if (warnedOff.has(scope)) return;
  warnedOff.add(scope);
  const missing = [BARBER_CAPTCHA_SITE_KEY_ENV, BARBER_CAPTCHA_SECRET_ENV]
    .filter((name) => !(process.env[name] ?? "").trim())
    .join(" y ");
  console.warn(
    `[barber/captcha] ${scope}: SIN captcha — falta ${missing}. La puerta sigue abierta como antes.`,
  );
}

export interface VerifyBarberCaptchaInput {
  /** Lo que mandó el navegador (campo `captchaToken`). */
  token: unknown;
  action: BarberCaptchaAction;
  /** IP del cliente, opcional: Cloudflare la usa como señal extra. */
  ip?: string | null;
  /** Para pruebas: otro fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Comprueba el token con Cloudflare. Nunca lanza.
 *
 *   { ok: true, verified: false } → captcha apagado (o llave secreta mala):
 *                                   se sigue como antes.
 *   { ok: true, verified: true }  → persona.
 *   { ok: false, code }           → contestar con barberCaptchaResponse(code).
 */
export async function verifyBarberCaptcha(input: VerifyBarberCaptchaInput): Promise<BarberCaptchaCheck> {
  const cfg = barberCaptchaConfig(process.env);
  if (!cfg) {
    warnOffOnce(input.action);
    return { ok: true, verified: false };
  }

  const token = cleanCaptchaToken(input.token);
  if (!token) return { ok: false, code: "captchaRequired" };

  const form = new URLSearchParams();
  form.set("secret", cfg.secret);
  form.set("response", token);
  if (input.ip && input.ip !== "unknown") form.set("remoteip", input.ip);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
  let json: unknown = null;
  try {
    const res = await (input.fetchImpl ?? fetch)(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    console.warn(
      `[barber/captcha] ${input.action}: Cloudflare no respondió (${err instanceof Error ? err.name : "error"}).`,
    );
    return { ok: false, code: "captchaUnavailable" };
  } finally {
    clearTimeout(timer);
  }

  const verdict = classifySiteverify(json, input.action);
  if (verdict === "ok") return { ok: true, verified: true };
  if (verdict === "misconfigured") {
    // La llave SECRETA está mal: ningún cliente lo provoca ni lo puede
    // arreglar. Se deja pasar como sin captcha y se grita en el log.
    console.error(
      `[barber/captcha] ${input.action}: Cloudflare rechazó ${BARBER_CAPTCHA_SECRET_ENV} (revísala en Vercel). Sigue sin captcha.`,
    );
    return { ok: true, verified: false };
  }
  if (verdict === "unavailable") return { ok: false, code: "captchaUnavailable" };
  return { ok: false, code: "captchaFailed" };
}

/** La respuesta JSON para un captcha que no pasó: texto claro + `code`. */
export function barberCaptchaResponse(code: BarberCaptchaErrorCode): NextResponse {
  const e = BARBER_CAPTCHA_ERRORS[code];
  return NextResponse.json({ error: e.message, code }, { status: e.status });
}

/** IP del cliente con la misma regla del freno persistente del dental. */
export function barberCaptchaIp(req: Request): string {
  return getClientIp(req as NextRequest);
}

/**
 * La forma corta para una ruta: verifica y, si no pasó, trae ya la
 * respuesta lista para devolver.
 *
 *   const captcha = await checkBarberCaptcha(req, body.captchaToken, ACCION);
 *   if (captcha.response) return captcha.response;
 *   // captcha.verified: true = persona comprobada; false = captcha apagado
 */
export async function checkBarberCaptcha(
  req: Request,
  token: unknown,
  action: BarberCaptchaAction,
): Promise<{ response: NextResponse | null; verified: boolean }> {
  const check = await verifyBarberCaptcha({ token, action, ip: barberCaptchaIp(req) });
  if (check.ok === false) return { response: barberCaptchaResponse(check.code), verified: false };
  return { response: null, verified: check.verified };
}
