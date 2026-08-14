// ─────────────────────────────────────────────────────────────────────────────
// Fechas y horas del consentimiento informado, en la zona horaria de la CLÍNICA.
//
// POR QUÉ EXISTE ESTE ARCHIVO: todo lo que el módulo formatea en el SERVIDOR
// (el "Lugar y fecha" de la carta y las fechas de firma del PDF) salía en la
// zona del runtime, que en Vercel es UTC. Una carta generada el 13 de agosto a
// las 23:43 de México se imprimía "a 14 de agosto de 2026" y su firma como
// "14/08/2026 05:43 a.m.": el documento legal fechaba un día que todavía no
// había llegado. Lo que ve el paciente en la pantalla NO tenía el bug —eso lo
// formatea su navegador— así que el PDF y la página se contradecían.
//
// NO se inventa una constante nueva: la zona ya vive en `Clinic.timezone`
// (default "America/Mexico_City" en el schema) y el fallback compartido de todo
// el producto es `DEFAULT_TZ` de la agenda. Aquí solo se envuelve para que cada
// punto del módulo formatee igual y nadie vuelva a llamar a `toLocaleDateString`
// sin `timeZone`.
//
// PURO: sin Prisma, sin React y sin red — lo importan el generador de la carta,
// el PDF y las rutas.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_TZ } from "@/lib/agenda/date-ranges";

/**
 * Zona horaria por defecto del producto (México). Se reexporta desde la agenda
 * a propósito: si algún día el default nacional cambia, cambia en un solo sitio
 * y los consentimientos lo heredan.
 */
export const CONSENT_DEFAULT_TZ = DEFAULT_TZ;

/** Lo que se imprime cuando no hay fecha (misma raya que usaba el PDF). */
const EM_DASH = "—";

/**
 * Cache del resultado de validar una zona: `Intl` lanza `RangeError` con una
 * zona inexistente y un dato sucio en `Clinic.timezone` tumbaría la generación
 * del PDF entera. Ante la duda se cae al default en vez de romper el documento.
 */
const RESOLVED_TZ = new Map<string, string>();

/** Zona de la clínica, validada. Vacía o inválida → default nacional. */
export function consentTimeZone(timezone?: string | null): string {
  const raw = (timezone ?? "").trim();
  if (!raw) return CONSENT_DEFAULT_TZ;

  const cached = RESOLVED_TZ.get(raw);
  if (cached) return cached;

  let resolved = CONSENT_DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: raw }).format(new Date(0));
    resolved = raw;
  } catch {
    resolved = CONSENT_DEFAULT_TZ;
  }
  RESOLVED_TZ.set(raw, resolved);
  return resolved;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Fecha larga — "13 de agosto de 2026".
 *
 * Es la del membrete del PDF y la del "Lugar y fecha" de la carta: la fecha del
 * ACTO, la que se lee en voz alta delante del paciente.
 */
export function formatConsentDate(
  value: Date | string | null | undefined,
  timezone?: string | null,
): string {
  const d = toDate(value);
  if (!d) return EM_DASH;
  return d.toLocaleDateString("es-MX", {
    timeZone: consentTimeZone(timezone),
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Fecha y hora — "13/08/2026 11:43 p.m.".
 *
 * Es la de cada firma (paciente, testigos, doctor) y la de la evidencia
 * electrónica. La hora importa tanto como el día: es lo que acredita que se
 * firmó ANTES del procedimiento.
 */
export function formatConsentDateTime(
  value: Date | string | null | undefined,
  timezone?: string | null,
): string {
  const d = toDate(value);
  if (!d) return EM_DASH;
  const tz = consentTimeZone(timezone);
  const date = d.toLocaleDateString("es-MX", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("es-MX", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}
