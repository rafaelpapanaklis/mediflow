/**
 * El sufijo fiscal del precio de una tarjeta de plan (ws1-t9, QA de Chrome del
 * 20-oct): «MXN/mes + IVA» o «MXN/mes · sin IVA».
 *
 * Antes la tarjeta del plan que una clínica exenta conserva (iva-cobro.ts:
 * creada antes del 26-sep, en SU plan) salía con un «MXN/mes» pelado al lado
 * de dos «+ IVA», y parecía un olvido. Poner «+ IVA» ahí sería falso —ese
 * cobro va sin IVA—, así que cada tarjeta dice lo suyo, con el mismo formato.
 * La línea «Plan Clínica — … · sin IVA (lo conservas desde tu alta)» de arriba
 * ya explica el porqué.
 */
export function sufijoIvaTarjeta(conIva: boolean, sinIvaTexto: string): string {
  return conIva ? " + IVA" : ` · ${sinIvaTexto}`;
}
