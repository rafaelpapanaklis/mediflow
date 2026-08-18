// ═══════════════════════════════════════════════════════════════════════════
// Manager de cuenta — contrato compartido servidor ↔ cliente.
//
// La clínica ve SOLO el manager que tiene asignado. Este DTO es exactamente lo
// que viaja al navegador del panel: nada de ids de otras clínicas, nada del
// catálogo completo. Ver src/lib/account-manager/get-for-clinic.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** Estado de un manager en el catálogo. Un `paused` nunca sale "en línea". */
export const ACCOUNT_MANAGER_STATUSES = ["active", "paused"] as const;
export type AccountManagerStatus = (typeof ACCOUNT_MANAGER_STATUSES)[number];

/** Horario + identidad. Es lo mínimo que necesita `availability.ts`. */
export interface AccountManagerSchedule {
  /** 0=Domingo … 6=Sábado. Lun–Vie = [1,2,3,4,5]. */
  days: number[];
  /** Minutos desde medianoche. 9:00 = 540. */
  startMinutes: number;
  /** Minutos desde medianoche, EXCLUSIVO. 18:00 = 1080. */
  endMinutes: number;
  /** IANA tz en la que se evalúa el horario (no la del visitante). */
  timezone: string;
  status: string;
}

/** Lo que renderiza la tarjeta del panel de la clínica. */
export interface AccountManagerDTO extends AccountManagerSchedule {
  id: string;
  name: string;
  photoUrl: string | null;
  /** E.164 SIN "+" — se concatena directo en `wa.me/<numero>`. */
  whatsappE164: string;
  /** Ya derivado si venía null en BD (ver formatWhatsappDisplay). */
  whatsappDisplay: string;
}

/** Fila del catálogo en /admin (incluye el conteo de clínicas atendidas). */
export interface AccountManagerAdminRow extends AccountManagerDTO {
  clinicCount: number;
  createdAt: string;
}

// ── Teléfono ───────────────────────────────────────────────────────────────
// Guardamos E.164 sin "+" ("529992602093"): es lo que espera wa.me y evita
// tener que url-encodear el "+". Mostramos el nacional agrupado 3-3-4.

export const WHATSAPP_COUNTRY_CODE = "52";
export const WHATSAPP_NATIONAL_DIGITS = 10;

/** Deja sólo dígitos. */
export function digitsOnly(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Valida los 10 dígitos nacionales y devuelve el E.164 sin "+", o null.
 * Acepta que venga ya con el 52 delante (pegado desde otro lado).
 */
export function toWhatsappE164(input: string): string | null {
  let d = digitsOnly(input);
  if (d.length === WHATSAPP_NATIONAL_DIGITS + WHATSAPP_COUNTRY_CODE.length && d.startsWith(WHATSAPP_COUNTRY_CODE)) {
    d = d.slice(WHATSAPP_COUNTRY_CODE.length);
  }
  if (d.length !== WHATSAPP_NATIONAL_DIGITS) return null;
  return `${WHATSAPP_COUNTRY_CODE}${d}`;
}

/**
 * "529992602093" → "999 260 2093". Si el número no calza con el patrón
 * esperado devuelve los dígitos tal cual (nunca revienta el render).
 */
export function formatWhatsappDisplay(e164: string): string {
  const d = digitsOnly(e164);
  const national = d.startsWith(WHATSAPP_COUNTRY_CODE) ? d.slice(WHATSAPP_COUNTRY_CODE.length) : d;
  if (national.length !== WHATSAPP_NATIONAL_DIGITS) return d;
  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

/**
 * ¿El número del manager sirve para abrir un chat?
 *
 * `whatsappE164` es NOT NULL en BD, así que "manager sin WhatsApp" en la
 * práctica es una fila con el campo vacío o con basura (alta a mano, importación).
 * Un href a `wa.me/` con eso manda a la clínica a una pantalla de error de
 * WhatsApp, así que quien pinte un botón tiene que preguntar antes.
 */
export function hasUsableWhatsapp(e164: string | null | undefined): boolean {
  return digitsOnly(e164 ?? "").length >= WHATSAPP_NATIONAL_DIGITS;
}

/** Iniciales para el avatar de respaldo: "Rafael P." → "RP". */
export function initialsFromName(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** Primer nombre — lo usa el mensaje pre-escrito de WhatsApp. */
export function firstNameOf(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts[0] ?? "";
}
