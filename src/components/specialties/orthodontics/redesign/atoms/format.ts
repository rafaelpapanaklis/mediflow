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
 */
export function fmtDay(day: string | null | undefined): string {
  if (!day) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return fmtDateShort(day);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
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
