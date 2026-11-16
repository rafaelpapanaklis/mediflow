// ═══════════════════════════════════════════════════════════════════════
// TELÉFONO CAPTURADO EN EL PANEL — Clientes, Fila (mostrador) y Nueva visita.
//
// Antes solo cabían 10 dígitos de México y el turista de +1 / +34 no se
// podía anotar (lógica L1, decisión 5). Ahora se acepta «+código de país»,
// con México por omisión. La regla NO se inventa aquí:
//   · México (o sin país) → mxTenDigits, el MISMO ayudante de siempre: se
//     guarda IDÉNTICO a hoy (10 dígitos), así que el índice único
//     (barbershopId, phone), WhatsApp y la búsqueda no cambian para ellos.
//   · Otro país → normalizeBarberPhone de phone-countries (la del
//     registro): se guarda en E.164 con «+» («+34612345678»).
// Un número que ya viene guardado con «+» (editar la ficha de un turista)
// se acepta tal cual aunque no llegue el país.
//
// Sin «server-only»: la usan igual el formulario (para avisar antes de
// enviar) y el servidor (que no confía en el formulario).
// ═══════════════════════════════════════════════════════════════════════
import { mxTenDigits } from "@/lib/phone-mx";
import {
  BARBER_DEFAULT_PHONE_COUNTRY,
  BARBER_PHONE_COUNTRIES,
  barberPhoneCountry,
  normalizeBarberPhone as normalizeCountryPhone,
} from "@/lib/barber/phone-countries";

export interface PanelPhoneResult {
  ok: boolean;
  /** Lo que va a la columna `phone`: 10 dígitos (México) o «+E.164». Vacío si !ok. */
  stored: string;
  /** Texto para el usuario. Vacío si ok. */
  error: string;
}

/** ¿Este valor guardado es de fuera de México? («+» con lada que no es 52). */
function isForeignStored(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith("+") && !t.replace(/\D/g, "").startsWith("52");
}

/**
 * Valida y normaliza. `iso` vacío / desconocido / "MX" = México (como hoy).
 * El teléfono vacío NO se valida aquí: cada pantalla decide si es opcional.
 */
export function panelPhone(iso: unknown, raw: unknown): PanelPhoneResult {
  const text = typeof raw === "string" ? raw : "";
  const key = typeof iso === "string" ? iso.trim().toUpperCase() : "";
  const country = key ? barberPhoneCountry(key) : null;

  // Sin país pero ya en formato internacional (lo que devuelve la ficha al editar).
  if ((!country || country.iso === BARBER_DEFAULT_PHONE_COUNTRY) && isForeignStored(text)) {
    const digits = text.replace(/\D/g, "");
    return /^\d{6,15}$/.test(digits)
      ? { ok: true, stored: `+${digits}`, error: "" }
      : { ok: false, stored: "", error: "Escribe el teléfono con su lada de país (de 6 a 15 dígitos)." };
  }

  if (!country || country.iso === BARBER_DEFAULT_PHONE_COUNTRY) {
    const local = mxTenDigits(text);
    return local
      ? { ok: true, stored: local, error: "" }
      : { ok: false, stored: "", error: "Escribe el teléfono a 10 dígitos (o elige otro país)." };
  }

  const r = normalizeCountryPhone(country.iso, text);
  return r.ok
    ? { ok: true, stored: r.stored, error: "" }
    : { ok: false, stored: "", error: `Escribe el teléfono de ${country.name} (${country.len} dígitos, sin la lada).` };
}

/**
 * Para EDITAR: de lo guardado al formulario (país + número local).
 * «5512345678» → MX; «+34612345678» → ES + «612345678». Una lada compartida
 * (+1 = EE. UU. y Rep. Dominicana) cae en el primero de la lista: el número
 * se guarda igual, solo cambia la bandera que se ve.
 */
export function splitStoredPhone(stored: string | null | undefined): { iso: string; local: string } {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!isForeignStored(raw)) return { iso: BARBER_DEFAULT_PHONE_COUNTRY, local: raw.replace(/\D/g, "") };
  const digits = raw.replace(/\D/g, "");
  const match = BARBER_PHONE_COUNTRIES.filter((c) => c.iso !== BARBER_DEFAULT_PHONE_COUNTRY && digits.startsWith(c.dial))
    .sort((a, b) => b.dial.length - a.dial.length)[0];
  return match ? { iso: match.iso, local: digits.slice(match.dial.length) } : { iso: "", local: raw };
}

/**
 * `tel:` de un teléfono guardado. Antes se armaba «tel:+52» + lo guardado,
 * que para «+34…» daba «tel:+52+34…».
 */
export function telHref(stored: string | null | undefined): string {
  const raw = typeof stored === "string" ? stored.trim() : "";
  const digits = raw.replace(/\D/g, "");
  if (isForeignStored(raw)) return `tel:+${digits}`;
  const mx = mxTenDigits(raw);
  return mx ? `tel:+52${mx}` : `tel:${digits}`;
}
