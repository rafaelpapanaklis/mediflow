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
];

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
