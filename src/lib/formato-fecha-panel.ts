// N-61 (ws1-t8, segunda auditoría de uso): el panel decía fechas y horas en
// cinco formatos («03-oct, 11:45 p.m.», «03 oct 2026, 23:50», «3 de octubre de
// 2026», «28 sep»…). Este es EL formato del panel (decisión 12, criterio
// conservador: el de 12 h de es-MX, que ya usa la mayoría de las pantallas):
//   fecha       → «3 oct 2026»
//   fecha+hora  → «3 oct 2026, 11:45 p.m.»
// En la zona de la clínica cuando se conoce (si no, la del navegador).

const ESPACIOS_RAROS = /[  ]/g;

function zonaOk(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

function aFecha(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fechaPanel(v: string | Date, tz?: string | null, locale: string = "es"): string {
  const d = aFecha(v);
  if (!d) return typeof v === "string" ? v : "";
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-US" : "es-MX", {
    day: "numeric", month: "short", year: "numeric", timeZone: zonaOk(tz),
  }).format(d).replace(/\./g, "").replace(ESPACIOS_RAROS, " ");
}

export function fechaHoraPanel(v: string | Date, tz?: string | null, locale: string = "es"): string {
  const d = aFecha(v);
  if (!d) return typeof v === "string" ? v : "";
  const hora = new Intl.DateTimeFormat(locale.startsWith("en") ? "en-US" : "es-MX", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: zonaOk(tz),
  }).format(d).replace(ESPACIOS_RAROS, " ");
  return `${fechaPanel(d, tz, locale)}, ${hora}`;
}
