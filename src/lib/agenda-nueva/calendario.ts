/**
 * EL CALENDARIO DE LAS VISTAS SEMANA Y MES (WS1-T2) — aritmética de fechas,
 * sin React y sin pintar nada.
 *
 * Una regla y de ella salen las demás: **la rejilla que se pinta tiene que ser
 * exactamente la que se pidió a la API**. El rango lo decide
 * `viewRangeUtc` (`src/lib/agenda/date-ranges.ts`), que es la única fuente de
 * verdad de rangos de toda la agenda; si aquí calculáramos los días por
 * nuestra cuenta y nos separáramos por un día, el Mes pintaría una celda cuyas
 * citas nadie pidió —saldría vacía— y el contador diría otra cosa. Es el bug
 * histórico que ese archivo documenta. Así que estas funciones repiten su
 * aritmética al pie de la letra: mes = rejilla de 42 días que arranca el lunes
 * de la semana del día 1; semana = lunes a domingo.
 *
 * Todo se hace sobre la cadena `YYYY-MM-DD` con `Date.UTC`. No es un descuido
 * de zona horaria: una fecha de calendario tiene un día de la semana fijo, así
 * que hacer la cuenta en UTC da el mismo resultado en Ciudad de México que en
 * el runtime de Vercel. La zona horaria de la clínica solo hace falta para
 * saber a QUÉ día calendario pertenece una cita —`calendarDayISO`— y para
 * saber cuál es hoy —`todayInTz`—, y para eso se usan los helpers de siempre.
 */

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoDeUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Suma días de calendario a un `YYYY-MM-DD`. */
export function sumaDias(dayISO: string, dias: number): string {
  const [y, m, d] = dayISO.split("-").map((n) => parseInt(n, 10));
  return isoDeUtc(new Date(Date.UTC(y!, m! - 1, d! + dias)));
}

/** Día de la semana con Lunes=0 … Domingo=6 (la convención de `ClinicSchedule`). */
export function diaDeLaSemana(dayISO: string): number {
  const [y, m, d] = dayISO.split("-").map((n) => parseInt(n, 10));
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

export interface DiaSemana {
  iso: string;
  /** Número del día del mes (el del círculo de la cabecera). */
  numero: number;
  /** Lunes=0 … Domingo=6. */
  dow: number;
  /** «LUN», «MAR»… ya en mayúsculas, como la cabecera del diseño. */
  abreviatura: string;
}

const ABREVIATURAS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"] as const;
export const ABREVIATURAS_SEMANA: readonly string[] = ABREVIATURAS;

/**
 * Los siete días de la semana que contiene `dayISO`, de lunes a domingo.
 * Mismo lunes que elige `viewRangeUtc("week", …)`.
 */
export function diasDeLaSemana(dayISO: string): DiaSemana[] {
  const lunes = sumaDias(dayISO, -diaDeLaSemana(dayISO));
  const dias: DiaSemana[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = sumaDias(lunes, i);
    dias.push({
      iso,
      numero: parseInt(iso.slice(8, 10), 10),
      dow: i,
      abreviatura: ABREVIATURAS[i]!,
    });
  }
  return dias;
}

export interface CeldaMes {
  iso: string;
  numero: number;
  dow: number;
  /** El día pertenece a otro mes (la cola de agosto o la de octubre). */
  fuera: boolean;
}

/**
 * La rejilla del mes que contiene `dayISO`: 42 celdas (6×7) arrancando el
 * lunes de la semana del día 1. Idéntica al rango que pide `viewRangeUtc`.
 */
export function rejillaDelMes(dayISO: string): CeldaMes[] {
  const [y, m] = dayISO.split("-").map((n) => parseInt(n, 10));
  const primero = `${y}-${pad2(m!)}-01`;
  const inicio = sumaDias(primero, -diaDeLaSemana(primero));
  const celdas: CeldaMes[] = [];
  for (let i = 0; i < 42; i++) {
    const iso = sumaDias(inicio, i);
    celdas.push({
      iso,
      numero: parseInt(iso.slice(8, 10), 10),
      dow: i % 7,
      fuera: parseInt(iso.slice(5, 7), 10) !== m,
    });
  }
  return celdas;
}

/**
 * Las 42 celdas partidas en filas de 7, **quitando las filas que no tocan el
 * mes**. Septiembre de 2026 ocupa cinco filas (empieza en martes y tiene 30
 * días): la sexta sería octubre entero y en el diseño no existe —el prototipo
 * dibuja 7×5—. Dejarla pintaría una fila de celdas apagadas que solo sirve
 * para achatar las otras cinco. Los meses que de verdad necesitan seis filas
 * las tienen; no se recorta nada del mes.
 *
 * Las citas del rango siguen llegando completas (la API pide siempre 42 días):
 * esto es solo lo que se DIBUJA.
 */
export function filasDelMes(dayISO: string): CeldaMes[][] {
  const celdas = rejillaDelMes(dayISO);
  const filas: CeldaMes[][] = [];
  for (let i = 0; i < celdas.length; i += 7) filas.push(celdas.slice(i, i + 7));
  return filas.filter((fila) => fila.some((c) => !c.fuera));
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
] as const;

/** «Septiembre 2026» — el título de periodo de la vista Mes. */
export function tituloDelMes(dayISO: string): string {
  const [y, m] = dayISO.split("-").map((n) => parseInt(n, 10));
  const nombre = MESES[m! - 1]!;
  return `${nombre[0]!.toUpperCase()}${nombre.slice(1)} ${y}`;
}

/**
 * «31 ago – 6 sep 2026» — el título de periodo de la vista Semana. El mes solo
 * se repite cuando la semana cambia de mes, y el año va una vez al final,
 * igual que en el diseño.
 */
export function tituloDeLaSemana(dayISO: string): string {
  const dias = diasDeLaSemana(dayISO);
  const lunes = dias[0]!;
  const domingo = dias[6]!;
  const mesLunes = parseInt(lunes.iso.slice(5, 7), 10);
  const mesDomingo = parseInt(domingo.iso.slice(5, 7), 10);
  const anioDomingo = domingo.iso.slice(0, 4);
  const izq =
    mesLunes === mesDomingo
      ? `${lunes.numero}`
      : `${lunes.numero} ${MESES_CORTOS[mesLunes - 1]!}`;
  return `${izq} – ${domingo.numero} ${MESES_CORTOS[mesDomingo - 1]!} ${anioDomingo}`;
}
