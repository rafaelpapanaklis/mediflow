// Ortodoncia — «Pago por control»: el control registrado desde la ficha SIN cita de hoy
// también se factura (ws1-t10, hallazgo #1 de la revisión final de ws1-t9). Una factura
// de control normal cuelga de su CITA (`appointmentId`); esta no tiene cita, así que se
// reconoce por una marca al inicio de sus notas, que además evita facturar dos veces la
// misma hoja. Puro.

export const PREFIJO_MARCA_CONTROL_SIN_CITA = "[control-hoja:";

/** La marca de UNA hoja de control: `[control-hoja:<id de la hoja>]`. */
export function marcaDeControlDeHoja(cardId: string): string {
  return `${PREFIJO_MARCA_CONTROL_SIN_CITA}${cardId}]`;
}

/** Las notas de la factura de un control sin cita: la marca y una frase legible. */
export function notaDeControlSinCita(cardId: string): string {
  return `${marcaDeControlDeHoja(cardId)} Control de ortodoncia registrado desde la ficha, sin cita.`;
}

/** ¿Esta factura es el cobro de un control registrado sin cita? */
export function esFacturaDeControlSinCita(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith(PREFIJO_MARCA_CONTROL_SIN_CITA);
}
