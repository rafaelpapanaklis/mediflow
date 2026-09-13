/**
 * `tratamientos_por_ingreso` — qué tratamientos dejan más dinero en un rango.
 *
 * ── QUÉ MIDE, DICHO SIN ADORNOS: LO FACTURADO, NO LO COBRADO ───────────
 * Suma los CONCEPTOS de las facturas emitidas en el rango. No es lo mismo que
 * `ingresos_por_periodo`, que suma los pagos que entraron: una endodoncia
 * facturada en enero y pagada en marzo cuenta aquí en enero y allí en marzo. Se
 * hace así porque el concepto —el tratamiento— vive en la factura y no en el
 * pago: un abono de $2,000 a una factura de tres conceptos no dice a cuál de los
 * tres pertenece, y repartirlo sería inventar. El resumen lo dice con esa
 * palabra, "facturado", para que Sabina no lo presente como caja.
 *
 * ── EL IMPORTE POR LÍNEA ES EL DEL SAT ─────────────────────────────────
 * Cada concepto vale `invoiceLineBases(items, discount)`: cantidad × precio,
 * menos su descuento de línea, menos la parte que le toca del descuento de
 * factura (prorrateado con el mismo `spreadInvoiceDiscount` con el que se
 * timbra). Es la MISMA línea que viaja en el CFDI, así que el ranking suma lo
 * que de verdad se facturó y no el bruto antes de descuentos.
 *
 * ── POBLACIÓN ──────────────────────────────────────────────────────────
 * `status notIn [DRAFT, CANCELLED]` — facturas EMITIDAS. Un borrador no es
 * ingreso y una cancelada no lo fue. Mismo criterio que `receivableInvoiceWhere`
 * y que `computeDayBilling` de @/lib/caja. Más la visibilidad por paciente de
 * GET /api/invoices.
 */

import { z } from "zod";
import { invoiceLineBases, itemQuantity, PRICE_ADJUST_FLAG, round2 } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { dbDe, definirHerramienta, fraseRecorte, pesos, recortar, visorDe, type Lista } from "./base";
import { esquemaRango, resolverRango, type ParamsRango } from "./fechas";
import type { SabinaCtx } from "../tipos";

/**
 * Tope de facturas que se leen de una vez. Es el mismo orden de magnitud que el
 * post-fetch de /api/patients (5 000 filas), y con motivo: pasado eso la
 * respuesta honesta es «pídemelo por trozos», no un ranking calculado sobre una
 * muestra sin decirlo.
 */
const TOPE_FACTURAS = 5000;

const parametros = esquemaRango.extend({
  /** Cuántos tratamientos devolver, de mayor a menor. Tope duro: 50. */
  top: z.number().int().min(1).max(50).optional(),
});

export type ParamsTratamientos = z.infer<typeof parametros>;

export interface TratamientoFila {
  tratamiento: string;
  /** Suma de los importes de línea (con descuentos ya aplicados). */
  importe: number;
  /** Cuántas veces aparece como concepto. */
  veces: number;
  /** Unidades facturadas (suma de `quantity`). */
  cantidad: number;
  /** Importe medio por unidad. */
  precioMedio: number;
  /** Qué parte del total facturado del rango representa. */
  participacionPct: number;
}

export interface DatosTratamientos {
  desde: string;
  hasta: string;
  tratamientos: Lista<TratamientoFila>;
  /** Σ de todos los conceptos del rango (incluidos los ajustes de precio). */
  totalFacturado: number;
  /** Facturas emitidas leídas en el rango. */
  facturas: number;
  /** Líneas "Ajuste de precio", que no son un tratamiento pero sí dinero. */
  ajustesDePrecio: number;
}

export const tratamientosPorIngreso = definirHerramienta<ParamsTratamientos, DatosTratamientos>({
  nombre: "tratamientos_por_ingreso",
  descripcion:
    "El ranking de tratamientos por dinero FACTURADO en un rango: importe, veces facturado, unidades, " +
    "precio medio y qué porcentaje del total representa cada uno. Úsala para «¿qué tratamiento me deja " +
    "más?», «¿en qué se me va el trabajo?», «¿qué debería promocionar?» o para razonar sobre mezcla de " +
    "servicios y rentabilidad. Mide lo facturado, no lo cobrado: para la caja usa ingresos_por_periodo.",
  parametros,
  permiso: "billing.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosTratamientos> {
    const db = dbDe(ctx);
    const rango = resolverRango(params, ctx.timezone, 90);
    const vis = relatedPatientVisibilityAnd(visorDe(ctx));

    const where: Record<string, any> = {
      clinicId: ctx.clinicId, // 🔴 de la sesión
      status: { notIn: ["DRAFT", "CANCELLED"] },
      createdAt: { gte: rango.ventana.desde, lt: rango.ventana.hasta },
      ...(vis.length ? { AND: vis } : {}),
    };

    const [total, facturas] = await Promise.all([
      db.invoice.count({ where }),
      db.invoice.findMany({
        where,
        select: { items: true, discount: true },
        take: TOPE_FACTURAS,
      }),
    ]);

    if (total > TOPE_FACTURAS) {
      throw new Error(
        `rango_demasiado_grande: ${total} facturas emitidas entre ${rango.desdeISO} y ${rango.hastaISO} ` +
          `(el tope es ${TOPE_FACTURAS}); pídelo por trozos más cortos para que el ranking salga completo`,
      );
    }

    const acumulado: Record<string, { importe: number; veces: number; cantidad: number }> = {};
    let totalFacturado = 0;
    let ajustes = 0;

    for (const f of facturas) {
      const items = Array.isArray(f.items) ? (f.items as any[]) : [];
      if (items.length === 0) continue;
      const bases = invoiceLineBases(items, Number(f.discount) || 0);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const base = bases[i] ?? 0;
        totalFacturado += base;
        // El "Ajuste de precio" que mete Editar precio es dinero real, pero no es
        // un tratamiento: se reporta aparte para que el ranking no lo confunda con
        // uno y para que las sumas sigan cuadrando.
        if (it?.[PRICE_ADJUST_FLAG]) {
          ajustes += base;
          continue;
        }
        const nombre = etiqueta(it);
        const acc = acumulado[nombre] ?? { importe: 0, veces: 0, cantidad: 0 };
        acc.importe += base;
        acc.veces += 1;
        acc.cantidad += itemQuantity(it);
        acumulado[nombre] = acc;
      }
    }

    totalFacturado = round2(totalFacturado);
    const nombres = Object.keys(acumulado);
    const filas: TratamientoFila[] = nombres
      .map((tratamiento) => {
        const a = acumulado[tratamiento];
        return {
          tratamiento,
          importe: round2(a.importe),
          veces: a.veces,
          cantidad: a.cantidad,
          precioMedio: a.cantidad > 0 ? round2(a.importe / a.cantidad) : 0,
          participacionPct:
            totalFacturado > 0 ? Math.round((a.importe / totalFacturado) * 100) : 0,
        };
      })
      .sort((x, y) => y.importe - x.importe);

    const tope = params.top ?? 50;
    return {
      desde: rango.desdeISO,
      hasta: rango.hastaISO,
      tratamientos: recortar(filas.slice(0, tope), filas.length),
      totalFacturado,
      facturas: facturas.length,
      ajustesDePrecio: round2(ajustes),
    };
  },

  vacio: (d) => d.tratamientos.total === 0,

  resumir(d) {
    const top = d.tratamientos.filas.slice(0, 3);
    const lista = top
      .map((t) => `${t.tratamiento} ${pesos(t.importe)} (${t.participacionPct}%)`)
      .join(", ");
    return (
      `${pesos(d.totalFacturado)} facturados en ${d.facturas} factura${d.facturas === 1 ? "" : "s"} ` +
      `entre ${d.desde} y ${d.hasta}, repartidos en ${d.tratamientos.total} ` +
      `tratamiento${d.tratamientos.total === 1 ? "" : "s"}` +
      `${fraseRecorte(d.tratamientos, "tratamientos")}. Los que más dejan: ${lista}.`
    );
  },
});

/** El nombre del concepto tal como se escribió en la factura. */
function etiqueta(it: any): string {
  const raw = it?.description ?? it?.name ?? it?.concept;
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || "(concepto sin nombre)";
}
