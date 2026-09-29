// ws1-t4 — QUÉ factura cobra el «Cobrar» principal de un caso de ortodoncia y
// con qué monto nace el pago. Puro, sin React ni base.
//
// Lo usan los dos «Cobrar» del caso que no apuntan a una cuota concreta: el de
// la Sección F («Cobrar · $X») y el de la cabecera de la pestaña Ortodoncia.
// Una sola regla para que los dos abran la MISMA factura con el MISMO número.
//
//  · «Pago por control» con controles que se deben (ws1-t4 #77): el primero,
//    por su saldo. Si no, la factura del caso (en «pago por control», solo si
//    aún debe: la colocación casi siempre ya está pagada).
//  · Monto (ronda 3, ws1-t2, H6): TODO lo vencido; si no hay, la cuota de hoy;
//    si tampoco, 0 (= el saldo completo, lo decide la ventana de cobro).

export interface FacturaDeCobro {
  id: string;
  balance: number;
}

export interface ControlDeCobro {
  invoiceId: string;
  balance: number;
}

export interface PanelParaCobro {
  billingMode: string;
  controlesPorCobrar?: ControlDeCobro[] | null;
  invoice: FacturaDeCobro | null;
  cobranza: {
    vencidas: { falta: number }[];
    cuotaDeHoy?: { falta: number } | null;
  } | null;
}

export interface CobroPrincipal {
  invoiceId: string;
  montoSugerido: number;
}

export function montoDelCobroPrincipal(panel: PanelParaCobro): number {
  const esPorControl = panel.billingMode === "PAGO_POR_CONTROL";
  const controles = esPorControl ? panel.controlesPorCobrar ?? [] : [];
  if (esPorControl && controles.length > 0) return controles[0].balance;
  if (!panel.cobranza) return 0;
  return panel.cobranza.vencidas.reduce((acc, q) => acc + q.falta, 0) || panel.cobranza.cuotaDeHoy?.falta || 0;
}

/** `null` = no hay nada que cobrar con el «Cobrar» principal. */
export function cobroPrincipalDelCaso(panel: PanelParaCobro): CobroPrincipal | null {
  const esPorControl = panel.billingMode === "PAGO_POR_CONTROL";
  const controles = esPorControl ? panel.controlesPorCobrar ?? [] : [];
  const invoiceId = esPorControl && controles.length > 0
    ? controles[0].invoiceId
    : panel.invoice && (!esPorControl || panel.invoice.balance > 0.004) ? panel.invoice.id : null;
  if (!invoiceId) return null;
  return { invoiceId, montoSugerido: montoDelCobroPrincipal(panel) };
}
