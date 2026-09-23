/**
 * «Historial de facturas» de Configuración → Suscripción: las piezas PURAS con
 * las que `GET /api/billing/invoices` arma los renglones. Sin prisma, sin
 * Stripe y sin `server-only`: el tipo lo comparte la pantalla y las reglas se
 * prueban sin base.
 *
 * Tres fuentes, y cada pago sale UNA vez:
 *
 *  1. Facturas de Stripe (`stripe.invoices.list`) — la suscripción cobrada con
 *     tarjeta. MANDAN cuando coinciden con una fila local: traen el PDF y el
 *     estado vivo de Stripe (una factura reintentada que acabó cobrándose).
 *  2. `subscription_invoices` — el registro local. El webhook guarda ahí CADA
 *     factura de Stripe con `reference = invoice.id`, así que sin cruzarlas el
 *     mismo cobro salía dos veces. Solo sobreviven las que Stripe no devolvió:
 *     pagos manuales (SPEI/OXXO/admin), adeudos de CFDI, facturas más viejas que
 *     las 24 que se piden, o todas si Stripe no contesta.
 *  3. El saldo de IA (`ai_wallet_transactions` + `ai_topups`). Una recarga se
 *     cobra con un checkout `mode: "payment"`: en Stripe es un CARGO, no una
 *     factura, y no es una `subscription_invoice`. Antes no aparecía en ningún
 *     lado.
 */

export type EstadoFactura = "paid" | "pending" | "overdue" | "failed" | "void";

/** Por dónde entró el dinero de una recarga de saldo IA. */
export type ViaRecarga = "card" | "mercadopago" | "spei" | "manual";

export interface BillingInvoiceRow {
  id: string;
  date: string;          // ISO
  amount: number;        // unidades enteras (MXN, USD, etc.)
  currency: string;      // upper-case
  status: EstadoFactura;
  description: string;
  source: "stripe" | "local" | "wallet";
  /** Qué es cada renglón: la suscripción de la plataforma o una recarga de saldo IA. */
  kind: "subscription" | "aiTopup";
  /** Solo en recargas: por dónde entró el dinero. `null` en la suscripción. */
  topupVia: ViaRecarga | null;
  downloadUrl: string | null;
  /** Recibo de Stripe de una recarga con tarjeta (página de Stripe, no PDF). */
  receiptUrl: string | null;
  paymentUrl: string | null;
}

/** Concepto de una recarga. La pantalla lo traduce por `kind`; esto es el respaldo. */
export const CONCEPTO_RECARGA = "Recarga de saldo IA";

// ── 1. Stripe ───────────────────────────────────────────────────────────────

/** Lo que se usa de una `Stripe.Invoice` (estructural, para no depender del SDK). */
export interface FacturaStripe {
  id: string;
  number?: string | null;
  created: number;
  status?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  total?: number | null;
  currency?: string | null;
  description?: string | null;
  lines: { data: Array<{ description?: string | null }> };
  invoice_pdf?: string | null;
  hosted_invoice_url?: string | null;
}

export function filaDeFacturaStripe(inv: FacturaStripe): BillingInvoiceRow {
  return {
    id: `stripe:${inv.id}`,
    date: new Date(((inv.status_transitions?.paid_at ?? inv.created)) * 1000).toISOString(),
    amount: (inv.amount_due ?? inv.amount_paid ?? inv.total ?? 0) / 100,
    currency: (inv.currency ?? "mxn").toUpperCase(),
    status: normalizeStatus(inv.status ?? "open"),
    description:
      inv.lines.data[0]?.description ??
      inv.description ??
      `Suscripción — ${new Date(inv.created * 1000).toLocaleDateString("es-MX", { month: "long", year: "numeric" })}`,
    source: "stripe",
    kind: "subscription",
    topupVia: null,
    downloadUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null,
    receiptUrl: null,
    paymentUrl: (inv.status === "open" || inv.status === "uncollectible") ? (inv.hosted_invoice_url ?? null) : null,
  };
}

// ── 2. subscription_invoices ────────────────────────────────────────────────

export interface FacturaLocal {
  id: string;
  amount: number;
  currency: string | null;
  status: string;
  reference: string | null;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

/** Marca que deja `/api/admin/billing` (refund_payment) en `notes` de la fila local. */
const MARCA_REEMBOLSO = /^\[REEMBOLSADO[^\]]*\]/;

/**
 * La suscripción, UN renglón por pago. Cruza cada factura de Stripe con sus
 * filas locales por `reference`: el webhook la guarda con el `invoice.id`
 * (`recordStripeInvoice`), y un alta manual desde /admin puede haber usado el
 * número visible de la factura (`ANLFCA6H-0001`).
 *
 * Cuando coinciden, MANDA STRIPE (trae el PDF y el estado vivo), con dos
 * salvedades para no esconder lo que la fila local sabe y Stripe no:
 *  - La local dice «pagada» y la de Stripe no (se cobró por SPEI una factura
 *    que en Stripe sigue abierta o se anuló): sale la local. Si no, la clínica
 *    vería «Pagar» sobre algo que ya pagó.
 *  - Administración la reembolsó (`[REEMBOLSADO $X]` en `notes`): sale la de
 *    Stripe, que sigue «paid», con esa marca en el concepto.
 * Una fila local sin referencia, o con una que Stripe no devolvió (pagos
 * manuales, adeudos de CFDI, facturas más viejas que las 24 que se piden),
 * se queda: es otro pago.
 */
export function unirSuscripcion(
  facturasStripe: readonly FacturaStripe[],
  locales: readonly FacturaLocal[],
): BillingInvoiceRow[] {
  const porClave = new Map<string, string>(); // id o número → invoice.id
  for (const inv of facturasStripe) {
    porClave.set(inv.id, inv.id);
    if (inv.number) porClave.set(inv.number, inv.id);
  }
  const cruzadas = new Map<string, FacturaLocal[]>(); // invoice.id → filas locales
  const sueltas: FacturaLocal[] = [];
  for (const r of locales) {
    const invId = r.reference ? porClave.get(r.reference.trim()) : undefined;
    if (invId) cruzadas.set(invId, [...(cruzadas.get(invId) ?? []), r]);
    else sueltas.push(r);
  }

  const filas: BillingInvoiceRow[] = [];
  for (const inv of facturasStripe) {
    const suyas = cruzadas.get(inv.id) ?? [];
    const pagadaAqui = suyas.find((r) => normalizeStatus(r.status) === "paid");
    if (pagadaAqui && normalizeStatus(inv.status ?? "open") !== "paid") {
      filas.push(filaDeFacturaLocal(pagadaAqui));
      continue;
    }
    const fila = filaDeFacturaStripe(inv);
    const reembolso = suyas.map((r) => r.notes?.match(MARCA_REEMBOLSO)?.[0]).find(Boolean);
    if (reembolso) fila.description = `${fila.description} ${reembolso}`;
    filas.push(fila);
  }
  for (const r of sueltas) filas.push(filaDeFacturaLocal(r));
  return filas;
}

export function filaDeFacturaLocal(r: FacturaLocal): BillingInvoiceRow {
  return {
    id: `local:${r.id}`,
    date: (r.paidAt ?? r.createdAt).toISOString(),
    amount: r.amount,
    currency: (r.currency ?? "MXN").toUpperCase(),
    status: normalizeStatus(r.status),
    description: r.notes ?? `Plan — ${formatPeriod(r.periodStart, r.periodEnd)}`,
    source: "local",
    kind: "subscription",
    topupVia: null,
    downloadUrl: null,
    receiptUrl: null,
    paymentUrl: null,
  };
}

// ── 3. Saldo de IA ──────────────────────────────────────────────────────────

/** Un asiento del libro mayor del monedero (`ai_wallet_transactions`). */
export interface MovimientoSaldo {
  id: string;
  type: string;        // TOPUP | CHARGE | REFUND | ADJUSTMENT
  amountCents: number;
  source: string;      // STRIPE | MERCADOPAGO | SPEI | USAGE | ADMIN
  reference: string | null;
  createdAt: Date;
}

/**
 * Qué asientos del libro mayor son dinero que ENTRÓ al saldo — el `where` de
 * la consulta. TOPUP solo lo escriben los caminos de pasarela (webhook de
 * Stripe, webhook de Mercado Pago, confirmación de un comprobante SPEI);
 * ADJUSTMENT solo lo escribe `/api/admin/ai-billing/adjust` (abono a mano), y
 * puede ser negativo (un cargo del admin), por eso el `gt: 0`. CHARGE es
 * consumo del bot y REFUND no lo escribe nadie hoy.
 */
export function whereRecargasDelSaldo(clinicId: string) {
  return {
    clinicId,
    OR: [
      { type: "TOPUP" as const },
      { type: "ADJUSTMENT" as const, amountCents: { gt: 0 } },
    ],
  };
}

const VIA_POR_ORIGEN: Record<string, ViaRecarga> = {
  STRIPE: "card",
  MERCADOPAGO: "mercadopago",
  SPEI: "spei",
};

/**
 * Un asiento del saldo → un renglón «Recarga de saldo IA», pagado.
 *
 * Recarga pagada vs. abonada a mano: la distingue el TIPO del asiento, no una
 * nota. TOPUP = entró por una pasarela (su `source` dice cuál). ADJUSTMENT =
 * lo abonó administración a mano (así se arregló el pago de BEVADENT que el
 * webhook no acreditó): sale igual, «Pagada», pero como abono manual y sin
 * comprobante — ese asiento no tiene ninguno propio.
 *
 * El recibo solo se enlaza si la referencia es un PaymentIntent de Stripe
 * (`pi_…`) que aparece entre los cargos del propio customer de la clínica:
 * nunca se arma una URL a mano, así que no hay botón que dé 404.
 */
export function filaDeRecarga(
  m: MovimientoSaldo,
  recibos: ReadonlyMap<string, string>,
): BillingInvoiceRow | null {
  if (!(m.amountCents > 0)) return null;
  let via: ViaRecarga;
  if (m.type === "ADJUSTMENT") via = "manual";
  else if (m.type === "TOPUP") via = VIA_POR_ORIGEN[m.source] ?? "manual";
  else return null;

  return {
    id: `wallet:${m.id}`,
    date: m.createdAt.toISOString(),
    amount: m.amountCents / 100,
    currency: "MXN",
    status: "paid",
    description: CONCEPTO_RECARGA,
    source: "wallet",
    kind: "aiTopup",
    topupVia: via,
    downloadUrl: null,
    receiptUrl: (m.reference && recibos.get(m.reference)) || null,
    paymentUrl: null,
  };
}

/** Recarga por SPEI con el comprobante subido y todavía sin confirmar (`ai_topups` PENDING). */
export interface RecargaSpeiEnRevision {
  id: string;
  amountCents: number;
  createdAt: Date;
}

/**
 * La clínica dice que ya transfirió y el saldo aún no entra: sale «Pendiente».
 * Cuando administración la confirma, el topup pasa a PAID y aparece su asiento
 * TOPUP/SPEI — este renglón se va y queda ese, así que tampoco se duplica.
 * (Las PENDING de Mercado Pago no se muestran: son checkouts que se abrieron
 * y se abandonaron, no pagos.)
 */
export function filaDeSpeiEnRevision(t: RecargaSpeiEnRevision): BillingInvoiceRow {
  return {
    id: `topup:${t.id}`,
    date: t.createdAt.toISOString(),
    amount: t.amountCents / 100,
    currency: "MXN",
    status: "pending",
    description: CONCEPTO_RECARGA,
    source: "wallet",
    kind: "aiTopup",
    topupVia: "spei",
    downloadUrl: null,
    receiptUrl: null,
    paymentUrl: null,
  };
}

/** ¿La referencia de un asiento es un PaymentIntent de Stripe? */
export function esPagoStripe(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("pi_");
}

/** Lo que se usa de un `Stripe.Charge`. */
export interface CargoStripe {
  payment_intent: string | { id: string } | null;
  receipt_url: string | null;
  status?: string | null;
}

/** PaymentIntent → URL del recibo que Stripe emitió para ese cargo. */
export function recibosPorPago(cargos: readonly CargoStripe[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cargos) {
    if (c.status && c.status !== "succeeded") continue;
    const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
    if (pi && c.receipt_url && !out.has(pi)) out.set(pi, c.receipt_url);
  }
  return out;
}

// ── Lo que pinta la pantalla ────────────────────────────────────────────────

const CLAVE_VIA: Record<ViaRecarga, string> = {
  card: "shell.subscriptionTab.topupViaCard",
  mercadopago: "shell.subscriptionTab.topupViaMercadopago",
  spei: "shell.subscriptionTab.topupViaSpei",
  manual: "shell.subscriptionTab.topupViaManual",
};

/**
 * Textos de la celda «Concepto»: el concepto y una etiqueta que dice QUÉ es el
 * renglón (una suscripción y una recarga no son lo mismo), más, en una
 * recarga, por dónde entró el dinero. Lo usan la pestaña de siempre y la del
 * rediseño, para que digan lo mismo.
 */
export function textosDeFila(
  inv: Pick<BillingInvoiceRow, "kind" | "description" | "topupVia">,
  t: (key: string) => string,
): { concepto: string; etiqueta: string; detalle: string | null } {
  if (inv.kind === "aiTopup") {
    return {
      concepto: t("shell.subscriptionTab.aiTopupConcept"),
      etiqueta: t("shell.subscriptionTab.kindAiTopup"),
      detalle: inv.topupVia ? t(CLAVE_VIA[inv.topupVia]) : null,
    };
  }
  return {
    concepto: inv.description,
    etiqueta: t("shell.subscriptionTab.kindSubscription"),
    detalle: null,
  };
}

// ── Utilidades ──────────────────────────────────────────────────────────────

export function ordenarPorFecha(filas: BillingInvoiceRow[]): BillingInvoiceRow[] {
  return filas.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function normalizeStatus(raw: string): EstadoFactura {
  const s = raw.toLowerCase();
  if (s === "paid") return "paid";
  if (s === "void" || s === "voided") return "void";
  if (s === "failed" || s === "uncollectible") return "failed";
  if (s === "overdue") return "overdue";
  return "pending"; // open, draft, pending, etc.
}

function formatPeriod(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" });
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return fmt.format(start);
  }
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}
