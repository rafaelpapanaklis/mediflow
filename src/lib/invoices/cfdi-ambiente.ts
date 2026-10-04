// ¿En qué ambiente de Facturapi se timbró un CFDI? (ws1-t4, vuelta 2: F-14)
//
// `cfdi_records` no lo guardaba. Con producción en Live, un CFDI de PRUEBAS
// (sin validez ante el SAT) contaba como vigente: bloqueaba cancelar,
// reembolsar, anular, cambiar el precio y volver a timbrar esa factura. Caso
// real: F-000155 de la clínica de pruebas, timbrada en TEST en julio.
//
// Columna `cfdi_records.environment` ("test" | "live"), por SQL a mano
// (sql/ws1-t4-cfdi-ambiente.sql). NULL = no se sabe (CFDI de antes de la
// columna): cuenta como VIGENTE, lo conservador — un CFDI real que se tomara
// por prueba quedaría desprotegido.
//
// PURO (client-safe). La lectura de la base vive en cfdi-ambiente.server.ts.

export type AmbienteCfdi = "test" | "live";

export function normalizarAmbiente(v: unknown): AmbienteCfdi | null {
  return v === "test" || v === "live" ? v : null;
}

/**
 * ¿Este CFDI cuenta como vigente ante el SAT para bloquear cambios a la factura?
 *   · fuera de Live nada bloquea (como siempre: en pruebas nada llega al SAT);
 *   · en Live, un CFDI marcado «test» no es un comprobante fiscal: no bloquea;
 *   · «live» o sin marca (NULL, CFDI viejo): sí bloquea.
 */
export function cfdiBloqueaEnLive(args: { live: boolean; ambiente: AmbienteCfdi | null }): boolean {
  if (!args.live) return false;
  return args.ambiente !== "test";
}
