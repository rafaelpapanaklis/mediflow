// ═══════════════════════════════════════════════════════════════════════════
// A QUÉ CUOTA FUE UN COBRO (ws1-t5, ronda 6 — fila 12 del mapa de conexiones
// de la revisión de lógica de uso). Puro, sin I/O.
//
// En el corte de Caja un abono a un tratamiento a plazos salía con el concepto
// de la factura y nada más: doce cobros iguales de «Tratamiento de ortodoncia»
// en un año, sin forma de saber cuál era cuál. Aquí se dice: «mensualidad 7 de
// 24», «enganche», «mensualidades 7 y 8 de 24».
//
// No inventa otra forma de repartir: usa la misma cascada que todo el panel
// (`destinoDelAbono`, plan-de-pagos.ts) sobre los pagos ANTERIORES a éste, en
// el orden en que entraron.
// ═══════════════════════════════════════════════════════════════════════════

import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { calendarioDeCuotas, destinoDelAbono, pagosDesdeFilas } from "./plan-de-pagos";

export interface FilaDePago {
  id: string;
  amount: unknown;
  method?: string | null;
  paidAt: Date;
}

/** Los pagos en el orden en que entraron; a igual instante, por id, para que el orden sea siempre el mismo. */
function enOrden(filas: FilaDePago[]): FilaDePago[] {
  return [...filas].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime() || a.id.localeCompare(b.id));
}

/** «7», «7 y 8», «7 a 9». */
function rango(numeros: number[]): string {
  if (numeros.length === 1) return String(numeros[0]);
  if (numeros.length === 2) return `${numeros[0]} y ${numeros[1]}`;
  return `${numeros[0]} a ${numeros[numeros.length - 1]}`;
}

/**
 * Qué cuotas cubrió el pago `paymentId` de una factura a plazos. `null` si no
 * hay nada que decir: la factura no es a plazos, el movimiento es un
 * reembolso, el pago no está en la lista o fue dinero de más sobre un plan ya
 * saldado.
 *
 * Una cuota cuenta aunque el pago solo la abone en parte: «mensualidad 7 de
 * 24» para un abono a la séptima. Si el plan es mensual se dice
 * «mensualidad»; si es semanal o quincenal, «pago».
 */
export function rotuloDeCuotasDelPago(
  condiciones: CondicionesPago | null | undefined,
  totalFactura: number,
  pagosDeLaFactura: FilaDePago[],
  paymentId: string,
): string | null {
  const cuotas = calendarioDeCuotas(condiciones, totalFactura);
  if (cuotas.length === 0 || !condiciones) return null;

  const filas = enOrden(pagosDeLaFactura);
  const i = filas.findIndex((f) => f.id === paymentId);
  if (i < 0) return null;
  const pago = filas[i];
  if (pago.method === "refund") return null;

  // La fecha no cambia a qué cuota va un abono (solo si está vencida o no).
  const destino = destinoDelAbono(cuotas, pagosDesdeFilas(filas.slice(0, i)), Number(pago.amount) || 0, "9999-12-31");
  if (destino.length === 0) return null;

  const total = cuotas.filter((q) => !q.esEnganche).length;
  const numeros = destino.filter((d) => !d.cuota.esEnganche).map((d) => d.cuota.numero);
  const conEnganche = destino.some((d) => d.cuota.esEnganche);
  const mensual = condiciones.frecuencia === "MONTHLY";
  const nombre = numeros.length === 1 ? (mensual ? "mensualidad" : "pago") : (mensual ? "mensualidades" : "pagos");

  if (numeros.length === 0) return "enganche";
  const deLasCuotas = `${nombre} ${rango(numeros)} de ${total}`;
  return conEnganche ? `enganche y ${deLasCuotas}` : deLasCuotas;
}

/** El concepto del corte con la cuota: «Tratamiento de ortodoncia — mensualidad 7 de 24». */
export function conceptoConCuota(concepto: string, rotulo: string | null): string {
  if (!rotulo) return concepto;
  return concepto && concepto !== "—" ? `${concepto} — ${rotulo}` : rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}
