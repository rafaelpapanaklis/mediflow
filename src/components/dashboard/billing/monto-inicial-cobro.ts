// ronda 3 (ws1-t2, H6) — puro, sin React: con qué arranca el campo «Monto a
// cobrar» de PaymentModal. `montoSugerido` (la mensualidad, o lo vencido de
// esa factura — lo pasa quien abre el modal desde una cuota concreta) manda
// si viene y es positivo; si no, el saldo completo de la factura, como
// siempre (Registrar pago de una factura suelta, sin cuota de por medio).
//
// Antes de esto, "Cobrar" de una mensualidad SIEMPRE precargaba el saldo
// COMPLETO del tratamiento (H6): cobrar la cuota de $2,000 de un plan de
// $36,000 abría el campo en $36,000 (o lo que quedara del saldo), y si
// recepción no lo corría a mano, registraba de más.
//
// Nunca por encima del saldo real: un sugerido mayor (no debería pasar,
// pero una cuota vencida de otro periodo o un dato corrupto no debe hacer
// que el campo nazca ya en "sobrepago").
export function montoInicialDeCobro(montoSugerido: number | undefined, balance: number): number {
  const saldo = Math.max(0, balance || 0);
  if (montoSugerido != null && montoSugerido > 0) return Math.min(montoSugerido, saldo);
  return saldo;
}
