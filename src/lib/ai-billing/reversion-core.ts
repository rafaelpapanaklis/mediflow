/**
 * Núcleo PURO de los reembolsos y contracargos de recargas (H3 de la auditoría
 * del 22-sep-2026): sin Prisma, sin red y sin `server-only`
 * (`npm run test:ai-reembolsos`). `reversion.ts` lo envuelve con la base.
 *
 * Hasta aquí, una clínica que recargaba $200 y pedía el reembolso (o abría una
 * disputa con su banco) recuperaba el dinero y se quedaba con el saldo.
 *
 * El modelo es «cuadrar contra un OBJETIVO», no «restar lo que dice el evento»:
 *
 *   objetivo    = lo que HOY está devuelto o retenido de esa recarga, según la
 *                 pasarela (se le pregunta a ella, no se fía del evento)
 *   yaRevertido = lo que ya se descontó por esa recarga (movimientos REFUND)
 *   delta       = objetivo − yaRevertido   → se descuenta (o se devuelve) eso
 *
 * Por eso el mismo reembolso que llega tres veces descuenta una sola vez (la
 * segunda da delta 0), un reembolso parcial y luego otro suman bien (el objetivo
 * es acumulado), dos eventos que llegan al revés no se pisan, y una disputa que
 * se gana devuelve el saldo sola (el objetivo vuelve a bajar).
 */

/** Estados de una disputa de Stripe en los que Stripe YA nos quitó el dinero. */
export const DISPUTA_CON_FONDOS_RETIRADOS: ReadonlySet<string> = new Set(["needs_response", "under_review", "lost"]);

/**
 * Objetivo de una recarga de Stripe.
 *
 * Disputas: se actúa AL ABRIRSE, no al resolverse. Stripe retira el dinero de
 * nuestra cuenta en cuanto se abre la disputa (`needs_response`) y lo devuelve
 * solo si se gana; la resolución tarda de 60 a 75 días, y esperar a perderla
 * dejaría a la clínica gastar mientras tanto un saldo que ya no está pagado. Si
 * se gana (`won`), el objetivo vuelve a 0 y el saldo se devuelve. Los avisos
 * previos (`warning_*`, consultas del banco) y `prevented` no retiran dinero:
 * no cuentan.
 */
export function objetivoReversionStripe(p: {
  recargaCents: number;
  /** Suma de `amount_refunded` de los cargos del PaymentIntent (acumulado). */
  reembolsadoCents: number;
  disputas: ReadonlyArray<{ amount: number; status: string }>;
}): { objetivoCents: number; reembolsoCents: number; disputaCents: number } {
  const reembolsoCents = Math.max(0, Math.floor(p.reembolsadoCents));
  const disputaCents = p.disputas
    .filter((d) => DISPUTA_CON_FONDOS_RETIRADOS.has(d.status))
    .reduce((s, d) => s + Math.max(0, Math.floor(d.amount)), 0);
  return {
    objetivoCents: acotar(reembolsoCents + disputaCents, p.recargaCents),
    reembolsoCents,
    disputaCents,
  };
}

/**
 * Objetivo de una recarga de Mercado Pago, con el pago tal como lo devuelve su
 * API. Un reembolso parcial deja el pago `approved` con
 * `transaction_amount_refunded` > 0; el total lo pasa a `refunded`. Una
 * reclamación abierta es `in_mediation` (MP retiene el dinero: se actúa al
 * abrirse, igual que en Stripe) y un contracargo es `charged_back`, salvo
 * `status_detail = reimbursed`, que es cuando MP nos cubrió y el dinero se quedó.
 */
export function objetivoReversionMp(p: {
  recargaCents: number;
  status: string;
  statusDetail: string | null;
  /** `transaction_amount_refunded` de MP, en pesos (float). */
  reembolsadoPesos: number | null;
}): { objetivoCents: number; motivo: "reembolso" | "contracargo" | "reclamacion" | null } {
  const recarga = Math.max(0, Math.floor(p.recargaCents));
  const parcial = p.reembolsadoPesos != null && p.reembolsadoPesos > 0 ? Math.round(p.reembolsadoPesos * 100) : 0;
  if (p.status === "refunded") return { objetivoCents: recarga, motivo: "reembolso" };
  if (p.status === "charged_back" && p.statusDetail !== "reimbursed") {
    return { objetivoCents: recarga, motivo: "contracargo" };
  }
  if (p.status === "in_mediation") return { objetivoCents: recarga, motivo: "reclamacion" };
  return { objetivoCents: acotar(parcial, recarga), motivo: parcial > 0 ? "reembolso" : null };
}

/**
 * Cuánto mover el saldo. Positivo = descontar; negativo = devolver (una disputa
 * ganada, un reembolso que falló). 0 = ya está cuadrado: el evento repetido.
 */
export function deltaReversion(objetivoCents: number, yaRevertidoCents: number): number {
  return Math.floor(objetivoCents) - Math.floor(yaRevertidoCents);
}

function acotar(cents: number, recargaCents: number): number {
  return Math.min(Math.max(0, Math.floor(cents)), Math.max(0, Math.floor(recargaCents)));
}
