// Fechas que se PINTAN en pantalla, iguales en servidor y navegador (ws1-t5, F2).
//
// El problema: `new Date(x).toLocaleDateString("es-MX", …)` usa la zona del
// proceso. El servidor (Vercel/Node) corre en UTC y el navegador de la clínica en
// America/Mexico_City, así que la misma fecha sale «6 nov» en el HTML del
// servidor y «5 nov» tras hidratar (error de hidratación #418), y una fecha de
// nacimiento guardada a medianoche UTC sale UN DÍA ANTES en México.
//
// Dos casos, dos funciones, siempre con zona EXPLÍCITA:
//  · fechaCalendario — un día del calendario sin hora (fecha de nacimiento,
//    «2026-09-28», o un DateTime guardado a medianoche UTC): se pinta con sus
//    partes UTC, en cualquier zona sale el mismo día.
//  · fechaEnZona — un INSTANTE (createdAt, signedAt, completedAt…): se pinta en
//    la zona de la clínica.
export const ZONA_POR_DEFECTO = "America/Mexico_City";
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const LARGA: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

function aFecha(valor: Date | string | number | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string") {
    const m = SOLO_FECHA.exec(valor);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Día de calendario (sin hora): el mismo en cualquier zona y en servidor y cliente. */
export function fechaCalendario(
  valor: Date | string | number | null | undefined,
  opciones: Intl.DateTimeFormatOptions = LARGA,
): string {
  const d = aFecha(valor);
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", { ...opciones, timeZone: "UTC" });
}

/** Un instante, en la zona de la clínica (por defecto America/Mexico_City). */
export function fechaEnZona(
  valor: Date | string | number | null | undefined,
  zona: string | null | undefined,
  opciones: Intl.DateTimeFormatOptions = LARGA,
): string {
  if (typeof valor === "string" && SOLO_FECHA.test(valor)) return fechaCalendario(valor, opciones);
  const d = aFecha(valor);
  if (!d) return "—";
  let timeZone = zona || ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone });
  } catch {
    timeZone = ZONA_POR_DEFECTO;
  }
  return d.toLocaleDateString("es-MX", { ...opciones, timeZone });
}
