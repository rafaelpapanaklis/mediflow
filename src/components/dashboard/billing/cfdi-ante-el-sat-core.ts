// Lógica pura del bloque «CFDI ante el SAT» de la factura (ws1-t3): qué estado
// se pinta, qué botones salen y sus textos es/en. Sin React, para probarla.

import { FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";

export interface CfdiVista {
  id: string;
  uuid: string;
  tipoComprobante: string;
  total: number;
  status: string;
  paymentId: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancellationStatus: string | null;
  cancelMotive: string | null;
  cancelReason: string | null;
  substitutedByUuid: string | null;
  relatedUuid: string | null;
  relationType: string | null;
  refundPaymentId: string | null;
  satCheckedAt: string | null;
  receptorRfc: string | null;
  aceptacion: { requiere: boolean; razon: string | null };
  fueraDePlazo: boolean;
}

export interface RespuestaCfdisFactura {
  listo: boolean;
  sqlPendiente: string | null;
  cfdis: CfdiVista[];
  invoiceCfdiUuid: string | null;
  puedeCancelar: boolean;
  /** C-42: lo cobrado neto de la factura (sin él, no se ofrece el motivo 03). */
  cobrado?: number;
}

export type EstadoPintado =
  | "vigente" | "sustituido" | "cancelado" | "pendiente" | "verificando" | "rechazada" | "vencida" | "enviando" | "incierto";

export function estadoPintado(c: Pick<CfdiVista, "status" | "cancellationStatus">): EstadoPintado {
  if (c.status === "cancelled") return "cancelado";
  switch (c.cancellationStatus) {
    case "pending": return "pendiente";
    case "verifying": return "verificando";
    case "rejected": return "rechazada";
    case "expired": return "vencida";
    case "enviando": return "enviando";
    case "incierto": return "incierto";
    default: return c.status === "sustituido" ? "sustituido" : "vigente";
  }
}

/** El CFDI vigente que dice sustituir a `viejo` (relación 04), si lo hay. */
export function sustitutoDe(cfdis: CfdiVista[], viejo: CfdiVista): CfdiVista | null {
  return cfdis.find((c) => c.id !== viejo.id && c.status === "valid" && c.relationType === "04" && c.relatedUuid === viejo.uuid) ?? null;
}

/** Notas de crédito vigentes de un CFDI de ingreso. */
export function notasDe(cfdis: CfdiVista[], ingreso: CfdiVista): CfdiVista[] {
  return cfdis.filter((c) => c.tipoComprobante === "E" && c.status === "valid" && c.relatedUuid === ingreso.uuid);
}

export interface Acciones {
  consultar: boolean;
  cancelar: boolean;
  /** Cancelar con motivo 01: ya hay un sustituto timbrado. */
  cancelarSustituido: boolean;
  sustituir: boolean;
  notaCredito: boolean;
}

/**
 * Qué botones salen para un CFDI. `listo` = el SQL está pegado; `admin` = dueño
 * o administrador (por rol, como timbrar).
 */
export function accionesDe(c: CfdiVista, todos: CfdiVista[], ctx: { listo: boolean; admin: boolean; invoiceCfdiUuid: string | null }): Acciones {
  const estado = estadoPintado(c);
  const vigente = c.status === "valid" || c.status === "sustituido";
  const enCurso = c.cancellationStatus === "pending" || c.cancellationStatus === "verifying"
    || c.cancellationStatus === "enviando" || c.cancellationStatus === "incierto";
  const vigenteLibre = vigente && !enCurso && estado !== "cancelado";
  const puede = ctx.listo && ctx.admin && vigenteLibre;
  const sust = sustitutoDe(todos, c);
  const esLaDeLaFactura = c.tipoComprobante === "I" && !c.paymentId && ctx.invoiceCfdiUuid === c.uuid;
  const tieneNotas = c.tipoComprobante === "I" && notasDe(todos, c).length > 0;
  return {
    consultar: vigente,
    cancelar: puede && !tieneNotas && c.status === "valid",
    cancelarSustituido: puede && !!sust,
    sustituir: puede && esLaDeLaFactura && !tieneNotas && c.status === "valid",
    notaCredito: puede && c.tipoComprobante === "I" && c.status === "valid",
  };
}

/** Forma de pago SAT → método interno de la devolución (para el reembolso ligado). */
export function metodoDeDevolucionPorForma(forma: string): string {
  switch (forma) {
    case "01": return "cash";
    case "02": return "check";
    case "03": return "transfer";
    case "04": return "credit";
    case "28": return "debit";
    default: return "other";
  }
}

export const FORMAS_DEVOLUCION = FORMAS_PAGO_SAT;

const ES = {
  titulo: "CFDI ante el SAT",
  cargando: "Cargando…",
  sqlPendiente: (f: string) => `Cancelar y emitir notas de crédito desde aquí se enciende cuando se pegue ${f}. Mientras tanto: cancela en el panel de Facturapi y usa «Consultar estado en el SAT».`,
  tipoI: "Ingreso",
  tipoE: "Nota de crédito",
  porPago: "de un pago",
  estados: {
    vigente: "Vigente",
    sustituido: "Sustituido: sigue vigente hasta que se cancele (motivo 01)",
    cancelado: "Cancelado",
    pendiente: "Cancelación pendiente: el receptor tiene 3 días hábiles para aceptarla",
    verificando: "El SAT está procesando la cancelación",
    rechazada: "El receptor rechazó la cancelación (sigue vigente)",
    vencida: "La solicitud de cancelación venció (sigue vigente)",
    enviando: "Enviando la cancelación…",
    incierto: "No se sabe si la cancelación llegó al SAT: consulta el estado",
  } as Record<EstadoPintado, string>,
  sustituyeA: "Sustituye a",
  sustituidoPor: "Sustituido por",
  notaDe: "Nota de crédito de",
  consultar: "Consultar estado en el SAT",
  consultando: "Consultando…",
  cancelar: "Cancelar ante el SAT",
  cancelarSustituido: "Cancelar el anterior (motivo 01)",
  sustituir: "Sustituir CFDI (motivo 01)",
  notaCredito: "Nota de crédito",
  sinCambios: "Sin cambios: sigue igual en el SAT.",
  actualizado: "Estado actualizado desde el SAT.",
  liberada: "El CFDI quedó cancelado: la factura se puede volver a timbrar, cancelar o reembolsar.",
  // Diálogo de cancelación
  cTitulo: "Cancelar el CFDI ante el SAT",
  cMotivo: "Motivo del SAT",
  cRazon: "Por qué se cancela (queda en la bitácora)",
  cRazonPh: "Ej. la forma de pago salió como tarjeta de crédito y fue débito",
  cSustituto: "Se relaciona con el CFDI sustituto",
  cSin01: "Para el motivo 01 primero se timbra el CFDI que lo sustituye (botón «Sustituir CFDI»). Después vuelve aquí.",
  cAceptacion: "Esta cancelación pedirá la ACEPTACIÓN del receptor (el paciente o la empresa): tiene 3 días hábiles para aceptarla desde su buzón del SAT. Mientras tanto el CFDI sigue vigente y la factura sigue bloqueada.",
  cSinAceptacion: {
    monto: "No pedirá aceptación del receptor: el total es de hasta $1,000.",
    plazo: "No pedirá aceptación del receptor: se cancela a más tardar el día hábil siguiente a su emisión.",
    egreso: "No pedirá aceptación del receptor: es una nota de crédito (egreso).",
    publicoGeneral: "No pedirá aceptación del receptor: es a público en general o a extranjero.",
  } as Record<string, string>,
  cFueraPlazo: "Ojo: este CFDI es de un ejercicio cuya declaración anual ya pasó; el SAT puede rechazar la cancelación.",
  cIrreversible: "Cancelar un CFDI ante el SAT no se puede deshacer.",
  cBoton: "Pedir la cancelación",
  cEnviando: "Enviando…",
  cOkAceptada: "El SAT aceptó la cancelación.",
  cOkPendiente: "Cancelación enviada: queda pendiente de que el receptor la acepte.",
  cOkVerificando: "Cancelación enviada: el SAT la está procesando.",
  // Diálogo de nota de crédito
  nTitulo: "Nota de crédito (CFDI de egreso)",
  nAyuda: "Para una devolución o un descuento sobre un CFDI ya timbrado, sin cancelarlo. Se relaciona con el CFDI original (relación 01) y baja el total de la factura.",
  nMonto: "Monto (con IVA, si lo lleva)",
  nDisponible: "Disponible en este CFDI",
  nRazon: "Concepto / motivo (sale en el CFDI)",
  nRazonPh: "Ej. devolución por tratamiento no realizado",
  nDevolver: "Se le devuelve el dinero al paciente (registra el reembolso en la factura)",
  nForma: "Forma de pago de la devolución",
  nFormaBonif: "Forma de pago del CFDI original",
  nBoton: "Timbrar nota de crédito",
  nTimbrando: "Timbrando…",
  nOk: "Nota de crédito timbrada.",
  cancelarBtn: "Cerrar",
  error: "No se pudo completar.",
};

const EN: typeof ES = {
  titulo: "CFDI with the SAT",
  cargando: "Loading…",
  sqlPendiente: (f: string) => `Cancelling and issuing credit notes from here turns on once ${f} is applied. Meanwhile: cancel in the Facturapi dashboard and use «Check status with the SAT».`,
  tipoI: "Income",
  tipoE: "Credit note",
  porPago: "for a payment",
  estados: {
    vigente: "Valid",
    sustituido: "Replaced: still valid until cancelled (reason 01)",
    cancelado: "Cancelled",
    pendiente: "Cancellation pending: the receiver has 3 business days to accept it",
    verificando: "The SAT is processing the cancellation",
    rechazada: "The receiver rejected the cancellation (still valid)",
    vencida: "The cancellation request expired (still valid)",
    enviando: "Sending the cancellation…",
    incierto: "Unknown whether the cancellation reached the SAT: check the status",
  },
  sustituyeA: "Replaces",
  sustituidoPor: "Replaced by",
  notaDe: "Credit note for",
  consultar: "Check status with the SAT",
  consultando: "Checking…",
  cancelar: "Cancel with the SAT",
  cancelarSustituido: "Cancel the previous one (reason 01)",
  sustituir: "Replace CFDI (reason 01)",
  notaCredito: "Credit note",
  sinCambios: "No changes: same status at the SAT.",
  actualizado: "Status updated from the SAT.",
  liberada: "The CFDI is cancelled: the invoice can be stamped, cancelled or refunded again.",
  cTitulo: "Cancel the CFDI with the SAT",
  cMotivo: "SAT reason",
  cRazon: "Why it is cancelled (kept in the log)",
  cRazonPh: "E.g. payment form was credit card but it was debit",
  cSustituto: "Related to the replacement CFDI",
  cSin01: "For reason 01 the replacement CFDI is stamped first («Replace CFDI»). Then come back here.",
  cAceptacion: "This cancellation will need the RECEIVER's acceptance (patient or company): they have 3 business days to accept it in their SAT mailbox. Meanwhile the CFDI stays valid and the invoice stays locked.",
  cSinAceptacion: {
    monto: "No receiver acceptance needed: total up to $1,000.",
    plazo: "No receiver acceptance needed: cancelled no later than the next business day after issuance.",
    egreso: "No receiver acceptance needed: it is a credit note.",
    publicoGeneral: "No receiver acceptance needed: general public or foreign receiver.",
  },
  cFueraPlazo: "Note: this CFDI belongs to a fiscal year whose annual return is past; the SAT may reject the cancellation.",
  cIrreversible: "Cancelling a CFDI with the SAT cannot be undone.",
  cBoton: "Request cancellation",
  cEnviando: "Sending…",
  cOkAceptada: "The SAT accepted the cancellation.",
  cOkPendiente: "Cancellation sent: pending the receiver's acceptance.",
  cOkVerificando: "Cancellation sent: the SAT is processing it.",
  nTitulo: "Credit note (egress CFDI)",
  nAyuda: "For a refund or discount on an already stamped CFDI, without cancelling it. It is related to the original CFDI (relation 01) and lowers the invoice total.",
  nMonto: "Amount (tax included, if any)",
  nDisponible: "Available on this CFDI",
  nRazon: "Concept / reason (printed on the CFDI)",
  nRazonPh: "E.g. refund for treatment not performed",
  nDevolver: "Money is returned to the patient (records the refund on the invoice)",
  nForma: "Payment form of the refund",
  nFormaBonif: "Payment form of the original CFDI",
  nBoton: "Stamp credit note",
  nTimbrando: "Stamping…",
  nOk: "Credit note stamped.",
  cancelarBtn: "Close",
  error: "Could not complete it.",
};

export function textosCfdiSat(locale: string | null | undefined): typeof ES {
  return (locale ?? "").startsWith("en") ? EN : ES;
}
