/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — núcleo PURO del captcha (Cloudflare Turnstile).

   Sin prisma, sin next, sin "server-only": solo decisiones. La llamada a
   Cloudflare vive en ./captcha.ts (servidor) y el widget en
   src/components/barber/captcha/barber-captcha.tsx (navegador).

   POR QUÉ TURNSTILE (decisión de Rafael, 15-nov-2026: «que dejen reservar a
   cualquiera sin ningún problema; para que ningún bot cree 10 mil cuentas en
   segundos pon un captcha, mejor gratuito, rápido y listo»):
     · gratuito, sin tope práctico para el volumen de una barbería;
     · en modo «Managed» + apariencia `interaction-only` casi nunca le pide
       nada a una persona: el widget ni se ve, y solo aparece una casilla
       cuando Cloudflare duda.

   LAS DOS VARIABLES (las pone Rafael en Vercel):
     · NEXT_PUBLIC_TURNSTILE_SITE_KEY — la llave del SITIO (pública).
     · TURNSTILE_SECRET_KEY           — la llave SECRETA (solo servidor).
   El captcha se ENCIENDE solo cuando están LAS DOS. Con una sola, o con
   ninguna, todo sigue como antes (sin captcha) y el servidor lo deja dicho
   en el log: una variable que falta no puede tumbar la reserva de nadie.
   ═══════════════════════════════════════════════════════════════════════ */

export const BARBER_CAPTCHA_SITE_KEY_ENV = "NEXT_PUBLIC_TURNSTILE_SITE_KEY" as const;
export const BARBER_CAPTCHA_SECRET_ENV = "TURNSTILE_SECRET_KEY" as const;

/** Donde Cloudflare comprueba el token. */
export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify" as const;
/** El script del widget (modo explícito: lo pinta nuestro componente). */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" as const;

/** Un token de Turnstile mide como mucho 2048 caracteres (doc. de Cloudflare). */
export const TURNSTILE_TOKEN_MAX = 2048;

/**
 * Las cuatro puertas públicas con captcha. El nombre viaja como `action` del
 * widget y Cloudflare lo devuelve al verificar: un token sacado de la fila
 * no sirve para reservar ni para darse de alta.
 */
export const BARBER_CAPTCHA_ACTIONS = {
  booking: "barber-booking",
  walkin: "barber-walkin",
  portalCode: "barber-portal-code",
  register: "barber-register",
} as const;

export type BarberCaptchaAction =
  (typeof BARBER_CAPTCHA_ACTIONS)[keyof typeof BARBER_CAPTCHA_ACTIONS];

export interface BarberCaptchaConfig {
  siteKey: string;
  secret: string;
}

type EnvLike = Record<string, string | undefined>;

/** Las dos llaves, o null si falta cualquiera de ellas. */
export function barberCaptchaConfig(env: EnvLike): BarberCaptchaConfig | null {
  const siteKey = (env[BARBER_CAPTCHA_SITE_KEY_ENV] ?? "").trim();
  const secret = (env[BARBER_CAPTCHA_SECRET_ENV] ?? "").trim();
  if (!siteKey || !secret) return null;
  return { siteKey, secret };
}

/** Lo que manda el navegador: un texto razonable, o nada. */
export function cleanCaptchaToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (!token || token.length > TURNSTILE_TOKEN_MAX) return null;
  return token;
}

/**
 * Qué significa lo que contestó Cloudflare.
 *
 *   ok            → persona verificada.
 *   failed        → token malo, vencido o ya usado: el navegador pide otro.
 *   misconfigured → la llave SECRETA está mal escrita o vencida. No es culpa
 *                   del cliente ni lo puede provocar un bot: se deja pasar
 *                   (como sin captcha) y se grita en el log.
 *   unavailable   → Cloudflare no supo contestar: reintento.
 */
export type SiteverifyVerdict = "ok" | "failed" | "misconfigured" | "unavailable";

const SECRET_ERRORS = new Set(["missing-input-secret", "invalid-input-secret"]);

export function classifySiteverify(json: unknown, expectedAction: string): SiteverifyVerdict {
  if (!json || typeof json !== "object") return "unavailable";
  const r = json as { success?: unknown; action?: unknown; "error-codes"?: unknown };
  const codes = Array.isArray(r["error-codes"])
    ? (r["error-codes"] as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  if (r.success === true) {
    // Un token de OTRA puerta (la fila, el registro) no abre ésta. Si
    // Cloudflare no manda `action` (versiones viejas), no se inventa un fallo.
    if (typeof r.action === "string" && r.action && r.action !== expectedAction) return "failed";
    return "ok";
  }
  if (codes.some((c) => SECRET_ERRORS.has(c))) return "misconfigured";
  if (codes.includes("internal-error")) return "unavailable";
  return "failed";
}

/**
 * Códigos que viajan al navegador. El widget los reconoce para pedir un
 * token nuevo sin que la persona tenga que recargar la página.
 */
export type BarberCaptchaErrorCode = "captchaRequired" | "captchaFailed" | "captchaUnavailable";

export const BARBER_CAPTCHA_ERROR_CODES: readonly BarberCaptchaErrorCode[] = [
  "captchaRequired",
  "captchaFailed",
  "captchaUnavailable",
];

export function isBarberCaptchaErrorCode(code: unknown): code is BarberCaptchaErrorCode {
  return typeof code === "string" && (BARBER_CAPTCHA_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Respuesta del servidor para cada caso. Texto claro, de tú, y siempre con
 * salida: nunca un error crudo.
 */
export const BARBER_CAPTCHA_ERRORS: Record<
  BarberCaptchaErrorCode,
  { status: number; message: string }
> = {
  captchaRequired: {
    status: 400,
    message: "Estamos comprobando que eres una persona. Espera un segundo y vuelve a intentarlo.",
  },
  captchaFailed: {
    status: 400,
    message: "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
  },
  captchaUnavailable: {
    status: 503,
    message: "La verificación no responde en este momento. Espera unos segundos y vuelve a intentarlo.",
  },
};
