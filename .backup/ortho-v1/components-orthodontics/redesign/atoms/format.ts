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
