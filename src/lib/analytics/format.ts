// Formatters client-safe para el panel de analítica (sin imports de servidor).

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-MX").format(Math.round(n || 0));
}

export function formatCompact(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
}

export function formatDuration(ms: number | null | undefined): string {
  const s = Math.round((ms || 0) / 1000);
  if (s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatPct(n: number | null | undefined): string {
  return `${Math.round((n || 0) * 10) / 10}%`;
}

export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 10) return "justo ahora";
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string | null | undefined): string {
  if (!code) return "Desconocido";
  if (code === "??") return "Desconocido";
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(["es"], { type: "region" });
    return regionNames.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

/** Bandera emoji desde código ISO-3166 alpha-2. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2 || code === "??") return "🏳️";
  try {
    const cc = code.toUpperCase();
    const A = 0x1f1e6;
    return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65));
  } catch {
    return "🏳️";
  }
}

export function surfaceLabel(s: string | null | undefined): string {
  switch (s) {
    case "public":
      return "Sitio web";
    case "dashboard":
      return "Panel clínica";
    case "portal":
      return "Portal paciente";
    case "affiliate":
      return "Afiliados";
    case "supplier":
      return "Proveedores";
    case "lab":
      return "Laboratorios";
    case "all":
      return "Todo";
    default:
      return s || "—";
  }
}

export function referrerTypeLabel(t: string | null | undefined): string {
  switch (t) {
    case "search":
      return "Buscadores";
    case "social":
      return "Redes sociales";
    case "ads":
      return "Publicidad";
    case "referral":
      return "Referencias";
    case "internal":
      return "Interno";
    case "direct":
      return "Directo";
    default:
      return t || "Directo";
  }
}

export function identityLabel(t: string | null | undefined): string {
  switch (t) {
    case "staff":
      return "Staff clínica";
    case "patient":
      return "Paciente";
    case "admin":
      return "Owner";
    default:
      return "Anónimo";
  }
}
