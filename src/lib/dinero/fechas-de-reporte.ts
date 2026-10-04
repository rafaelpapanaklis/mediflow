// ═══════════════════════════════════════════════════════════════════════════
// Fechas de los REPORTES que se descargan (ws1-t2, auditoría de uso C-10).
// Puro, sin Prisma (src/lib/dinero/__tests__/por-doctor.test.ts).
//
// El PDF de nómina se arma en el SERVIDOR, que no vive en la zona de la
// clínica (en Vercel es UTC; aquí, Nueva York). Con `toLocaleString("es-MX")`
// a secas, una nómina pedida el 3-oct a las 23:23 en la Ciudad de México decía
// «Generado 4 de octubre · 1:23 a.m.». Todo se formatea con la zona de la
// clínica.
// ═══════════════════════════════════════════════════════════════════════════

const ZONA_POR_DEFECTO = "America/Mexico_City";

function partes(d: Date, zona: string): { anio: number; mes: number; dia: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
  const [anio, mes, dia] = f.format(d).split("-").map((x) => parseInt(x, 10));
  return { anio, mes, dia };
}

/** "YYYY-MM-DD" del instante en la zona de la clínica (para nombres de archivo). */
export function diaEnZona(d: Date, zona: string = ZONA_POR_DEFECTO): string {
  const p = partes(d, zona);
  return `${p.anio}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/**
 * «octubre de 2026» si el rango empieza el día 1 y termina en el mismo mes
 * (en la zona de la clínica); si no, «1 sep al 30 sep 2026».
 */
export function etiquetaDePeriodo(desde: Date, hasta: Date, zona: string = ZONA_POR_DEFECTO): string {
  const a = partes(desde, zona);
  const b = partes(hasta, zona);
  if (a.dia === 1 && a.anio === b.anio && a.mes === b.mes) {
    return desde.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: zona });
  }
  const ini = desde.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: zona });
  const fin = hasta.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: zona });
  return `${ini} al ${fin}`;
}

/** «3 de octubre de 2026» en la zona de la clínica. */
export function fechaLargaEnZona(iso: string | Date, zona: string = ZONA_POR_DEFECTO): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: zona });
}

/** «3/10/2026, 11:23 p.m.» en la zona de la clínica. */
export function fechaYHoraEnZona(iso: string | Date, zona: string = ZONA_POR_DEFECTO): string {
  return new Date(iso).toLocaleString("es-MX", { timeZone: zona });
}
