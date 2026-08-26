/**
 * DaleControl BARBER — países del teléfono de registro. Módulo PURO y
 * client-safe (no importa prisma ni "server-only"): lo consumen EL MISMO
 * formulario del navegador y EL MISMO endpoint del servidor, para que no
 * pueda pasar lo de siempre — el botón en verde en el navegador y un 400
 * al final del registro porque el servidor validaba otra cosa.
 *
 * QUÉ SE GUARDA (esto es lo delicado, y es a propósito asimétrico):
 *
 *   · MÉXICO  → los 10 dígitos limpios de mxTenDigits, EXACTAMENTE como
 *     antes de que existiera este archivo. Sin "+", sin 52. Todo el
 *     vertical (recordatorios, inbox, bot, campañas) lee ese campo dando
 *     por hecho el formato mexicano de hoy, así que aquí no cambia NADA.
 *   · CUALQUIER OTRO PAÍS → E.164 completo: "+" + lada + número, sin
 *     espacios ni guiones. Es el único formato que se explica solo cuando
 *     alguien lo lea desde fuera de México.
 *
 * NO hay columna de país: `barber_shops` no la tiene y esta ola no lleva
 * SQL. El país vive en el prefijo del propio número — que es justo para lo
 * que sirve E.164 — y en MX se deduce de que son 10 dígitos pelones.
 *
 * ⚠️ AVISO QUE NO ARREGLA ESTE ARCHIVO: el envío de WhatsApp del vertical
 * pasa por normalizeMxWhatsAppPhone (@/lib/whatsapp), que ANTEPONE 52. Una
 * barbería registrada con otro país se da de alta bien, pero sus mensajes
 * saldrían a un número mexicano inventado. Está escrito en ORQUESTA.md
 * como riesgo abierto: se arregla entero o no se arregla — un parche a
 * medias aquí sería peor que el problema.
 */
import { MX_PHONE_ERROR, mxTenDigits } from "@/lib/phone-mx";

export interface BarberPhoneCountry {
  /** ISO-2 en mayúsculas. Es lo que viaja en el JSON del registro. */
  iso: string;
  name: string;
  /** Lada internacional SIN "+". */
  dial: string;
  /** Largo típico del número LOCAL. Guía al usuario; no es el candado. */
  len: number;
}

/**
 * Lista CURADA — sin librería ni dependencia npm nueva. México primero
 * (es el mercado) y después el resto por donde de verdad puede llegar una
 * barbería hispanohablante. Añadir un país es un renglón aquí y nada más:
 * el formulario y el servidor lo toman solos.
 */
export const BARBER_PHONE_COUNTRIES: BarberPhoneCountry[] = [
  { iso: "MX", name: "México", dial: "52", len: 10 },
  { iso: "US", name: "Estados Unidos", dial: "1", len: 10 },
  { iso: "ES", name: "España", dial: "34", len: 9 },
  { iso: "CO", name: "Colombia", dial: "57", len: 10 },
  { iso: "AR", name: "Argentina", dial: "54", len: 10 },
  { iso: "CL", name: "Chile", dial: "56", len: 9 },
  { iso: "PE", name: "Perú", dial: "51", len: 9 },
  { iso: "GT", name: "Guatemala", dial: "502", len: 8 },
  { iso: "EC", name: "Ecuador", dial: "593", len: 9 },
  { iso: "CR", name: "Costa Rica", dial: "506", len: 8 },
  { iso: "DO", name: "República Dominicana", dial: "1", len: 10 },
  { iso: "PA", name: "Panamá", dial: "507", len: 8 },
  { iso: "UY", name: "Uruguay", dial: "598", len: 8 },
  { iso: "BO", name: "Bolivia", dial: "591", len: 8 },
  { iso: "PY", name: "Paraguay", dial: "595", len: 9 },
  { iso: "SV", name: "El Salvador", dial: "503", len: 8 },
  { iso: "HN", name: "Honduras", dial: "504", len: 8 },
  { iso: "NI", name: "Nicaragua", dial: "505", len: 8 },
  { iso: "VE", name: "Venezuela", dial: "58", len: 10 },
];

/** Preseleccionado y default del servidor cuando no llega país. */
export const BARBER_DEFAULT_PHONE_COUNTRY = "MX";

/** El país pedido, o México. Nunca devuelve undefined: siempre hay candado. */
export function barberPhoneCountry(iso: unknown): BarberPhoneCountry {
  const key = typeof iso === "string" ? iso.trim().toUpperCase() : "";
  return (
    BARBER_PHONE_COUNTRIES.find((c) => c.iso === key) ??
    BARBER_PHONE_COUNTRIES.find((c) => c.iso === BARBER_DEFAULT_PHONE_COUNTRY)!
  );
}

/**
 * 🇲🇽 a partir del ISO-2 (dos "regional indicators"). Se DERIVA en vez de
 * escribir el emoji en el código: así ningún editor, guardado en ANSI o
 * copy-paste puede convertir la bandera en interrogaciones.
 *
 * Windows no trae glifos de bandera, así que ahí Chrome pinta las dos
 * letras ("MX") — sigue leyéndose, y por eso la lada va SIEMPRE al lado.
 */
export function barberPhoneFlag(iso: string): string {
  const letras = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(letras)) return "";
  // Array.from y no [...letras]: el tsconfig del repo no fija `target`, así
  // que el spread de un string no compila (TS2802).
  return String.fromCodePoint(
    ...Array.from(letras).map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)),
  );
}

/** Mensaje de error del país. México reusa el texto único de phone-mx. */
export function barberPhoneError(country: BarberPhoneCountry): string {
  if (country.iso === BARBER_DEFAULT_PHONE_COUNTRY) return MX_PHONE_ERROR;
  return `Escribe tu WhatsApp de ${country.name} (${country.len} dígitos)`;
}

/**
 * Una sola forma, no una unión discriminada: el tsconfig del repo va con
 * `strict: false` y ahí TypeScript NO estrecha por `ok`, así que un
 * `if (!r.ok) r.error` no compilaría. Misma convención que BarberLimitCheck
 * en gating.ts: los campos que no aplican van vacíos.
 */
export interface BarberPhoneResult {
  ok: boolean;
  /** País con el que se validó (ya resuelto: nunca vacío). */
  iso: string;
  /** Lo que va a la columna `phone` de barber_shops. Vacío si !ok. */
  stored: string;
  /** Mensaje listo para el usuario. Vacío si ok. */
  error: string;
}

/**
 * Pega la lada al número si no la trae. El formulario manda el E.164 ya
 * armado, pero el servidor NO CONFÍA en eso: cualquiera puede llamar al
 * endpoint con el país por un lado y el número local pelón por el otro.
 *
 * El orden de los casos importa: se mira primero el largo COMPLETO y luego
 * el LOCAL, porque hay números locales que empiezan igual que su lada (un
 * colombiano "5712345678" no lleva lada, aunque empiece por 57).
 */
function conLada(country: BarberPhoneCountry, digits: string): string {
  const completo = country.dial.length + country.len;
  if (digits.length === completo && digits.startsWith(country.dial)) return digits;
  if (digits.length === country.len) return country.dial + digits;
  return digits.startsWith(country.dial) ? digits : country.dial + digits;
}

/**
 * LA REGLA — la misma en el navegador y en el servidor:
 *   · MX  → mxTenDigits (tolera +52 / +521, espacios y guiones) o error.
 *   · resto → E.164 de 6 a 15 dígitos (el máximo lo fija la propia E.164).
 *
 * `stored` es literalmente lo que va a la columna `phone` de barber_shops.
 */
export function normalizeBarberPhone(iso: unknown, rawPhone: unknown): BarberPhoneResult {
  const country = barberPhoneCountry(iso);

  if (country.iso === BARBER_DEFAULT_PHONE_COUNTRY) {
    const local = mxTenDigits(typeof rawPhone === "string" ? rawPhone : "");
    return local
      ? { ok: true, iso: country.iso, stored: local, error: "" }
      : { ok: false, iso: country.iso, stored: "", error: MX_PHONE_ERROR };
  }

  const digits = String(rawPhone ?? "").replace(/\D/g, "");
  const e164 = conLada(country, digits);
  if (!/^\d{6,15}$/.test(e164)) {
    return { ok: false, iso: country.iso, stored: "", error: barberPhoneError(country) };
  }
  return { ok: true, iso: country.iso, stored: `+${e164}`, error: "" };
}
