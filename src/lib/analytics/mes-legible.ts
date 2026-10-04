// Formatos legibles de la Analítica (ws1-t2, auditoría de uso C-25 y C-37).
// Puro y sin imports de servidor: lo usan las pantallas de cliente.
//
// La retención por cohorte enseñaba «2026-09» y Reportes «may 26»: claves y
// abreviaturas, no fechas para una persona. Aquí se dicen como «sep 2026».

/** «2026-09» → «sep 2026» (en inglés, «Sep 2026»). Una clave que no sea AAAA-MM se devuelve tal cual. */
export function mesLegible(clave: string, idioma: "es" | "en" = "es"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave);
  if (!m) return clave;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15, 12));
  return d
    .toLocaleDateString(idioma === "en" ? "en-US" : "es-MX", { month: "short", year: "numeric", timeZone: "UTC" })
    .replace(".", "");
}

/** Minutos enteros entre `iso` y `ahora` (0 si `iso` falta o es del futuro). */
export function minutosDesde(iso: string | null | undefined, ahora: Date = new Date()): number {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 60_000));
}

/**
 * La hora del día (0-23) y el día de la semana (0 = lunes) de un instante en la
 * zona de la CLÍNICA (ws1-t2, auditoría de uso N-20). Con `getHours()` a secas
 * salía la hora del SERVIDOR (UTC en Vercel, Nueva York aquí): una cita de las
 * 13:00 en la Ciudad de México se contaba a las 19:00 o a las 15:00.
 */
export function horaYDiaEnZona(d: Date, zona: string): { hora: number; dia: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(d);
  const hora = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
  const dias = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dia = Math.max(0, dias.indexOf(p.find((x) => x.type === "weekday")?.value ?? "Mon"));
  return { hora, dia };
}

/** «13:00», «09:00»: la hora con dos cifras y en 24 h, como los mapas de calor (antes «1:00» se leía como la 1 de la madrugada). */
export function horaLegible(h: number): string {
  return `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
}
