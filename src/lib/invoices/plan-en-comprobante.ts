// ═══════════════════════════════════════════════════════════════════════════
// EL PLAN DE PAGOS EN EL PDF DE LA FACTURA (ws1-t10, 29-sep-2026) — puro, sin I/O.
//
// El comprobante de una factura a plazos (una ortodoncia: total $38,000,
// enganche $8,000 + 15 pagos de $2,000) salía con UN concepto de $38,000 y nada
// que dijera cómo se paga. Aquí se resuelve lo que ese PDF cuenta de más:
//   · la frase de la tarjeta de la factura (`fraseCondiciones`, la MISMA),
//   · el calendario: enganche y cuota 1..N con fecha dd/mm/aaaa, monto y estado,
//   · en qué fecha quedó pagada cada cuota.
//
// No inventa nada: las cuotas son las de `calendarioDeCuotas` y el estado sale
// de `estadoDelPlan` (la cascada sobre lo realmente cobrado), es decir, lo mismo
// que ven la ficha, Caja y el módulo de Ortodoncia. Sin condiciones a plazos
// devuelve `null` y el comprobante sale exactamente como siempre.
// ═══════════════════════════════════════════════════════════════════════════

import { aCentavos, dinero, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { calendarioDeCuotas, esPlanAPlazos, estadoDelPlan, pagosDesdeFilas, type EstadoCuota } from "@/lib/invoices/plan-de-pagos";
import { fraseCondiciones } from "@/lib/invoices/correo-factura";

export const ZONA_POR_DEFECTO = "America/Mexico_City";

/** Un movimiento de la factura, como lo guarda `payments` (un reembolso es `method: "refund"` con monto positivo). */
export interface MovimientoDeFactura {
  amount: number;
  method: string;
  paidAt: Date;
}

export interface FilaDelPlan {
  /** «Enganche» · «Pago 3 de 15». */
  etiqueta: string;
  /** dd/mm/aaaa, o «Sin fecha». */
  fecha: string;
  monto: number;
  estado: EstadoCuota;
  /** «Pagado el 05/10/2026» · «Por vencer» · «Vencido» (con «abonado $X» si ya lleva algo). */
  texto: string;
}

export interface PlanDelComprobante {
  /** «Enganche de $8,000.00 y 15 pagos mensuales de $2,000.00, el primero el 1 de octubre de 2026». */
  frase: string;
  filas: FilaDelPlan[];
  /** Lo cobrado (nunca negativo) y lo que falta del plan, en pesos. */
  pagado: number;
  pendiente: number;
}

/** "2026-10-05" → "05/10/2026". */
export function fechaDDMMAAAA(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "Sin fecha";
}

/** El DÍA en que ocurrió un instante, en la zona de la clínica: "YYYY-MM-DD". */
export function diaEnZona(instante: Date, zona: string = ZONA_POR_DEFECTO): string {
  const d = instante instanceof Date && !isNaN(instante.getTime()) ? instante : new Date(NaN);
  if (isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_POR_DEFECTO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
}

/** dd/mm/aaaa de un instante, en la zona de la clínica. */
export function fechaDeMovimiento(instante: Date, zona?: string): string {
  return fechaDDMMAAAA(diaEnZona(instante, zona));
}

/**
 * Para cada cuota saldada, el día en que lo cobrado ALCANZÓ a cubrirla: se
 * recorren los movimientos de más viejo a más nuevo y se anota en cuál el
 * acumulado llegó al total de cuotas hasta esa. Mismo criterio de cascada que
 * `estadoDelPlan`: nadie elige a qué cuota va un abono.
 */
function diaEnQueSeSaldo(cuotasImporte: number[], movimientos: readonly MovimientoDeFactura[], zona?: string): (string | null)[] {
  const ordenados = [...movimientos].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  const netos = pagosDesdeFilas(ordenados.map((m) => ({ amount: m.amount, method: m.method })));
  let acumuladoC = 0;
  const acumulados = netos.map((n) => (acumuladoC += aCentavos(n.importe)));
  let requeridoC = 0;
  return cuotasImporte.map((importe) => {
    requeridoC += aCentavos(importe);
    const i = acumulados.findIndex((a) => a >= requeridoC);
    return i === -1 ? null : diaEnZona(ordenados[i].paidAt, zona);
  });
}

/**
 * El plan tal como se imprime, o `null` si la factura no es a plazos (un solo
 * pago, sin condiciones, o sin cuotas que pintar): ahí el PDF no cambia.
 *
 * `hoy` es "YYYY-MM-DD" en la zona de la clínica (una cuota vence cuando su día
 * ya pasó, como en el resto del panel).
 */
export function planParaComprobante(args: {
  total: number;
  condiciones: CondicionesPago | null | undefined;
  movimientos: readonly MovimientoDeFactura[];
  hoy: string;
  zona?: string;
}): PlanDelComprobante | null {
  const { total, condiciones, movimientos, hoy, zona } = args;
  if (!esPlanAPlazos(condiciones)) return null;
  const cuotas = calendarioDeCuotas(condiciones, total);
  if (cuotas.length === 0) return null;
  const frase = fraseCondiciones(total, condiciones);
  if (!frase) return null;

  const estado = estadoDelPlan(cuotas, pagosDesdeFilas(movimientos.map((m) => ({ amount: m.amount, method: m.method }))), hoy);
  const salda = diaEnQueSeSaldo(cuotas.map((q) => q.importe), movimientos, zona);
  const sinEnganche = estado.totalCuotas;

  const filas: FilaDelPlan[] = estado.cuotas.map((q, i) => {
    let texto: string;
    if (q.estado === "pagada") {
      texto = salda[i] ? `Pagado el ${fechaDDMMAAAA(salda[i])}` : "Pagado";
    } else {
      const base = q.estado === "vencida" ? "Vencido" : "Por vencer";
      texto = q.abonado > 0 ? `${base} · abonado ${dinero(q.abonado)}` : base;
    }
    return {
      etiqueta: q.esEnganche ? "Enganche" : `Pago ${q.numero} de ${sinEnganche}`,
      fecha: fechaDDMMAAAA(q.vencimiento),
      monto: q.importe,
      estado: q.estado,
      texto,
    };
  });

  return { frase, filas, pagado: estado.pagado, pendiente: estado.pendiente };
}
