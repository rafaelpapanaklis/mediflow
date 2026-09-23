// Mercado Pago como MÉTODO DE PAGO de una factura (ws1-t1) — las reglas del dinero.
//
// Rafael: «mercadopago es un metodo de pago por lo tanto agregalo como metodo de
// pago, si seleccionan enviar por correo o whatsapp entonces que se le envie por
// ahí el link con un mensaje y el monto».
//
// El rail es el del anticipo del bot (src/lib/anticipos/): la cuenta OAuth de la
// clínica, su token cifrado y el webhook firmado. Lo nuevo es el concepto
// FACTURA: el link cobra el SALDO y el pago se registra como un Payment.
//
// Aquí se decide, sin tocar base ni red:
//   · cuánto pide el link (el saldo, leído en el servidor; nunca del cliente);
//   · si un link que ya existe sigue sirviendo o hay que hacer otro;
//   · qué se hace con un pago que llega por el webhook.
//
// El dinero se compara en CENTAVOS enteros, como en anticipos/core.ts.
//
// PURO: sin Prisma, sin fetch, sin React. Lo prueba
// src/lib/factura-mp/__tests__/factura-mp.test.ts.

import { aCentavos, redondear2, formatoPesos, type PagoMp } from "@/lib/anticipos/core";

export { formatoPesos };

/** El `method` del Payment y de `Invoice.paymentMethod` cuando entra por el link. */
export const METODO_MERCADO_PAGO = "mercadopago";

/**
 * Menor saldo que se cobra con link, en pesos. Mismo piso que el anticipo y que
 * el pago en línea del portal: por debajo, MP se come casi todo en comisión.
 */
export const MINIMO_LINK_MXN = 10;

/** Cuánto vive un link de factura. Pasado el plazo se hace otro con el saldo de ese día. */
export const VIGENCIA_DIAS = 30;

/** Un link que vence antes de esto ya no se reparte: se hace otro. */
export const MARGEN_REUSO_MS = 24 * 60 * 60 * 1000;

/** Estados de factura cuyo saldo se puede cobrar con link (los del aviso de saldo). */
export const ESTADOS_COBRABLES = ["PENDING", "PARTIAL", "OVERDUE"];

const PREFIJO_REF = "factura";

/** external_reference y `?ref=` del webhook: «factura:<InvoicePaymentLink.id>». */
export function refDeFactura(linkId: string): string {
  return `${PREFIJO_REF}:${linkId}`;
}

/**
 * Lo que falta por cobrar, por el invariante total − paid (no por la columna
 * `balance`, que arrastra ruido de abonos: el mismo criterio de POST
 * /api/invoices/[id] y de online-payment.ts).
 */
export function saldoPorCobrar(inv: { total: number; paid: number }): number {
  return redondear2(Math.max(0, Number(inv.total) - Number(inv.paid)));
}

export type MotivoSinLink = "estado" | "sin_saldo" | "bajo_minimo";

/** ¿Se le puede hacer link a esta factura? null = sí. */
export function motivoSinLink(inv: { status: string; total: number; paid: number }): MotivoSinLink | null {
  if (!ESTADOS_COBRABLES.includes(inv.status)) return "estado";
  const saldo = saldoPorCobrar(inv);
  if (!(saldo > 0)) return "sin_saldo";
  if (saldo < MINIMO_LINK_MXN) return "bajo_minimo";
  return null;
}

export interface LinkGuardado {
  id: string;
  amount: number;
  status: string;
  expiresAt: Date;
  checkoutUrl: string | null;
  mpCollectorId: string | null;
}

/**
 * ¿Este link se puede volver a repartir? Solo si sigue PENDING, pide EXACTAMENTE
 * el saldo de hoy, lo cobra la cuenta conectada hoy y le queda al menos un día.
 * Si no, se hace otro: un link por el saldo viejo cobraría de más (o de menos).
 */
export function linkReutilizable(
  link: LinkGuardado,
  saldo: number,
  collectorHoy: string,
  ahora: Date,
): boolean {
  return (
    link.status === "PENDING" &&
    !!link.checkoutUrl &&
    aCentavos(link.amount) === aCentavos(saldo) &&
    link.mpCollectorId === collectorHoy &&
    link.expiresAt.getTime() - ahora.getTime() >= MARGEN_REUSO_MS
  );
}

/** ¿Sigue vivo para enseñarlo en pantalla? (PENDING y sin vencer.) */
export function linkVigente(link: Pick<LinkGuardado, "status" | "expiresAt">, ahora: Date): boolean {
  return link.status === "PENDING" && link.expiresAt.getTime() > ahora.getTime();
}

// ── El webhook ──────────────────────────────────────────────────────────────

export interface LinkParaEvaluar {
  id: string;
  mpCollectorId: string | null;
}

export type DecisionPagoFactura =
  /** No es de este link o no se puede leer: no se toca nada (y se responde 200). */
  | { accion: "ignorar"; motivo: string }
  /** Existe pero no está aprobado (rechazado, en proceso, devuelto…): se anota. */
  | { accion: "anotar_estado"; estado: string; detalle: string | null }
  /** Entró dinero: se registra como pago de la factura por lo que MP dice que se pagó. */
  | { accion: "aplicar"; monto: number };

/**
 * Qué hacer con un pago. Mismas reglas duras que el anticipo:
 *   · Solo `approved` registra. Ni `pending` ni `in_process`.
 *   · El pago tiene que ser de ESTE link (external_reference exacto) y de la
 *     cuenta que cobró.
 *   · El importe es lo que MERCADO PAGO dice que se pagó (transaction_amount,
 *     re-consultado con el token de la clínica); nada del cuerpo del webhook.
 * A diferencia del anticipo, aquí no hay «monto menor»: lo que entre se abona a
 * la factura (un abono parcial es un abono) y el servicio marca lo raro
 * (factura cancelada, ya saldada, o pago de más) sin perder el dinero.
 */
export function evaluarPagoDeFactura(link: LinkParaEvaluar, pago: PagoMp): DecisionPagoFactura {
  if (pago.externalReference !== refDeFactura(link.id)) {
    return { accion: "ignorar", motivo: "La referencia del pago no es la de este link." };
  }
  if (link.mpCollectorId && pago.collectorId && pago.collectorId !== link.mpCollectorId) {
    return { accion: "ignorar", motivo: "El pago lo cobró otra cuenta de Mercado Pago." };
  }
  if (pago.status !== "approved") {
    return { accion: "anotar_estado", estado: pago.status || "desconocido", detalle: pago.statusDetail };
  }
  if (pago.currencyId !== "MXN" || pago.transactionAmount == null || !(pago.transactionAmount > 0)) {
    return {
      accion: "ignorar",
      motivo: `Pago aprobado sin monto en MXN legible (${pago.currencyId ?? "?"} ${pago.transactionAmount ?? "?"}).`,
    };
  }
  return { accion: "aplicar", monto: redondear2(pago.transactionAmount) };
}

/** Lo que MP reporta cuando un pago que ya entró se revierte. */
export const ESTADOS_DE_REVERSO = ["refunded", "charged_back", "cancelled", "in_mediation"];

// ── Textos para el paciente ─────────────────────────────────────────────────

/** La línea del link en el WhatsApp de saldo: frase corta, monto y link. */
export function lineaLinkWhatsApp(url: string, monto: number): string {
  return `Puedes pagar ${formatoPesos(monto)} en línea con Mercado Pago aquí:\n${url}`;
}

/** El título del cobro en Mercado Pago (lo ve el paciente al pagar). */
export function tituloDelCobro(invoiceNumber: string, clinica: string | null | undefined): string {
  return `Nota ${invoiceNumber} — ${clinica?.trim() || "consultorio"}`.slice(0, 250);
}
