/**
 * Aritmética de fechas y títulos de periodo para la barra de herramientas.
 *
 * Todo trabaja sobre cadenas `YYYY-MM-DD`, que es lo que la agenda usa como
 * «día» (`state.dayISO`). Dos reglas que evitan los errores clásicos:
 *
 *  1. **Nada de `new Date("2026-09-02")` + `setDate()` a pelo.** Esa cadena se
 *     interpreta como medianoche UTC y en cuanto el servidor no está en UTC
 *     (o hay horario de verano por medio) el día se corre. Aquí todo se ancla
 *     al MEDIODÍA UTC, que está a 12 horas de cualquier frontera de día del
 *     planeta: sumar días nunca cruza de mes por accidente.
 *  2. **«Hoy» es hoy en la clínica**, no en el servidor. `esHoy` compara
 *     contra `todayInTz`, que pasa por `Intl` con la zona de la clínica.
 */

import { todayInTz } from "@/lib/agenda/time-utils";

const MES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const MES_CORTO = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

const DIA_LARGO = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
];

/** `YYYY-MM-DD` → un `Date` anclado al mediodía UTC de ese día. */
function alMediodia(dayISO: string): Date {
  const [y, m, d] = dayISO.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

/** Un `Date` anclado al mediodía UTC → `YYYY-MM-DD`. */
function aISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Suma (o resta) días calendario. */
export function sumarDias(dayISO: string, n: number): string {
  const d = alMediodia(dayISO);
  d.setUTCDate(d.getUTCDate() + n);
  return aISO(d);
}

/**
 * Suma (o resta) meses. El día se recorta al último del mes destino: del 31 de
 * enero, un mes adelante es el 28 (o 29) de febrero, no el 3 de marzo.
 */
export function sumarMeses(dayISO: string, n: number): string {
  const d = alMediodia(dayISO);
  const diaOriginal = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
  d.setUTCDate(Math.min(diaOriginal, ultimo));
  return aISO(d);
}

/** El lunes de la semana de `dayISO` (la semana de la agenda empieza en lunes). */
export function inicioDeSemana(dayISO: string): string {
  const d = alMediodia(dayISO);
  // getUTCDay: 0=domingo. Lo pasamos a 0=lunes … 6=domingo.
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  return sumarDias(dayISO, -desdeLunes);
}

/** El día 1 del mes de `dayISO`. */
export function inicioDeMes(dayISO: string): string {
  return `${dayISO.slice(0, 7)}-01`;
}

/** ¿`dayISO` es hoy EN LA CLÍNICA? */
export function esHoy(dayISO: string, timezone: string): boolean {
  return dayISO === todayInTz(timezone);
}

/** El número de día del mes, sin cero a la izquierda. */
export function numeroDeDia(dayISO: string): number {
  return alMediodia(dayISO).getUTCDate();
}

/** «Mié 2 sep» — el formato corto del panel de cita. */
export function fechaCorta(dayISO: string): string {
  const d = alMediodia(dayISO);
  const dia = DIA_LARGO[d.getUTCDay()].slice(0, 3);
  return `${dia} ${d.getUTCDate()} ${MES_CORTO[d.getUTCMonth()]}`;
}

/** «LUN», «MAR»… para los encabezados de Semana. */
export function diaAbreviado(dayISO: string): string {
  return DIA_LARGO[alMediodia(dayISO).getUTCDay()].slice(0, 3).toUpperCase();
}

/**
 * El título del periodo que va en la barra, según la vista:
 *   Día    → «Miércoles 2 de septiembre»
 *   Semana → «31 ago – 6 sep 2026»
 *   Mes    → «Septiembre 2026»
 */
export function tituloDePeriodo(vista: "dia" | "semana" | "mes", dayISO: string): string {
  const d = alMediodia(dayISO);

  if (vista === "dia") {
    return `${DIA_LARGO[d.getUTCDay()]} ${d.getUTCDate()} de ${MES_LARGO[d.getUTCMonth()]}`;
  }

  if (vista === "semana") {
    const lunes = alMediodia(inicioDeSemana(dayISO));
    const domingo = alMediodia(sumarDias(inicioDeSemana(dayISO), 6));
    const izq = `${lunes.getUTCDate()} ${MES_CORTO[lunes.getUTCMonth()]}`;
    const der = `${domingo.getUTCDate()} ${MES_CORTO[domingo.getUTCMonth()]}`;
    // El año va una sola vez al final, salvo que la semana cruce de año.
    if (lunes.getUTCFullYear() !== domingo.getUTCFullYear()) {
      return `${izq} ${lunes.getUTCFullYear()} – ${der} ${domingo.getUTCFullYear()}`;
    }
    return `${izq} – ${der} ${domingo.getUTCFullYear()}`;
  }

  const mes = MES_LARGO[d.getUTCMonth()];
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getUTCFullYear()}`;
}

/**
 * Cuánto mueven las flechas: ±1 día en Día, ±7 en Semana, ±1 mes en Mes.
 *
 * El prototipo no mueve el mes (solo tenía uno cargado); el propio README dice
 * que «en producción ±1 mes», y eso es lo que se hace.
 */
export function moverPeriodo(
  vista: "dia" | "semana" | "mes",
  dayISO: string,
  direccion: 1 | -1,
): string {
  if (vista === "dia") return sumarDias(dayISO, direccion);
  if (vista === "semana") return sumarDias(dayISO, 7 * direccion);
  return sumarMeses(dayISO, direccion);
}

/**
 * El rango de días que barre cada opción de «Cuándo» del panel «Buscar espacio».
 *  · `asap`    — hoy y los trece días siguientes.
 *  · `semana`  — de hoy al domingo de ESTA semana (hoy incluido).
 *  · `proxima` — el lunes al domingo SIGUIENTES.
 *
 * Vive aquí, y no junto al buscador, porque es aritmética de calendario pura:
 * así se puede probar sin levantar Prisma.
 */
export function rangoDeCuando(
  cuando: "asap" | "semana" | "proxima",
  hoyISO: string,
): { desde: string; dias: number } {
  if (cuando === "asap") return { desde: hoyISO, dias: 14 };

  // 0 = lunes … 6 = domingo, el convenio de `scheduleDayOfISO`.
  const desdeLunes = (alMediodia(hoyISO).getUTCDay() + 6) % 7;

  // Esta semana: lo que queda de hoy al domingo (un lunes son 7 días; un
  // domingo, 1 — el propio domingo).
  if (cuando === "semana") return { desde: hoyISO, dias: 7 - desdeLunes };

  return { desde: sumarDias(hoyISO, 7 - desdeLunes), dias: 7 };
}
