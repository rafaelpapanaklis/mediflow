/**
 * Lo que comparten `gastos` y `reportes`: el PERIODO de Finanzas.
 *
 * ── LA VENTANA ES LA DE LA PANTALLA, LITERAL ───────────────────────────
 * `resolveFinanzasWindow` y `expenseWindowEnd` de @/lib/finanzas-periodo, las
 * mismas dos funciones que usan /api/finanzas y /api/gastos. Eso trae, a
 * propósito, dos rarezas de la pantalla que Sabina NO corrige por su cuenta (si
 * el número de Sabina no cuadra con el de Finanzas, el fallo es de Sabina):
 *
 *  · los días son los naturales de México (UTC−6 fijo), también para una
 *    clínica en otra zona;
 *  · «este mes» corta los cobros en AHORA, pero los gastos llegan al FIN del mes
 *    (la renta del 30 registrada el 5 ya cuenta).
 *
 * Los periodos son los del selector de Finanzas: hoy, este mes, mes anterior y
 * un rango. Nada de «el trimestre»: si la pantalla no lo tiene, se pide por
 * rango (`custom`) y se suma por tramos.
 */

import { z } from "zod";
import { bucketKeyOf } from "@/lib/analytics/query";
import { expenseWindowEnd, resolveFinanzasWindow, startOfMonthMx, startOfTodayMx } from "@/lib/finanzas-periodo";
import { pesos } from "./base";
import { esquemaFecha } from "./fechas";

export const PERIODOS = ["hoy", "mes", "mes_anterior", "custom"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const esquemaPeriodo = z.object({
  periodo: z
    .enum(PERIODOS)
    .optional()
    .describe("hoy | mes (este mes, default) | mes_anterior | custom (con desde y hasta)"),
  desde: esquemaFecha.optional().describe("Solo con periodo=custom: primer día, YYYY-MM-DD"),
  hasta: esquemaFecha.optional().describe("Solo con periodo=custom: último día, YYYY-MM-DD"),
});

export type ParamsPeriodo = z.infer<typeof esquemaPeriodo>;

/** Un periodo ya resuelto, con las fechas que se le enseñan a quien pregunta. */
export interface VentanaFinanzas {
  periodo: Periodo;
  from: Date;
  to: Date;
  /** Hasta dónde llegan los GASTOS (fin del mes en «mes»; `to` en los demás). */
  expenseTo: Date;
  /** Día natural de México, YYYY-MM-DD. */
  desde: string;
  /** Idem. En «mes» es el último día del mes: es hasta donde llegan los gastos. */
  hasta: string;
}

function ventana(periodo: Periodo, from: Date, to: Date, ahora: Date): VentanaFinanzas {
  const expenseTo = expenseWindowEnd(periodo, ahora, to);
  return {
    periodo,
    from,
    to,
    expenseTo,
    desde: bucketKeyOf(from, "day"),
    hasta: bucketKeyOf(expenseTo, "day"),
  };
}

/** El periodo pedido, tal como lo resuelve /api/finanzas. Lanza si `custom` viene incompleto o al revés. */
export function ventanaFinanzas(params: ParamsPeriodo, ahora: Date = new Date()): VentanaFinanzas {
  const periodo: Periodo = params.periodo ?? "mes";
  if (periodo === "custom" && (!params.desde || !params.hasta)) {
    throw new Error("rango_invalido: periodo=custom necesita desde y hasta (YYYY-MM-DD)");
  }
  const sp = new URLSearchParams({ period: periodo });
  if (params.desde) sp.set("from", params.desde);
  if (params.hasta) sp.set("to", params.hasta);
  const win = resolveFinanzasWindow(sp, ahora);
  if ("error" in win) throw new Error(`rango_invalido: ${win.error}`);
  return ventana(periodo, win.from, win.to, ahora);
}

/**
 * El periodo con el que se compara: el inmediato anterior del MISMO tipo.
 *
 *  · mes → el mes anterior completo;  mes_anterior → el de antes de ese;
 *  · hoy → ayer;  custom → el tramo de igual tamaño que termina justo antes.
 *
 * Para «mes» se compara el mes en curso (con los gastos que ya tiene
 * registrados hasta fin de mes) contra el anterior entero, que es lo que ven
 * Finanzas y Gastos al cambiar el selector.
 */
export function ventanaAnterior(actual: VentanaFinanzas, ahora: Date = new Date()): VentanaFinanzas {
  if (actual.periodo === "mes") {
    const inicio = startOfMonthMx(ahora, 0);
    return ventana("mes_anterior", startOfMonthMx(ahora, -1), new Date(inicio.getTime() - 1), ahora);
  }
  if (actual.periodo === "mes_anterior") {
    const inicio = startOfMonthMx(ahora, -1);
    return ventana("mes_anterior", startOfMonthMx(ahora, -2), new Date(inicio.getTime() - 1), ahora);
  }
  if (actual.periodo === "hoy") {
    const hoy = startOfTodayMx(ahora);
    const ayer = new Date(hoy.getTime() - 86_400_000);
    return ventana("custom", ayer, new Date(hoy.getTime() - 1), ahora);
  }
  // custom: [from, to] → el tramo de la misma duración inmediatamente antes.
  const dur = actual.to.getTime() - actual.from.getTime() + 1;
  return ventana("custom", new Date(actual.from.getTime() - dur), new Date(actual.from.getTime() - 1), ahora);
}

/** «+12%» / «−5%» / «sin base de comparación» — y `null` cuando antes fue 0. */
export function variacionPct(actual: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

/** «+24%» / «−5%» / «0%»: el signo SIEMPRE (el menos tipográfico, igual que los importes). */
export function pctConSigno(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`;
}

/** «$1,200» / «−$500»: el menos delante del signo de pesos, no «$-500». */
export function pesosConSigno(n: number): string {
  return n < 0 ? `−${pesos(-n)}` : pesos(n);
}

/** Margen en %: «75%» / «−25%». */
export function pctMargen(n: number): string {
  return `${n < 0 ? "−" : ""}${Math.abs(n)}%`;
}

/** El nombre del periodo para una frase: «este mes», «el mes anterior», «del 1 al 15 de ...». */
export function nombreDelPeriodo(v: { periodo: string; desde: string; hasta: string }): string {
  if (v.periodo === "mes") return "este mes";
  if (v.periodo === "mes_anterior") return "el mes anterior";
  if (v.periodo === "hoy") return "hoy";
  return `del ${v.desde} al ${v.hasta}`;
}
