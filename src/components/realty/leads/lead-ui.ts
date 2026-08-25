// ═══════════════════════════════════════════════════════════════════════
// Helpers PUROS de la UI de prospectos + el CSS del área.
//
// Vive en components/ (y no en lib/realty/leads.ts) a propósito: leads.ts
// importa prisma y un componente "use client" que lo importara metería el
// cliente de Prisma en el bundle del navegador. Aquí no hay una sola
// importación de servidor.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyLeadStage } from "@/lib/realty/types";

// ── Semáforo: cuánto lleva sin contacto ─────────────────────────────────

export type RealtyContactHeat = "VERDE" | "AMARILLO" | "ROJO" | "NEUTRO";

export interface RealtyHeatInfo {
  heat: RealtyContactHeat;
  /** Minutos desde el último contacto (o desde que entró, si nunca). */
  minutes: number;
  /** true = NADIE le ha hablado nunca. Es el caso que más duele. */
  neverContacted: boolean;
}

/** Verde menos de 1 h, amarillo menos de 24 h, rojo de ahí en adelante. */
export const HEAT_GREEN_MINUTES = 60;
export const HEAT_YELLOW_MINUTES = 60 * 24;

/**
 * El semáforo de la tarjeta.
 *
 * La referencia es el último CONTACTO real (llamada, WhatsApp, correo o
 * visita). Si nunca hubo, se mide desde que el prospecto ENTRÓ — que es
 * justo el reloj que importa: un prospecto de hace tres días al que nadie
 * le ha marcado no está "en verde", está perdido.
 *
 * Un prospecto CERRADO o PERDIDO sale NEUTRO: ya no hay nada que correr.
 */
export function contactHeat(
  lead: {
    stage: RealtyLeadStage;
    lastContactAt: string | null;
    firstResponseAt: string | null;
    createdAt: string;
  },
  nowMs: number,
): RealtyHeatInfo {
  if (lead.stage === "CIERRE" || lead.stage === "PERDIDO") {
    return { heat: "NEUTRO", minutes: 0, neverContacted: false };
  }
  const ref = lead.lastContactAt ?? lead.firstResponseAt ?? lead.createdAt;
  const refMs = Date.parse(ref);
  const minutes = Number.isFinite(refMs) ? Math.max(0, Math.floor((nowMs - refMs) / 60_000)) : 0;
  const neverContacted = !lead.lastContactAt && !lead.firstResponseAt;
  const heat: RealtyContactHeat =
    minutes < HEAT_GREEN_MINUTES ? "VERDE" : minutes < HEAT_YELLOW_MINUTES ? "AMARILLO" : "ROJO";
  return { heat, minutes, neverContacted };
}

export const HEAT_COLORS: Record<RealtyContactHeat, { dot: string; text: string; bg: string }> = {
  // Verde y rojo NO son los del tema (pino): tienen que leerse como
  // semáforo, no como marca. El amarillo va oscuro para pasar contraste.
  VERDE: { dot: "#2E7D32", text: "#1B5E20", bg: "rgba(46, 125, 50, 0.10)" },
  AMARILLO: { dot: "#B26A00", text: "#8A5200", bg: "rgba(178, 106, 0, 0.12)" },
  ROJO: { dot: "#C62828", text: "#B3261E", bg: "rgba(198, 40, 40, 0.12)" },
  NEUTRO: { dot: "var(--text-4)", text: "var(--text-3)", bg: "transparent" },
};

/** "45 min", "6 h", "3 d" — la unidad más grande que ya se alcanzó. */
export function heatLabel(
  info: RealtyHeatInfo,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (info.heat === "NEUTRO") return t("heat.closed");
  if (info.minutes < 60) return t("heat.sinceMinutes", { value: info.minutes });
  if (info.minutes < 60 * 48) return t("heat.sinceHours", { value: Math.floor(info.minutes / 60) });
  return t("heat.sinceDays", { value: Math.floor(info.minutes / (60 * 24)) });
}

// ── Formatos ────────────────────────────────────────────────────────────

/** Pesos sin centavos. Los millones se abrevian: en una tarjeta de 260 px
 *  "$2,150,000" se come la línea entera. */
export function money(n: number | null | undefined, currency = "MXN"): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) {
    const millones = n / 1_000_000;
    const texto = millones >= 10 ? millones.toFixed(1) : millones.toFixed(2);
    return `$${texto.replace(/\.?0+$/, "")} M${currency === "USD" ? " USD" : ""}`;
  }
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export function budgetRange(min: number | null, max: number | null, empty: string): string {
  if (min == null && max == null) return empty;
  if (min != null && max != null) return `${money(min)} – ${money(max)}`;
  if (max != null) return `Hasta ${money(max)}`;
  return `Desde ${money(min)}`;
}

/** Teléfono a 10 dígitos → "33 1234 5678". */
export function prettyPhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length !== 10) return phone;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

export function shortDate(iso: string | null, locale = "es-MX"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

export function dateTime(iso: string | null, locale = "es-MX"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Iniciales para el avatar del asesor. */
export function initials(name: string | null): string {
  if (!name) return "—";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Fuente legible: "portal:inmuebles24" → "Inmuebles24". */
export function sourceLabel(source: string | null, portal: string | null): string | null {
  const raw = portal ?? source;
  if (!raw) return null;
  const clean = raw.replace(/^portal:/, "");
  const known: Record<string, string> = {
    inmuebles24: "Inmuebles24",
    lamudi: "Lamudi",
    vivanuncios: "Vivanuncios",
    mercadolibre: "Mercado Libre",
    casasyterrenos: "Casas y Terrenos",
    propiedades: "Propiedades.com",
    generico: "Otro portal",
    manual: "Alta a mano",
    web: "Mi web",
  };
  return known[clean] ?? clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ── Tono → color (los mismos seis del contrato) ─────────────────────────

export type RealtyTone = "info" | "brand" | "warning" | "success" | "danger" | "neutral";

export const TONE_COLORS: Record<RealtyTone, { fg: string; bg: string; border: string }> = {
  info: { fg: "#1B5E8A", bg: "rgba(27, 94, 138, 0.10)", border: "rgba(27, 94, 138, 0.30)" },
  brand: { fg: "var(--pine-700)", bg: "var(--brand-soft)", border: "var(--border-brand)" },
  warning: { fg: "#8A5200", bg: "rgba(178, 106, 0, 0.12)", border: "rgba(178, 106, 0, 0.30)" },
  success: { fg: "#1B5E20", bg: "rgba(46, 125, 50, 0.12)", border: "rgba(46, 125, 50, 0.30)" },
  danger: { fg: "#B3261E", bg: "rgba(198, 40, 40, 0.12)", border: "rgba(198, 40, 40, 0.30)" },
  neutral: { fg: "var(--text-2)", bg: "var(--bg-elev-2)", border: "var(--border-soft)" },
};

// ═══════════════════════════════════════════════════════════════════════
// CSS del área.
//
// Va en un <style> porque las CONSULTAS DE CONTENEDOR no se pueden escribir
// inline, y la regla del repo es @container (no @media). El contenedor lo
// declara `.realty-page` en realty-theme.css (container-name: realty).
//
// ⚠️ container-type ATRAPA position:fixed. Por eso los diálogos de esta
// área se pintan FUERA de `.realty-page`, como hermanos, no dentro.
//
// Medidas en px, no rem: la raíz del panel mide 13px.
// ═══════════════════════════════════════════════════════════════════════
export const LEADS_CSS = `
.lead-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.lead-toolbar__grow { flex: 1 1 220px; min-width: 180px; }

.lead-kpis { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@container realty (min-width: 720px) {
  .lead-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.lead-filters { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@container realty (min-width: 640px) {
  .lead-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@container realty (min-width: 1000px) {
  .lead-filters { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}

/* Tablero: carril horizontal. Las columnas NO se encogen para que una
   etapa llena no aplaste a las demás. */
.lead-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 10px;
  scroll-snap-type: x proximity;
}
.lead-col {
  flex: 0 0 264px;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 10px;
  min-height: 180px;
}
@container realty (min-width: 1280px) {
  .lead-col { flex: 0 0 286px; }
}
.lead-col--over {
  border-color: var(--brand);
  background: var(--brand-softer);
  box-shadow: var(--ring);
}
.lead-col--blocked { border-color: rgba(198, 40, 40, 0.5); background: rgba(198, 40, 40, 0.06); }
.lead-col__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lead-col__stack { display: flex; flex-direction: column; gap: 8px; min-height: 40px; }

.lead-card {
  background: var(--bg-elev);
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--border-soft);
  border-radius: 12px;
  padding: 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  box-shadow: var(--shadow-1);
  cursor: grab;
  text-align: left;
  width: 100%;
  transition: box-shadow 150ms ease, transform 150ms ease;
}
.lead-card:hover { box-shadow: var(--shadow-2); }
.lead-card:focus-visible { outline: none; box-shadow: var(--ring); }
.lead-card--dragging { opacity: 0.45; cursor: grabbing; }

.lead-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600; line-height: 1.6;
  border: 1px solid transparent; white-space: nowrap;
}

.lead-table-wrap { overflow-x: auto; border: 1px solid var(--border-soft); border-radius: 14px; background: var(--bg-elev); }
.lead-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
.lead-table th {
  text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3);
  border-bottom: 1px solid var(--border-soft); white-space: nowrap;
}
.lead-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
.lead-table tbody tr:last-child td { border-bottom: none; }
.lead-table tbody tr:hover { background: var(--bg-hover); }

.lead-field { display: flex; flex-direction: column; gap: 5px; }
.lead-label { font-size: 11.5px; font-weight: 700; color: var(--text-2); letter-spacing: 0.01em; }
.lead-input, .lead-select, .lead-textarea {
  width: 100%; padding: 8px 10px; font-size: 13px; font-family: inherit;
  color: var(--text-1); background: var(--bg-elev);
  border: 1px solid var(--border-strong); border-radius: 9px;
}
.lead-input:focus, .lead-select:focus, .lead-textarea:focus { outline: none; box-shadow: var(--ring); border-color: var(--brand); }
.lead-textarea { min-height: 74px; resize: vertical; }
.lead-help { font-size: 11.5px; color: var(--text-3); line-height: 1.5; }

.lead-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 13px; border-radius: 10px; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; border: 1px solid var(--border-strong);
  background: var(--bg-elev); color: var(--text-1); white-space: nowrap;
}
.lead-btn:hover { background: var(--bg-hover); }
.lead-btn:focus-visible { outline: none; box-shadow: var(--ring); }
.lead-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
.lead-btn--sm { padding: 5px 9px; font-size: 12px; border-radius: 8px; }
.lead-btn--ghost { border-color: transparent; background: transparent; }
.lead-btn--danger { color: var(--danger); border-color: rgba(198, 40, 40, 0.35); }

.lead-panel {
  background: var(--bg-elev); border: 1px solid var(--border-soft);
  border-radius: 14px; padding: 14px 15px; box-shadow: var(--shadow-1);
}
.lead-panel__title { font-size: 13px; font-weight: 700; color: var(--text-1); margin: 0 0 3px; }

.lead-detail { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); align-items: start; }
@container realty (min-width: 960px) {
  .lead-detail { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }
}

.lead-timeline { display: flex; flex-direction: column; gap: 0; }
.lead-timeline__row { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 9px; }
.lead-timeline__rail { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.lead-timeline__line { flex: 1; width: 2px; background: var(--border-soft); min-height: 12px; }
.lead-timeline__body { padding-bottom: 14px; min-width: 0; }

/* Diálogo. Vive FUERA de .realty-page: un ancestro con container-type
   convertiría este fixed en absolute y el modal se iría con el scroll. */
.lead-dialog__overlay {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(20, 32, 26, 0.55);
  display: grid; place-items: center; padding: 16px;
  overflow-y: auto;
}
.lead-dialog {
  width: 100%; max-width: 560px; max-height: calc(100vh - 32px); overflow-y: auto;
  background: var(--bg-elev); color: var(--text-1);
  border: 1px solid var(--border-soft); border-radius: 16px;
  box-shadow: var(--shadow-3); padding: 18px;
  display: flex; flex-direction: column; gap: 13px;
}
.lead-dialog--wide { max-width: 720px; }
.lead-dialog__grid { display: grid; gap: 11px; grid-template-columns: repeat(2, minmax(0, 1fr)); }

.lead-scroll-x { overflow-x: auto; }
.lead-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lead-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .lead-card { transition: none; }
}
`;
