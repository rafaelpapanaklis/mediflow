/**
 * Fechas de la ficha, pintadas en el día que son.
 *
 * Por qué no se usa `formatDate` de `src/lib/utils.ts` aquí: la ficha manda
 * las fechas de cita como texto de día suelto («2026-10-09»), y `new Date()`
 * lee ese formato como MEDIANOCHE EN GREENWICH. México va detrás de
 * Greenwich, así que al pintarlo en la hora del usuario sale el día anterior:
 * la cita del 9 de octubre se lee «8 oct». Está fotografiado — la cabecera y
 * la pestaña Citas dicen «8 oct» mientras la línea de tiempo de Historia
 * clínica dice «9 oct», o sea que la ficha se contradice a sí misma.
 *
 * Aquí se parte el texto a mano y se construye la fecha en la zona del
 * navegador, que para una fecha sin hora es lo correcto. Un valor CON hora
 * (un ISO completo, que sí lleva su huso) se deja pasar tal cual.
 *
 * ⚠️ Esto arregla lo que pintan las pantallas del rediseño. El defecto de
 * `formatDate`/`fmtShortDate` sigue vivo en el resto de la ficha; no se toca
 * desde aquí porque esas funciones las comparte medio panel.
 */

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Convierte a Date respetando el día cuando el valor no trae hora. */
export function aFechaLocal(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  const m = SOLO_FECHA.exec(valor.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

/** «9 oct» */
export function fechaCorta(valor: string | Date | null | undefined, locale = "es-MX"): string {
  const d = aFechaLocal(valor);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" })
    .format(d)
    .replace(/\./g, "");
}

/** «9 oct 2026» */
export function fechaConAno(valor: string | Date | null | undefined, locale = "es-MX"): string {
  const d = aFechaLocal(valor);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" })
    .format(d)
    .replace(/\./g, "");
}

/** «9 de octubre de 2026» */
export function fechaLarga(valor: string | Date | null | undefined, locale = "es-MX"): string {
  const d = aFechaLocal(valor);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** Medianoche de hoy en la zona del navegador. */
function hoy(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Días entre una fecha y hoy. Positivo = futuro. */
export function diasHasta(valor: string | Date | null | undefined): number | null {
  const d = aFechaLocal(valor);
  if (!d) return null;
  const soloDia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((soloDia.getTime() - hoy().getTime()) / 86400000);
}
