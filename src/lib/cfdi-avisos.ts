// Qué respuestas de error de POST /api/cfdi se tienen que QUEDAR en pantalla
// hasta que la persona las cierre, en vez de salir en un toast de 5 segundos.
//
// Archivo puro (sin React ni Prisma): lo comparten los dos formularios de
// timbrado (`invoice-detail-modal.tsx` y `billing-client.tsx`) para que la lista
// viva en un solo sitio. Hallazgo H-9 de la auditoría WhatsApp/SAT (ws1-t8):
// `CFDI_TIMBRADO_SIN_GUARDAR` — «el CFDI SÍ se timbró (UUID …), no lo vuelvas a
// timbrar» — no estaba en ninguna de las dos listas y se iba solo.

/** El CFDI ya existe ante el SAT aunque el panel no lo haya podido guardar. */
export const CFDI_TIMBRADO_SIN_GUARDAR = "CFDI_TIMBRADO_SIN_GUARDAR";

export const CFDI_AVISOS_PERSISTENTES: readonly string[] = [
  "CFDI_TOTAL_MISMATCH",
  "CFDI_LIVE_NOT_READY",
  CFDI_TIMBRADO_SIN_GUARDAR,
  // ws1-t4, tanda 0: dicen QUÉ hacer (emitirla por fuera, facturar pago por
  // pago, escoger la forma): un toast de 5 s no alcanza para leerlo.
  "CFDI_RETENCION_PENDIENTE",
  "CFDI_CON_SALDO",
  "CFDI_CON_SALDO_A_PLAZOS",
  "CFDI_FORMA_PAGO_REQUERIDA",
  // ws1-t4, vuelta 2 (F-12): «no se sabe si se timbró» se queda en pantalla con
  // «Reintentar sin duplicar» (misma idempotency_key de Facturapi).
  "CFDI_TIMBRE_INCIERTO",
  "CFDI_EN_CURSO",
  "CFDI_RECEPTOR_EXTRANJERO",
  // Auditoría de uso (ws1-t4): el receptor contra el SAT (C-47), la global del mes anterior
  // (C-49) y el motivo 03 con cobro (C-42) dicen qué corregir: se quedan a la vista.
  "CFDI_RECEPTOR_INVALIDO",
  "CFDI_CONFIRMAR_GLOBAL",
  "MOTIVO_03_CON_COBRO",
];

/**
 * ¿Este aviso ofrece «Reintentar sin duplicar»? El reintento reusa el apartado
 * de la factura y la misma llave de idempotencia: si el CFDI ya salió, Facturapi
 * devuelve ESE y no timbra otro.
 */
export function cfdiReintentable(code: unknown): boolean {
  return code === "CFDI_TIMBRE_INCIERTO" || code === "CFDI_EN_CURSO";
}

/** ¿Este código de error va en el aviso que no desaparece solo? */
export function cfdiAvisoPersistente(code: unknown): boolean {
  return typeof code === "string" && CFDI_AVISOS_PERSISTENTES.includes(code);
}

/**
 * ¿Con este aviso a la vista hay que impedir otro intento? Solo cuando el CFDI
 * ya se timbró: volver a pulsar emitiría un SEGUNDO comprobante, que cuesta
 * dinero y hay que cancelar ante el SAT.
 */
export function cfdiImpideReintento(code: unknown): boolean {
  return code === CFDI_TIMBRADO_SIN_GUARDAR;
}
