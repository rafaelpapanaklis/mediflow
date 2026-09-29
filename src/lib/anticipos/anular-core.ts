// Anular un anticipo registrado por error (H7 de la revisión final, ws1-t4).
// Puro: sin base. El servidor está en `anular.server.ts`.
//
// EL FALLO. «Registrar anticipo recibido» con el monto o la factura
// equivocados dejaba la factura PARCIAL (o PAGADA) y no había forma de
// deshacerlo: en PARCIAL no se ofrece «Cancelar factura» ni «Reembolsar».
//
// CÓMO SE ANULA, SIN BORRAR NADA Y SIN CAMBIAR EL ESQUEMA
//  - El pago (Payment) se queda, con importe 0 y una nota que dice cuánto era,
//    con qué método, quién lo anuló, cuándo y por qué. Con importe 0 ninguna
//    suma lo cuenta: ni la Caja del turno (un efectivo que nunca entró deja de
//    esperarse en el cajón), ni reportes, ni el «Total / Anticipo / Pendiente».
//    Un reembolso («refund») no servía: la Caja lo pinta aparte y seguiría
//    esperando ese efectivo.
//  - El anticipo pasa a FAILED (el CHECK de la base solo admite PENDING, PAID,
//    EXPIRED y FAILED) con `lastMpStatus = "anulado"` y el mismo detalle.
//  - La factura vuelve a como estaba: se le resta lo que ese pago le había
//    sumado; sin nada pagado queda PENDIENTE, con algo, PARCIAL.
//  - La bitácora guarda el antes y el después.
//  - Mercado Pago: el dinero SÍ llegó. Se anula igual en el panel, pero el
//    reembolso real se hace en Mercado Pago; la respuesta lo avisa.

import { formatoPesos, redondear2 } from "./core";

export const MOTIVO_MINIMO = 5;
export const ESTADO_MP_ANULADO = "anulado";

export function validarMotivoAnulacion(motivo: unknown): string | null {
  if (typeof motivo !== "string" || motivo.trim().length < MOTIVO_MINIMO) {
    return `Escribe por qué se anula (mínimo ${MOTIVO_MINIMO} letras): queda en el historial.`;
  }
  if (motivo.trim().length > 300) return "El motivo es demasiado largo (máximo 300 letras).";
  return null;
}

const METODO_TEXTO: Record<string, string> = {
  cash: "efectivo",
  transfer: "transferencia",
  debit: "tarjeta de débito",
  credit: "tarjeta de crédito",
  mercadopago: "Mercado Pago",
};

export function textoMetodo(method: string): string {
  return METODO_TEXTO[method] ?? method;
}

/** La línea que queda en el pago y en el anticipo. */
export function notaDeAnulacion(args: {
  monto: number;
  method: string;
  quien: string;
  cuando: Date;
  motivo: string;
}): string {
  const fecha = args.cuando.toISOString().slice(0, 16).replace("T", " ");
  return `[ANTICIPO ANULADO el ${fecha} UTC por ${args.quien}: ${args.motivo.trim()}. Era ${formatoPesos(redondear2(args.monto))} en ${textoMetodo(args.method)}.]`;
}

/**
 * ¿Ese pago sumó a lo pagado de la factura? El webhook de Mercado Pago
 * registra el pago sobre una factura cancelada o ya saldada SIN sumarlo (lo
 * marca «revisar/devolver»): anular ese no debe restar nada.
 */
export function pagoSumoALaFactura(notas: string | null | undefined): boolean {
  return !/Anticipo pagado sobre factura (cancelada|ya saldada)/.test(notas ?? "");
}

/** Cómo queda la factura al quitarle `monto` de lo pagado. */
export function facturaTrasAnular(total: number, pagado: number, monto: number): {
  paid: number;
  balance: number;
  status: "PENDING" | "PARTIAL" | "PAID";
} {
  const paid = redondear2(Math.max(0, pagado - Math.max(0, monto)));
  const balance = redondear2(Math.max(0, total - paid));
  const status = paid <= 0 ? "PENDING" : balance > 0 ? "PARTIAL" : "PAID";
  return { paid, balance, status };
}
