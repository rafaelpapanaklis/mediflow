// Orthodontics rediseño — helpers de formato (ES MX, sin emojis).

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("es-MX")}`;
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/**
 * Un DÍA de calendario («2026-10-05», p. ej. el vencimiento de una
 * mensualidad) sin pasar por la zona horaria: `new Date("2026-10-05")` es
 * medianoche UTC y en México se pintaba como el 4 de octubre.
 *
 * H8 (QA ws1-t9): `installedAt`/`estimatedEndDate` y otros campos que en el
 * schema son `DateTime` pero solo capturan un DÍA (un `<input type="date">`
 * convertido con `new Date(v).toISOString()`) llegan aquí como
 * "2026-07-28T00:00:00.000Z", no como "2026-07-28" a secas. El regex toma
 * solo el PREFIJO Y-M-D e ignora la hora: la colocación del 28-jul ya no
 * sale como "27 jul".
 */
function diaLocalSeguro(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtDay(day: string | null | undefined): string {
  if (!day) return "—";
  const d = diaLocalSeguro(day);
  if (!d) return fmtDateShort(day);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/** Como `fmtDay`, pero con el año — para fechas de calendario que se
 * muestran lejos unas de otras (Inicio / Fin estimado del caso). */
export function fmtDayLong(day: string | null | undefined): string {
  if (!day) return "—";
  const d = diaLocalSeguro(day);
  if (!d) return fmtDate(day);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}

export function fmtMm(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} mm`;
}

export function avatarInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function clinicalSeverityColor(pct: number): "emerald" | "amber" | "rose" {
  if (pct < 20) return "emerald";
  if (pct < 30) return "amber";
  return "rose";
}
