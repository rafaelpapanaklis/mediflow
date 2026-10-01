/**
 * `gastos` — lo que la clínica GASTÓ en un periodo: total, por categoría
 * (renta, insumos, nómina…), contra el periodo anterior y los más grandes.
 * SOLO LEE.
 *
 * ── DE DÓNDE SALE CADA COSA (nada reescrito) ───────────────────────────
 *  · La lista: `listarGastosDelPeriodo` de @/lib/gastos-periodo.server — la
 *    MISMA función que ejecuta GET /api/gastos, con `ctx.db`. Es la lista que
 *    pinta Finanzas, así que total, categorías y «los más grandes» salen de las
 *    mismas filas que la pantalla.
 *  · El periodo: `resolveFinanzasWindow` + `expenseWindowEnd` (ver
 *    ./finanzas-comun). Lo que eso implica y NO se corrige aquí: días naturales
 *    de México, y «este mes» cuenta también los gastos con fecha futura del mes.
 *  · Las categorías se agrupan por el texto EXACTO que se capturó, igual que la
 *    gráfica de Finanzas: «Renta» y «renta» son dos filas, como en la pantalla.
 *
 * ── EL PERMISO ─────────────────────────────────────────────────────────
 * `analytics.view`, el mismo de GET /api/gastos y de la pantalla de Finanzas
 * (dirección financiera: la recepción NO lo tiene por defecto).
 */

import { z } from "zod";
import { bucketKeyOf } from "@/lib/analytics/query";
import { money } from "@/lib/caja";
import { listarGastosDelPeriodo, type GastoSerializado } from "@/lib/gastos-periodo.server";
import { dbDe, definirHerramienta, fraseRecorte, lineasDeLista, pesos, pesosDeLista, plural, recortar, type Lista } from "./base";
import { esquemaPeriodo, nombreDelPeriodo, pctConSigno, variacionPct, ventanaAnterior, ventanaFinanzas } from "./finanzas-comun";
import type { SabinaCtx } from "../tipos";

export const ENLACE_FINANZAS = "/dashboard/finanzas";

const parametros = esquemaPeriodo.extend({
  categoria: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Una categoría concreta («renta», «nómina»…) para saber cuánto fue solo de esa"),
});

export type ParamsGastos = z.infer<typeof parametros>;

export interface DatosGastos {
  periodo: string;
  desde: string;
  hasta: string;
  /** Todo lo gastado en el periodo. El número de la tarjeta «Gastos» de Finanzas. */
  total: number;
  gastos: number;
  porCategoria: Lista<{ categoria: string; total: number; gastos: number; porcentaje: number }>;
  /** Los diez mayores, de mayor a menor. */
  mayores: Array<{ fecha: string; categoria: string; monto: number; nota: string | null; proveedor: string | null }>;
  comparacion: {
    periodo: string;
    desde: string;
    hasta: string;
    total: number;
    diferencia: number;
    /** `null` si el periodo anterior fue 0: no hay base. */
    variacionPct: number | null;
  };
  /** Solo si pidieron una categoría: cuánto fue de esa. */
  categoriaConsultada: {
    pedida: string;
    categorias: string[];
    total: number;
    gastos: number;
    anterior: number;
  } | null;
  /** La tabla `expenses` no existe todavía en esta base (SQL sin aplicar). */
  tablaFaltante: boolean;
  /** «este mes» incluye gastos con fecha futura del mismo mes. */
  incluyeFuturos: boolean;
  enlace: string;
}

/** Minúsculas y sin acentos, para que «nomina» encuentre «Nómina». */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function suma(filas: GastoSerializado[]): number {
  return money(filas.reduce((s, g) => s + (g.amount ?? 0), 0));
}

export const gastos = definirHerramienta<ParamsGastos, DatosGastos>({
  nombre: "gastos",
  descripcion:
    "Los gastos de la clínica en un periodo (hoy, este mes, mes anterior o un rango): total, desglose por " +
    "categoría (renta, insumos, nómina…), los gastos más grandes y la comparación con el periodo anterior. " +
    "Úsala para «¿cuánto gasté este mes?», «¿en qué se me va el dinero?», «¿cuánto fue de renta?», " +
    "«¿gasté más que el mes pasado?». Con `categoria` te dice cuánto fue solo de esa. Son los mismos " +
    "números que Finanzas → Gastos. Para ingresos contra gastos (utilidad) usa reportes.",
  parametros,
  permiso: "analytics.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosGastos> {
    const db = dbDe(ctx);
    const ahora = new Date();
    const v = ventanaFinanzas(params, ahora);
    const prev = ventanaAnterior(v, ahora);

    // 2 consultas (3 si cae al select viejo): bajo el tope de 7 por tanda.
    const [actual, anterior] = await Promise.all([
      listarGastosDelPeriodo({ clinicId: ctx.clinicId, from: v.from, expenseTo: v.expenseTo }, db),
      listarGastosDelPeriodo({ clinicId: ctx.clinicId, from: prev.from, expenseTo: prev.expenseTo }, db),
    ]);

    const filas = actual.gastos;
    const total = suma(filas);
    const totalAnterior = suma(anterior.gastos);

    const porCat = new Map<string, { total: number; n: number }>();
    for (const g of filas) {
      const c = porCat.get(g.category) ?? { total: 0, n: 0 };
      c.total += g.amount ?? 0;
      c.n += 1;
      porCat.set(g.category, c);
    }
    const categorias = Array.from(porCat.entries())
      .map(([categoria, c]) => ({
        categoria,
        total: money(c.total),
        gastos: c.n,
        porcentaje: total > 0 ? Math.round((c.total / total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const mayores = [...filas]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((g) => ({
        fecha: bucketKeyOf(new Date(g.date), "day"),
        categoria: g.category,
        monto: g.amount,
        nota: g.note ? g.note.slice(0, 80) : null,
        proveedor: g.providerName,
      }));

    let categoriaConsultada: DatosGastos["categoriaConsultada"] = null;
    if (params.categoria) {
      const buscada = normalizar(params.categoria);
      const coincide = (g: GastoSerializado) => normalizar(g.category).includes(buscada);
      const delPeriodo = filas.filter(coincide);
      categoriaConsultada = {
        pedida: params.categoria,
        categorias: Array.from(new Set(delPeriodo.map((g) => g.category))),
        total: suma(delPeriodo),
        gastos: delPeriodo.length,
        anterior: suma(anterior.gastos.filter(coincide)),
      };
    }

    return {
      periodo: v.periodo,
      desde: v.desde,
      hasta: v.hasta,
      total,
      gastos: filas.length,
      porCategoria: recortar(categorias),
      mayores,
      comparacion: {
        periodo: v.periodo === "mes" ? "mes anterior" : v.periodo === "hoy" ? "día de ayer" : "periodo anterior",
        desde: prev.desde,
        hasta: prev.hasta,
        total: totalAnterior,
        diferencia: money(total - totalAnterior),
        variacionPct: variacionPct(total, totalAnterior),
      },
      categoriaConsultada,
      tablaFaltante: actual.tablaFaltante === true,
      incluyeFuturos: v.periodo === "mes" && v.expenseTo.getTime() > ahora.getTime(),
      enlace: ENLACE_FINANZAS,
    };
  },

  // Un periodo sin gastos NI en el anterior no es una respuesta que dar con cifras.
  vacio: (d) => !d.tablaFaltante && d.gastos === 0 && d.comparacion.total === 0,

  resumir(d) {
    const ver = `[ver el detalle en Finanzas](${d.enlace})`;
    if (d.tablaFaltante) {
      return `La tabla de gastos todavía no está disponible en esta clínica, así que no puedo darte cifras. ${ver}`;
    }
    const cuando = nombreDelPeriodo(d);
    const cab = `Gastos ${cuando} (${d.desde} al ${d.hasta}): ${pesos(d.total)} en ${plural(d.gastos, "gasto", "gastos")}.`;
    const futuros = d.incluyeFuturos ? " Incluye los que ya registraste con fecha hasta fin de mes." : "";

    const dif = d.comparacion.diferencia;
    const comp =
      d.comparacion.total === 0
        ? ` En el periodo anterior (${d.comparacion.desde} al ${d.comparacion.hasta}) no hubo gastos, así que no hay con qué comparar.`
        : ` Contra el ${d.comparacion.periodo} (${d.comparacion.desde} al ${d.comparacion.hasta}), que fue ${pesos(d.comparacion.total)}: ` +
          `${dif === 0 ? "igual" : `${dif > 0 ? "+" : "−"}${pesos(Math.abs(dif))}`}` +
          `${d.comparacion.variacionPct === null ? "" : ` (${pctConSigno(d.comparacion.variacionPct)})`}.`;

    let cat = "";
    if (d.categoriaConsultada) {
      const c = d.categoriaConsultada;
      cat =
        c.gastos === 0
          ? ` De «${c.pedida}» no hay gastos en este periodo${c.anterior > 0 ? ` (en el anterior fueron ${pesos(c.anterior)})` : ""}.`
          : ` De «${c.categorias.join(", ")}»: ${pesos(c.total)} en ${plural(c.gastos, "gasto", "gastos")}` +
            `${c.anterior > 0 ? ` (en el periodo anterior, ${pesos(c.anterior)})` : ""}.`;
    }

    const fmtCat = pesosDeLista(d.porCategoria.filas.map((c) => c.total));
    const lista = d.porCategoria.filas.length >= 2
      ? `\nPor categoría${fraseRecorte(d.porCategoria, "categorías")}:` +
        lineasDeLista(d.porCategoria.filas, (c) => `${c.categoria}: ${fmtCat(c.total)} (${c.porcentaje}%, ${plural(c.gastos, "gasto", "gastos")})`)
      : d.porCategoria.filas.length === 1
        ? ` Todo es de «${d.porCategoria.filas[0].categoria}».`
        : "";

    const fmtMay = pesosDeLista(d.mayores.map((g) => g.monto));
    const mayores = d.mayores.length >= 2
      ? `\nLos más grandes:` +
        lineasDeLista(d.mayores.slice(0, 5), (g) =>
          `${g.fecha} · ${g.categoria}: ${fmtMay(g.monto)}${g.nota ? ` — ${g.nota}` : ""}${g.proveedor ? ` (${g.proveedor})` : ""}`)
      : "";

    return `${cab}${futuros}${comp}${cat}${lista}${mayores}\n${ver}`;
  },
});
