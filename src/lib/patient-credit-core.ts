// Saldo a favor → factura: la aritmética y las reglas, sin I/O (client-safe).
//
// El saldo a favor de un paciente es SUM(amount) de sus filas de
// patient_credits, y esa tabla es un LIBRO de movimientos:
//   · entra dinero  → fila POSITIVA (anticipo por Mercado Pago, saldo migrado,
//                     anticipo devuelto al cancelar una factura);
//   · se aplica     → fila NEGATIVA con source «aplicado_a_factura», ligada a la
//                     factura y al Payment que la abonó.
// Así las lecturas que ya existían (getPatientCreditBalance, el KPI de Caja) ven
// el saldo ya descontado sin cambiar una línea: no hay un segundo sitio donde
// el mismo dinero pueda seguir contando.
//
// Lo usan el servicio (patient-credit-aplicar.ts) y el detalle de la factura
// (para saber si se puede cancelar devolviendo el anticipo).

import { round2 } from "@/lib/quotes/compute";

/** Payment.method del abono que sale del saldo a favor. */
export const METODO_ANTICIPO = "anticipo";

/** source de la fila NEGATIVA: saldo a favor aplicado a una factura. */
export const FUENTE_APLICADO = "aplicado_a_factura";

/** source de la fila POSITIVA: el anticipo vuelve a favor al cancelar la factura. */
export const FUENTE_DEVUELTO = "devuelto_por_cancelacion";

/**
 * SOLO FACTURAS NUEVAS (decisión de Rafael, 23-sep-2026): las que existían
 * antes se quedan exactamente como están. Una factura que se está CREANDO es
 * nueva por definición y no mira esta fecha. La fecha frena el otro camino:
 * CONFIRMAR un borrador (DRAFT → PENDING) que nació antes del cambio, que es
 * el único por el que una factura de antes podría recibir saldo a favor.
 * 00:00 del 24-sep-2026 en Ciudad de México.
 */
export const APLICAR_SALDO_DESDE = new Date("2026-09-24T06:00:00.000Z");

/** Clave del candado por paciente (pg_advisory_xact_lock(hashtext(clave))). */
export function claveCandadoSaldo(clinicId: string, patientId: string): string {
  return `saldo-a-favor:${clinicId}:${patientId}`;
}

/**
 * Cuánto del saldo a favor cabe en la factura: lo que haya a favor, sin pasar
 * de lo que queda por pagar. Nunca negativo, nunca más que el saldo pendiente
 * (una factura no puede quedar con balance negativo).
 */
export function montoAAplicar(saldoAFavor: number, total: number, pagado: number): number {
  const saldo = round2(saldoAFavor);
  const pendiente = round2(total - pagado);
  if (!(saldo > 0) || !(pendiente > 0)) return 0;
  return round2(Math.min(saldo, pendiente));
}

/** paid / balance / status de la factura después de abonarle `monto`. */
export function estadoTrasAbono(total: number, pagado: number, monto: number): {
  paid: number;
  balance: number;
  status: "PAID" | "PARTIAL";
} {
  const paid = round2(pagado + monto);
  const balance = round2(total - paid);
  return { paid, balance: Math.max(0, balance), status: balance <= 0 ? "PAID" : "PARTIAL" };
}

/**
 * De dónde viene la llamada:
 *   · "creada"     — la factura se acaba de crear (editor, cita, presupuesto);
 *   · "confirmada" — un borrador acaba de pasar a PENDING.
 */
export type OrigenAplicacion = "creada" | "confirmada";

/** Por qué una factura NO recibe el saldo a favor (null = sí lo recibe). */
export function motivoParaNoAplicar(
  inv: { status: string; cfdiUuid: string | null; createdAt: Date },
  origen: OrigenAplicacion,
  desde: Date = APLICAR_SALDO_DESDE,
): string | null {
  if (inv.status === "DRAFT") return "borrador: se aplica al confirmarla";
  if (inv.status === "CANCELLED") return "factura cancelada";
  if (inv.status === "PAID") return "factura ya pagada";
  if (inv.cfdiUuid) return "factura ya timbrada";
  if (origen === "confirmada" && inv.createdAt.getTime() < desde.getTime()) {
    return "borrador anterior al cambio: se queda como estaba";
  }
  return null;
}

/**
 * Qué pasa con lo pagado de una factura al CANCELARLA.
 *
 *   · `devolver`: lo que vuelve al saldo a favor. Es lo aplicado del anticipo
 *     que la factura todavía conserva: si parte de lo pagado ya salió por
 *     «Reembolsar» (en efectivo), eso ya se le entregó al paciente y no vuelve
 *     a favor por segunda vez.
 *   · `otrosPagos`: lo pagado que NO es anticipo (efectivo, tarjeta…). Si hay,
 *     la factura no se cancela aquí: primero se reembolsa, como hasta hoy.
 */
export function repartoAlCancelar(pagado: number, anticipoNeto: number): {
  devolver: number;
  otrosPagos: number;
} {
  const paid = round2(Math.max(0, pagado));
  const devolver = round2(Math.min(paid, Math.max(0, round2(anticipoNeto))));
  const otros = round2(paid - devolver);
  // Cifras ya en centavos (round2): un solo centavo que no es anticipo también
  // se reembolsa primero; no se cancela una factura con dinero dentro.
  return { devolver, otrosPagos: otros > 0 ? otros : 0 };
}

/**
 * Del lado de la pantalla: ¿lo pagado de esta factura es SOLO anticipo? Mira
 * los Payment que ya trae el detalle, con el MISMO reparto que el servidor
 * (repartoAlCancelar): un reembolso sale primero de lo que no es anticipo. El
 * servidor lo vuelve a decidir con el libro de patient_credits dentro del
 * candado; esto solo decide si se enseña el botón.
 */
export function pagadoEsSoloAnticipo(
  pagado: number,
  payments: Array<{ method?: string | null; amount?: number | null }> | null | undefined,
): boolean {
  if (!(round2(pagado) > 0) || !Array.isArray(payments)) return false;
  let anticipo = 0;
  for (const p of payments) {
    if (p?.method === METODO_ANTICIPO) anticipo += Number(p?.amount) || 0;
  }
  if (!(anticipo > 0)) return false;
  return repartoAlCancelar(pagado, anticipo).otrosPagos === 0;
}
