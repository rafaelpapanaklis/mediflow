// ═══════════════════════════════════════════════════════════════════════════
// El concepto del CFDI de UN pago de una factura a plazos (ws1-t1, sep-2026).
// Puro, sin I/O — misma familia que lib/invoices/plan-de-pagos.ts, que es de
// donde sale toda la aritmética: nada aquí reinventa la cascada de abonos.
//
// «¿A qué cuota corresponde este pago?» NO se guarda en ningún lado (mismo
// principio que plan-de-pagos.ts): se RECALCULA reproduciendo la cascada con
// el historial de pagos hasta este, en el MISMO orden en que se cobraron. Un
// pago que cae limpio en una sola cuota dice "mensualidad 3 de 18"; uno que
// abre dos cuotas, o que sobra, dice algo más genérico — nunca se inventa un
// número de cuota que no es exacto.
// ═══════════════════════════════════════════════════════════════════════════

import { round2, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { calendarioDeCuotas, destinoDelAbono, pagosDesdeFilas } from "@/lib/invoices/plan-de-pagos";

export interface PagoParaConcepto {
  amount: number;
  method?: string | null;
  paidAt: string | Date;
}

export interface ConceptoDePago {
  descripcion: string;
  /** Números de cuota (sin contar enganche) que este pago cubre limpio, o []. */
  cuotas: number[];
}

function aFechaISO(d: string | Date): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : "1970-01-01";
}

/**
 * ¿Esta factura admite CFDI por pago? Solo las "a plazos" (enganche +
 * mensualidades): un pago único ya se timbra entero con /api/cfdi de
 * siempre — no hay nada que repartir.
 */
export function facturaAdmiteCfdiPorPago(condiciones: CondicionesPago | null | undefined): boolean {
  return !!condiciones && condiciones.modo === "plazos";
}

/**
 * El concepto de un pago concreto. `pagosAnteriores` son los pagos de la
 * MISMA factura estrictamente ANTERIORES a `pago` en el tiempo (sin incluirlo),
 * en el orden en que se cobraron — refunds incluidos, con el signo que ya les
 * da `pagosDesdeFilas`.
 */
export function conceptoDePago(args: {
  condiciones: CondicionesPago | null | undefined;
  totalFactura: number;
  descripcionBase: string;
  pagosAnteriores: PagoParaConcepto[];
  pago: PagoParaConcepto;
}): ConceptoDePago {
  const { condiciones, totalFactura, descripcionBase, pagosAnteriores, pago } = args;
  const cuotas = calendarioDeCuotas(condiciones, totalFactura);
  if (cuotas.length === 0) return { descripcion: descripcionBase, cuotas: [] };

  const totalCuotas = cuotas.filter((q) => !q.esEnganche).length;
  const pagosPrevios = pagosDesdeFilas(pagosAnteriores);
  const destino = destinoDelAbono(cuotas, pagosPrevios, pago.amount, aFechaISO(pago.paidAt));

  if (destino.length === 0) {
    // El plan ya estaba saldado (o el pago excede lo que queda): no hay
    // cuota que nombrar, pero el pago SÍ se cobró y sigue siendo facturable.
    return { descripcion: `${descripcionBase} — abono adicional`, cuotas: [] };
  }

  if (destino.length === 1 && round2(destino[0].aplica) === round2(pago.amount)) {
    const q = destino[0].cuota;
    return q.esEnganche
      ? { descripcion: `${descripcionBase} — enganche`, cuotas: [] }
      : { descripcion: `${descripcionBase} — mensualidad ${q.numero} de ${totalCuotas}`, cuotas: [q.numero] };
  }

  const numeros = destino.map((d) => d.cuota.numero).filter((n, i, arr) => arr.indexOf(n) === i);
  const soloEnganche = destino.every((d) => d.cuota.esEnganche);
  const etiqueta = soloEnganche
    ? "enganche"
    : numeros.length > 1
      ? `cuotas ${numeros[0]}–${numeros[numeros.length - 1]}`
      : `cuota ${numeros[0]}`;
  return { descripcion: `${descripcionBase} — abono (${etiqueta})`, cuotas: soloEnganche ? [] : numeros };
}

/**
 * ¿El total ya timbrado (de la factura completa + de los pagos ya
 * facturados) más ESTE pago rebasa lo que vale el caso? Tolerancia de 1¢,
 * igual que el resto de los cuadres de CFDI (lib/invoices/cfdi-cuadre.ts).
 */
export function excedeElTotalDelCaso(args: { yaTimbrado: number; montoDelPago: number; totalFactura: number }): boolean {
  const suma = round2(args.yaTimbrado + args.montoDelPago);
  return suma > round2(args.totalFactura) + 0.01;
}
