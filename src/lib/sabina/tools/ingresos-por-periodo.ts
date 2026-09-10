/**
 * `ingresos_por_periodo` — el dinero que ENTRÓ, agrupado por día, semana o mes.
 *
 * ── EL CRITERIO ES EL DEL REPO, LITERAL ────────────────────────────────
 * `revenuePaymentWhere` y `refundPaymentWhere` de @/lib/caja, y el neto con
 * `netRevenueSeries`. No se reescribe ni un filtro:
 *
 *  · el tenant se aísla por `invoice.clinicId` — `Payment` no tiene clinicId;
 *  · fuera las facturas CANCELADAS;
 *  · fuera las filas de método "refund", que se guardan con monto POSITIVO y
 *    sin ese filtro se SUMAN como cobro;
 *  · y el NETO resta los reembolsos, porque excluir la fila del reembolso no
 *    basta: el pago original sigue contando. Un paciente que paga $10,000 el 5 y
 *    se le devuelve todo el 20 dejaba el mes en "$10,000" — y sobre ese número
 *    se pagan comisiones y se decide la nómina (hallazgo 12 del repo).
 *
 * ── LOS DOS NÚMEROS, Y POR QUÉ VAN LOS DOS ─────────────────────────────
 * `ingresosNetos` (cobros − reembolsos) es el de Finanzas. `ingresosBrutos`
 * (solo cobros) es el que sigue enseñando la tarjeta "Ingresos del mes" del home
 * del administrador, que no resta lo devuelto. Devolver los dos, con el nombre
 * de cada uno, es lo único honesto: si Sabina diera uno solo, contradiría a una
 * de las dos pantallas sin poder explicar por qué.
 *
 * ── LOS BUCKETS SON DE LA CLÍNICA ──────────────────────────────────────
 * Un pago cae en su bucket por su fecha LOCAL (`getTzParts`), no por la UTC.
 * Es el mismo criterio que `bucketKeyFor` de @/lib/home/revenue-buckets, y es
 * lo que evita que el cobro de las 19:00 de un martes aparezca el miércoles.
 * Los buckets teselan el rango COMPLETO —los vacíos van con 0— para que la
 * suma de la serie sea el total por construcción y no por casualidad.
 */

import { z } from "zod";
import { money, netRevenueSeries, refundPaymentWhere, revenuePaymentWhere } from "@/lib/caja";
import { dbDe, definirHerramienta, pesos } from "./base";
import {
  claveBucket,
  clavesDelRango,
  esquemaRango,
  resolverRango,
  type Agrupacion,
} from "./fechas";
import type { SabinaCtx } from "../tipos";

const parametros = esquemaRango.extend({
  /** Cómo se agrupa la serie. Por defecto, día. */
  agrupar: z.enum(["dia", "semana", "mes"]).optional(),
});

export type ParamsIngresos = z.infer<typeof parametros>;

export interface DatosIngresos {
  desde: string;
  hasta: string;
  agrupar: Agrupacion;
  /** Cobros − reembolsos. El número de Finanzas. */
  ingresosNetos: number;
  /** Solo cobros, sin restar lo devuelto. El de la tarjeta del home admin. */
  ingresosBrutos: number;
  reembolsos: number;
  cobros: number;
  /** La serie, en orden, cubriendo el rango completo (los tramos sin dinero van en 0). */
  serie: Array<{ periodo: string; monto: number }>;
  /** Promedio por cobro (ticket): brutos ÷ nº de cobros. `null` si no hubo cobros. */
  ticketPromedio: number | null;
  mejor: { periodo: string; monto: number } | null;
}

export const ingresosPorPeriodo = definirHerramienta<ParamsIngresos, DatosIngresos>({
  nombre: "ingresos_por_periodo",
  descripcion:
    "El dinero cobrado en un rango de fechas, agrupado por día, semana o mes: ingreso neto (cobros " +
    "menos reembolsos), ingreso bruto, reembolsos, número de cobros, ticket promedio y el mejor " +
    "periodo. Úsala para «¿cuánto facturé este mes?», «¿por qué bajaron mis ingresos?», " +
    "«¿cómo vengo comparado con antes?» o cualquier pregunta sobre dinero que YA entró. " +
    "Para lo que falta cobrar usa pacientes_con_deuda; para saber qué tratamiento deja más, " +
    "tratamientos_por_ingreso.",
  parametros,
  permiso: "billing.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosIngresos> {
    const db = dbDe(ctx);
    const rango = resolverRango(params, ctx.timezone, 30);
    const agrupar: Agrupacion = params.agrupar ?? "dia";
    const paidAt = { gte: rango.ventana.desde, lt: rango.ventana.hasta };

    const [cobros, devueltos] = await Promise.all([
      db.payment.findMany({
        where: revenuePaymentWhere(ctx.clinicId, paidAt),
        select: { amount: true, paidAt: true },
      }),
      db.payment.findMany({
        where: refundPaymentWhere(ctx.clinicId, paidAt),
        select: { amount: true, paidAt: true },
      }),
    ]);

    const neto = netRevenueSeries(
      cobros as Array<{ amount: number | null; paidAt: Date }>,
      devueltos as Array<{ amount: number | null; paidAt: Date }>,
      (d) => claveBucket(new Date(d), ctx.timezone, agrupar),
    );

    // El rango COMPLETO, con los tramos vacíos en 0: así la serie que se le
    // enseña al modelo suma exactamente el total que se le dice.
    const claves = clavesDelRango(rango.desdeISO, rango.hastaISO, ctx.timezone, agrupar);
    const serie = claves.map((periodo) => ({ periodo, monto: money(neto.porBucket[periodo] ?? 0) }));

    const brutos = money(cobros.reduce((s: number, p: any) => s + (p.amount ?? 0), 0));
    const conDinero = serie.filter((s) => s.monto !== 0);
    const mejor = conDinero.length
      ? conDinero.reduce((a, b) => (b.monto > a.monto ? b : a))
      : null;

    return {
      desde: rango.desdeISO,
      hasta: rango.hastaISO,
      agrupar,
      ingresosNetos: neto.ingresos,
      ingresosBrutos: brutos,
      reembolsos: neto.reembolsos,
      cobros: cobros.length,
      serie,
      ticketPromedio: cobros.length > 0 ? money(brutos / cobros.length) : null,
      mejor,
    };
  },

  vacio: (d) => d.cobros === 0 && d.reembolsos === 0,

  resumir(d) {
    const unidad = d.agrupar === "dia" ? "día" : d.agrupar === "semana" ? "semana" : "mes";
    const dev =
      d.reembolsos > 0
        ? ` (${pesos(d.ingresosBrutos)} cobrados menos ${pesos(d.reembolsos)} devueltos)`
        : "";
    const pico = d.mejor ? ` El mejor ${unidad}: ${d.mejor.periodo} con ${pesos(d.mejor.monto)}.` : "";
    const ticket = d.ticketPromedio !== null ? ` Ticket promedio ${pesos(d.ticketPromedio)}.` : "";
    return (
      `${pesos(d.ingresosNetos)} netos entre ${d.desde} y ${d.hasta}${dev}, en ` +
      `${d.cobros} cobro${d.cobros === 1 ? "" : "s"}.${pico}${ticket}`
    );
  },
});
