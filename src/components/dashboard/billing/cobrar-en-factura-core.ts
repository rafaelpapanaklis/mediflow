// ws1-t4 — «Cobrar» SIEMPRE abre la ventana completa de la factura
// (`InvoiceDetailModal`), nunca la ventana de cobro suelta (`PaymentModal`).
// Puro, sin React: las dos decisiones que toma la ventana completa cuando la
// abre un botón de cobro, para poder probarlas sin montar nada.

/**
 * Con qué monto nace «Monto a cobrar». Si quien abre ya sabe qué se cobra
 * (la cuota vencida del caso, la mensualidad de un hermano, el control…)
 * manda SU número, aunque sea 0 (= «ya lo calculé: el saldo»): es el mismo
 * que antes le pasaba a la ventana suelta. Sin él (`undefined`/`null`), el
 * cálculo propio de la factura. El clampeo al saldo lo hace después
 * `montoInicialDeCobro`, igual que siempre.
 */
export function montoDelCobroAlAbrir(deQuienAbre: number | null | undefined, propio: number): number {
  if (deQuienAbre != null && Number.isFinite(deQuienAbre)) return deQuienAbre;
  return propio;
}

/** Estados en los que la ventana completa ofrece registrar un pago. */
export const ESTADOS_COBRABLES = ["PENDING", "PARTIAL", "OVERDUE"] as const;

/**
 * Sin el diseño nuevo, el cobro no vive dentro de la ventana completa: se
 * abre ENCIMA la ventana de cobro de siempre. Solo si:
 *  · la abrió un botón de cobro (`abrirCobro`);
 *  · no hay diseño nuevo (con él el panel «Registrar pago» ya está dentro);
 *  · la sesión puede cobrar (el permiso real, que arranca en false);
 *  · la cita no se canceló con dinero pendiente de decidir (H15);
 *  · la factura está pendiente/parcial/vencida. Un BORRADOR no: confirmarlo
 *    es una escritura y se hace con «Cobrar ahora» del pie, a mano.
 */
export function abrirCobroClasicoAlAbrir(p: {
  abrirCobro: boolean;
  rediseno: boolean;
  puedeCobrar: boolean;
  citaCanceladaConDinero: boolean;
  status: string | null | undefined;
}): boolean {
  if (!p.abrirCobro || p.rediseno || !p.puedeCobrar || p.citaCanceladaConDinero) return false;
  return (ESTADOS_COBRABLES as readonly string[]).includes(p.status ?? "");
}

/** Nombre del paciente a partir de la factura que devuelve GET /api/invoices/:id. */
export function nombreDelPacienteDeFactura(f: { patient?: { firstName?: string | null; lastName?: string | null } | null } | null | undefined): string {
  const p = f?.patient;
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
}
