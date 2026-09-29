// «Registrar anticipo recibido» — con qué número abre el campo del monto (H16
// de la revisión final, ws1-t4). Puro.
//
// EL FALLO. Sin un anticipo pendiente cargado, el campo se prellenaba con el
// SALDO de la factura. Con el servidor lento, el pendiente ($100) llegaba
// tarde, el campo salía en $600 y quien pulsaba «Registrar» metía $600 en
// efectivo como anticipo: la factura quedó PAGADA con dinero que no existía.
//
// LA REGLA. Solo se prellena con el anticipo PENDIENTE (lo que ya se pidió y
// es lo que casi siempre llega), y nunca por encima del saldo. Sin pendiente,
// el campo sale VACÍO: el monto lo teclea la persona.
export function montoInicialAnticipoRecibido(
  pendiente: { amount: number } | null | undefined,
  saldo: number,
): string {
  const monto = pendiente && Number.isFinite(pendiente.amount) && pendiente.amount > 0 ? pendiente.amount : 0;
  if (!(monto > 0)) return "";
  const tope = Number.isFinite(saldo) && saldo > 0 ? Math.min(monto, saldo) : monto;
  return String(Math.round(tope * 100) / 100);
}
