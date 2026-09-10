/**
 * Fechas de Sabina — SIEMPRE en la zona de la clínica.
 *
 * Aquí no se calcula nada nuevo: todo delega en @/lib/agenda/time-utils y
 * @/lib/agenda/date-ranges, que es donde el repo ya resolvió esto y donde están
 * los comentarios de los dos fallos que costó aprenderlo:
 *
 *  · el tablero que se vaciaba a las 18:00 — `new Date("...T00:00:00")` sin `Z`
 *    lo resuelve la zona del PROCESO, y en Vercel el proceso es UTC. Una clínica
 *    de México pedía «el 2 de septiembre» y recibía `1-sep 18:00 → 2-sep 18:00`.
 *  · los cobros que caían en el día siguiente — el mismo error, del otro lado:
 *    agrupar por la fecha UTC del pago en vez de por su fecha local.
 *
 * Por eso este módulo no tiene ni un `getHours()`, ni un `getDay()`, ni un
 * `new Date(iso)` interpretado sin zona: la hora y el día de la semana de una
 * cita salen de `getTzParts(date, tz)`, que es el único motor de husos del repo.
 */

import { z } from "zod";
import {
  calendarDayRangeUtc,
  getTzParts,
  isValidDateISO,
  periodRangeUtc,
  todayInTz,
  tzLocalToUtc,
} from "@/lib/agenda/time-utils";
import { calendarRangeUtc, formatTimeInTz } from "@/lib/agenda/date-ranges";
import { scheduleDayOfISO } from "@/lib/agenda/clinic-hours";

/** Ventana UTC `[desde, hasta)` que corresponde a un rango de días de la clínica. */
export interface Ventana {
  /** `>=` para Prisma. */
  desde: Date;
  /** `<` para Prisma — EXCLUSIVO, que es lo que no pierde la cita de las 23:59:30. */
  hasta: Date;
}

/**
 * Tope de días de un rango. No es una preferencia: una herramienta que barre
 * cinco años de citas se come el pooler y el contexto. Un año y un día cubre
 * «los últimos 12 meses» y «todo 2026» sin quedarse corto.
 */
export const MAX_DIAS_RANGO = 366;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Esquema zod de una fecha de calendario de la clínica. `YYYY-MM-DD` y nada
 * más: sin hora, porque el modelo no tiene por qué saber en qué huso está el
 * servidor, y sin `Date`, porque un instante no es un día natural.
 */
export const esquemaFecha = z
  .string()
  .regex(RE_FECHA, "la fecha va en formato YYYY-MM-DD")
  .refine((s) => isValidDateISO(s), "la fecha no se puede leer")
  .refine(existeEnElCalendario, "la fecha no existe en el calendario");

/**
 * ¿Ese día existe de verdad?
 *
 * `isValidDateISO` del repo comprueba que la cadena se pueda PARSEAR, y eso no
 * es lo mismo: `new Date("2026-02-31T00:00:00Z")` no es inválida, **rueda** al
 * 3 de marzo. Sin esta segunda vuelta, preguntarle a Sabina por «el 31 de
 * febrero» le haría contestar con las citas del 3 de marzo sin avisar de nada —
 * y un asistente que se inventa una fecha una vez no se usa más (regla 5 del
 * contrato). Se comprueba con el viaje de ida y vuelta: si los componentes
 * salen distintos de los que entraron, ese día no está en el calendario.
 */
function existeEnElCalendario(s: string): boolean {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Hoy, en el calendario de la clínica. */
export function hoyEnClinica(timezone: string): string {
  return todayInTz(timezone);
}

/** `YYYY-MM-DD` + n días, sin aritmética de husos (se arma a mediodía UTC). */
export function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Días de calendario que abarca `[desde, hasta]`, ambos inclusivos. */
export function diasDelRango(desdeISO: string, hastaISO: string): number {
  const a = Date.UTC(...(partes(desdeISO) as [number, number, number]));
  const b = Date.UTC(...(partes(hastaISO) as [number, number, number]));
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * La ventana UTC de un rango de días de la clínica. Es `calendarRangeUtc` del
 * módulo de agenda —el mismo que usan la vista Día/Semana/Mes y
 * `/api/agenda/range`— con el fin ya expresado como `<` exclusivo.
 */
export function ventanaDeRango(desdeISO: string, hastaISO: string, timezone: string): Ventana {
  const r = calendarRangeUtc(desdeISO, hastaISO, timezone);
  return { desde: r.fromUtc, hasta: r.toUtc };
}

/** La ventana UTC de UN día natural de la clínica (00:00 → 00:00 del siguiente). */
export function ventanaDelDia(fechaISO: string, timezone: string): Ventana {
  const r = calendarDayRangeUtc(fechaISO, timezone);
  return { desde: r.startUtc, hasta: r.endUtc };
}

/** La ventana UTC del MES en curso de la clínica. `periodRangeUtc("month")`. */
export function ventanaDelMes(timezone: string, ahora: Date = new Date()): Ventana {
  const { from, to } = periodRangeUtc("month", timezone, ahora);
  return { desde: from, hasta: to };
}

/** El instante de las 00:00 de hoy en la clínica — el «inicio de hoy» de los vencidos. */
export function inicioDeHoy(timezone: string, ahora: Date = new Date()): Date {
  return tzLocalToUtc(todayInTz(timezone), 0, 0, timezone);
}

/** Día de la semana de una fecha de la clínica: 0=Lunes … 6=Domingo. */
export function diaSemana(fechaISO: string, timezone: string): number {
  return scheduleDayOfISO(fechaISO, timezone);
}

/** Día de la semana de un INSTANTE, visto en la clínica: 0=Lunes … 6=Domingo. */
export function diaSemanaDe(instante: Date, timezone: string): number {
  const p = getTzParts(instante, timezone);
  // getTzParts.weekday viene Dom=0 … Sáb=6; la convención de ClinicSchedule y
  // de la vista Semana es Lun=0 … Dom=6.
  return (p.weekday + 6) % 7;
}

/** `YYYY-MM-DD` del día de la clínica al que pertenece un instante. */
export function fechaDe(instante: Date, timezone: string): string {
  const p = getTzParts(instante, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `HH:mm` de un instante en la zona de la clínica. Única fuente del repo. */
export function horaDe(instante: Date, timezone: string): string {
  return formatTimeInTz(instante.toISOString(), timezone);
}

export const NOMBRES_DIA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

export type Agrupacion = "dia" | "semana" | "mes";

/**
 * Clave del bucket al que cae un instante, en la zona de la clínica. Misma
 * construcción que `bucketKeyFor` de @/lib/home/revenue-buckets (día natural
 * local, no UTC); la semana se etiqueta con su LUNES, que es la convención de
 * semana ISO de la agenda y de la gráfica del home.
 */
export function claveBucket(instante: Date, timezone: string, agrupar: Agrupacion): string {
  const p = getTzParts(instante, timezone);
  if (agrupar === "mes") return `${p.year}-${pad(p.month)}`;
  const fecha = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  if (agrupar === "dia") return fecha;
  return sumarDias(fecha, -((p.weekday + 6) % 7)); // lunes de esa semana
}

/** Todas las claves de bucket de `[desde, hasta]`, para rellenar huecos con 0. */
export function clavesDelRango(
  desdeISO: string,
  hastaISO: string,
  timezone: string,
  agrupar: Agrupacion,
): string[] {
  const out: string[] = [];
  const vistas: Record<string, true> = {};
  const total = diasDelRango(desdeISO, hastaISO);
  for (let i = 0; i < total; i++) {
    const dia = sumarDias(desdeISO, i);
    // Mediodía local: no cae en el borde de un cambio de horario.
    const k = claveBucket(tzLocalToUtc(dia, 12, 0, timezone), timezone, agrupar);
    if (!vistas[k]) {
      vistas[k] = true;
      out.push(k);
    }
  }
  return out;
}

function partes(fechaISO: string): number[] {
  const [y, m, d] = fechaISO.split("-").map((n) => parseInt(n, 10));
  return [y, m - 1, d];
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Los dos parámetros de rango que comparten media docena de herramientas.
 * Opcionales a propósito: el modelo pregunta muchas veces «¿cómo van mis
 * ingresos?» sin decir desde cuándo, y eso tiene una respuesta razonable.
 */
export const esquemaRango = z.object({
  /** Primer día del rango, inclusivo. Sin él, `diasPorDefecto` hacia atrás. */
  desde: esquemaFecha.optional(),
  /** Último día del rango, inclusivo. Sin él, hoy. */
  hasta: esquemaFecha.optional(),
});

export type ParamsRango = z.infer<typeof esquemaRango>;

export interface Rango {
  desdeISO: string;
  hastaISO: string;
  dias: number;
  ventana: Ventana;
}

/**
 * Resuelve `{desde, hasta}` a un rango cerrado de días de la clínica y su
 * ventana UTC. Lanza —y el runner lo convierte en `error` con su detalle— si el
 * rango está al revés o si pasa de `MAX_DIAS_RANGO`: es mejor que Sabina diga
 * «pídemelo por meses» que que se coma el pooler y contradiga a la pantalla con
 * un número recortado a medias.
 */
export function resolverRango(
  params: ParamsRango,
  timezone: string,
  diasPorDefecto = 30,
): Rango {
  const hastaISO = params.hasta ?? hoyEnClinica(timezone);
  const desdeISO = params.desde ?? sumarDias(hastaISO, -(diasPorDefecto - 1));
  const dias = diasDelRango(desdeISO, hastaISO);
  if (dias <= 0) {
    throw new Error(`rango_invalido: "desde" (${desdeISO}) es posterior a "hasta" (${hastaISO})`);
  }
  if (dias > MAX_DIAS_RANGO) {
    throw new Error(
      `rango_demasiado_grande: ${dias} días (el tope es ${MAX_DIAS_RANGO}); pídelo por trozos más cortos`,
    );
  }
  return { desdeISO, hastaISO, dias, ventana: ventanaDeRango(desdeISO, hastaISO, timezone) };
}
