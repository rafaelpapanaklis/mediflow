// ═══════════════════════════════════════════════════════════════════
// REEMBOLSOS: cuál es salida de dinero y cuál es un traspaso a saldo a favor
// (ws1-t5, F3 y F5 de la auditoría del dinero, 3-oct-2026). Sin imports:
// lo leen la pantalla (cliente) y el servidor.
//
// Un reembolso se guarda como Payment `method: "refund"` con monto POSITIVO,
// y así se queda: es lo que baja `paid` de la factura, y la cascada de
// mensualidades, el PDF, el portal y el CFDI ya lo leen así. Lo que distingue
// QUÉ fue es `payments."refundMethod"`:
//
//   · "cash" | "transfer" | "debit" | "credit" | "check" | "other" → el dinero
//     SALIÓ hacia el paciente por ese medio. Es un reembolso real: resta de
//     los ingresos, y si fue "cash" resta del efectivo esperado del corte.
//   · "saldo_a_favor" → el dinero NO salió: pasó de la factura al saldo a
//     favor del paciente (excedente de un cobro, cita cancelada, anticipo que
//     vuelve al cancelar). No es ingreso ni egreso; no resta nada.
//   · null → reembolso anterior a esta columna: no se sabe por dónde salió.
//     Cuenta como reembolso (como siempre), pero NO toca el efectivo esperado.
// ═══════════════════════════════════════════════════════════════════

/** Payment.method de todo reembolso (real o traspaso). */
export const METODO_REEMBOLSO = "refund";

/** `refundMethod` del traspaso a saldo a favor: no sale dinero. */
export const REEMBOLSO_A_SALDO_A_FAVOR = "saldo_a_favor";

/** Por dónde puede SALIR el dinero de un reembolso real (los del selector de cobro, sin Mercado Pago). */
export const METODOS_DE_DEVOLUCION = ["cash", "transfer", "debit", "credit", "check", "other"] as const;
export type MetodoDeDevolucion = (typeof METODOS_DE_DEVOLUCION)[number];

export function esMetodoDeDevolucion(x: unknown): x is MetodoDeDevolucion {
  return typeof x === "string" && (METODOS_DE_DEVOLUCION as readonly string[]).includes(x);
}

type Mov = { method: string; refundMethod?: string | null };

/** Fila «refund» que solo pasa dinero a saldo a favor (no es salida de dinero). */
export function esTraspasoASaldoAFavor(p: Mov): boolean {
  return p.method === METODO_REEMBOLSO && p.refundMethod === REEMBOLSO_A_SALDO_A_FAVOR;
}

/** Reembolso que SÍ es salida de dinero (o uno viejo sin método: se cuenta como siempre). */
export function esReembolsoReal(p: Mov): boolean {
  return p.method === METODO_REEMBOLSO && p.refundMethod !== REEMBOLSO_A_SALDO_A_FAVOR;
}

/** Reembolso que salió del CAJÓN: el único que baja el efectivo esperado del corte. */
export function esReembolsoEnEfectivo(p: Mov): boolean {
  return p.method === METODO_REEMBOLSO && p.refundMethod === "cash";
}

/**
 * Fuentes de `patient_credits` que son DINERO QUE ENTRÓ sin pasar por una
 * factura (no hay Payment): el anticipo que el paciente pagó por Mercado Pago
 * sin factura (bot o pago tardío) y el excedente de un cobro automático. Son
 * ingreso el día que se cobran (`creditDate`). Ninguna otra fuente lo es: el
 * saldo migrado es historia, y «excedente», «cita cancelada» y «devuelto»
 * salen de dinero que ya contó cuando se cobró en su factura.
 */
export const FUENTES_CREDITO_QUE_SON_INGRESO = ["anticipo_mercadopago", "cobro_automatico_mercadopago"] as const;
