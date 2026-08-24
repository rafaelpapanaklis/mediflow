/**
 * DaleControl BARBER — núcleo PURO de anticipos y pagos del CLIENTE FINAL
 * (client-safe: sin prisma, sin Stripe, sin "server-only").
 *
 * ⚠️ FRONTERA CON LA SUSCRIPCIÓN DEL SaaS (T6)
 * Este módulo NO sabe nada del cobro que DaleControl le hace a la barbería.
 * Aquí solo vive el dinero que el CLIENTE FINAL le paga a la BARBERÍA:
 * su membresía y su anticipo. T6 es dueño de src/lib/barber/billing.ts y de
 * /api/barber/stripe/**; nosotros de src/lib/barber/payments.ts y de
 * /api/barber/payments/**. Dos webhooks, dos secretos, CERO tipos de evento
 * compartidos (ver BARBER_PAYMENTS_WEBHOOK_EVENTS abajo).
 */
import {
  centsToNumber,
  formatCents,
  moneyToCents,
  percentOfCents,
} from "@/lib/barber/memberships-core";

// ═══════════════════════════════════════════════════════════════════════
// Frontera de webhooks — la lista que hace imposible el doble procesamiento
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los ÚNICOS tipos de evento que escucha /api/barber/payments/webhook.
 * Todo lo de suscripciones del SaaS (checkout.session.*, customer.subscription.*,
 * invoice.*) queda FUERA a propósito: es de T6 y de /api/stripe/webhook del
 * dental. La renovación de una membresía en Stripe se detecta por el
 * PaymentIntent de su factura (pi.invoice → subscription.metadata), no por
 * invoice.paid — así ningún evento vive en los dos endpoints.
 */
export const BARBER_PAYMENTS_WEBHOOK_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
] as const;

/**
 * Eventos que NO son nuestros. Existe para que la prueba de contrato
 * demuestre que las dos listas no se tocan.
 */
export const BARBER_FOREIGN_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
] as const;

export function isOurWebhookEvent(type: string): boolean {
  return (BARBER_PAYMENTS_WEBHOOK_EVENTS as readonly string[]).includes(type);
}

// ═══════════════════════════════════════════════════════════════════════
// Metadata: el namespace `dcb` marca lo que es nuestro dentro de la cuenta
// ═══════════════════════════════════════════════════════════════════════

export const DCB_META_KEY = "dcb";
export const DCB_KIND_DEPOSIT = "deposit";
export const DCB_KIND_MEMBERSHIP = "membership";

export interface DcbMetadata {
  [DCB_META_KEY]?: string;
  dcbShop?: string;
  dcbAppt?: string;
  dcbClient?: string;
  dcbPlan?: string;
}

export function buildDepositMetadata(args: {
  barbershopId: string;
  appointmentId: string;
  clientId?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {
    [DCB_META_KEY]: DCB_KIND_DEPOSIT,
    dcbShop: args.barbershopId,
    dcbAppt: args.appointmentId,
  };
  if (args.clientId) out.dcbClient = args.clientId;
  return out;
}

export function buildMembershipMetadata(args: {
  barbershopId: string;
  clientId: string;
  membershipId: string;
}): Record<string, string> {
  return {
    [DCB_META_KEY]: DCB_KIND_MEMBERSHIP,
    dcbShop: args.barbershopId,
    dcbClient: args.clientId,
    dcbPlan: args.membershipId,
  };
}

export type BarberPaymentIntentKind =
  | "deposit"
  | "membership"
  | "membership_invoice"
  | "ignore";

/**
 * Clasifica un PaymentIntent SIN llamar a Stripe. La cuenta de Stripe es la
 * misma que usa el SaaS, así que nuestro endpoint también recibe los
 * PaymentIntents de T6: todo lo que no traiga nuestro namespace `dcb` se
 * IGNORA. Si viene de una factura de suscripción hay que resolver la
 * suscripción (membership_invoice) antes de decidir.
 */
export function classifyPaymentIntent(pi: {
  metadata?: Record<string, string> | null;
  invoice?: string | { id?: string } | null;
}): BarberPaymentIntentKind {
  const kind = pi?.metadata?.[DCB_META_KEY];
  if (kind === DCB_KIND_DEPOSIT) return "deposit";
  if (kind === DCB_KIND_MEMBERSHIP) return "membership";
  if (pi?.invoice) return "membership_invoice";
  return "ignore";
}

// ═══════════════════════════════════════════════════════════════════════
// Política de anticipos — la configura cada barbería
// ═══════════════════════════════════════════════════════════════════════

/** FIXED = monto fijo. PERCENT = porcentaje del total de servicios. */
export type BarberDepositMode = "FIXED" | "PERCENT";

/**
 * A quién se le pide anticipo:
 *  ALL     → a todos.
 *  NEW     → solo a quien nunca ha completado una visita aquí.
 *  NO_SHOW → solo a quien YA faltó alguna vez (la más justa y la que mejor
 *            recibe el cliente: no castiga a quien siempre llega).
 */
export type BarberDepositAudience = "ALL" | "NEW" | "NO_SHOW";

export interface BarberDepositPolicy {
  enabled: boolean;
  mode: BarberDepositMode;
  /** Monto fijo en CENTAVOS (modo FIXED). */
  fixedCents: number;
  /** 0–100 con 2 decimales (modo PERCENT). */
  percent: number;
  audience: BarberDepositAudience;
  /** Tope duro en CENTAVOS. 0 = sin tope. */
  maxCents: number;
  /** Horas antes de la cita en que aún se devuelve. 0 = no reembolsable. */
  refundWindowHours: number;
  /** Texto que ve el cliente ANTES de pagar. Vacío = se genera solo. */
  policyText: string;
  /** Cobro en línea con tarjeta (Stripe). Apagado = solo anticipo en mostrador. */
  onlineEnabled: boolean;
  /** Cuenta conectada de Stripe (acct_…) a la que va el dinero. Vacío = plataforma. */
  stripeAccountId: string;
}

export const DEFAULT_BARBER_DEPOSIT_POLICY: BarberDepositPolicy = {
  enabled: false,
  mode: "FIXED",
  fixedCents: 10_000, // $100.00 MXN
  percent: 30,
  audience: "NO_SHOW",
  maxCents: 0,
  refundWindowHours: 24,
  policyText: "",
  onlineEnabled: false,
  stripeAccountId: "",
};

const AUDIENCES: BarberDepositAudience[] = ["ALL", "NEW", "NO_SHOW"];
const MODES: BarberDepositMode[] = ["FIXED", "PERCENT"];

/** Normaliza cualquier cosa (fila de BD, body del formulario) a una política válida. */
export function normalizeDepositPolicy(raw: unknown): BarberDepositPolicy {
  const b = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_BARBER_DEPOSIT_POLICY;

  const mode = MODES.includes(b.mode as BarberDepositMode) ? (b.mode as BarberDepositMode) : d.mode;
  const audience = AUDIENCES.includes(b.audience as BarberDepositAudience)
    ? (b.audience as BarberDepositAudience)
    : d.audience;

  const fixedCents =
    b.fixedCents !== undefined
      ? Math.max(0, Math.round(Number(b.fixedCents) || 0))
      : b.fixed !== undefined
        ? Math.max(0, moneyToCents(b.fixed as string | number))
        : d.fixedCents;

  const percentRaw = Number(b.percent);
  const percent = Number.isFinite(percentRaw)
    ? Math.min(100, Math.max(0, Math.round(percentRaw * 100) / 100))
    : d.percent;

  const maxCents =
    b.maxCents !== undefined
      ? Math.max(0, Math.round(Number(b.maxCents) || 0))
      : b.max !== undefined
        ? Math.max(0, moneyToCents(b.max as string | number))
        : d.maxCents;

  const hoursRaw = Number(b.refundWindowHours);
  const refundWindowHours = Number.isFinite(hoursRaw)
    ? Math.min(720, Math.max(0, Math.round(hoursRaw)))
    : d.refundWindowHours;

  const stripeAccountRaw = typeof b.stripeAccountId === "string" ? b.stripeAccountId.trim() : "";

  return {
    enabled: b.enabled === true,
    mode,
    fixedCents,
    percent,
    audience,
    maxCents,
    refundWindowHours,
    policyText: typeof b.policyText === "string" ? b.policyText.trim().slice(0, 800) : "",
    onlineEnabled: b.onlineEnabled === true,
    // Solo aceptamos el formato real de Stripe Connect; cualquier otra cosa
    // se descarta en vez de guardarse a medias.
    stripeAccountId: /^acct_[A-Za-z0-9]+$/.test(stripeAccountRaw) ? stripeAccountRaw : "",
  };
}

/** Historial del cliente en ESTA barbería (lo resuelve el server con BD). */
export interface BarberClientDepositStats {
  /** Visitas ya completadas (DONE). */
  doneVisits: number;
  /** Cuántas veces no llegó (NO_SHOW). */
  noShows: number;
}

/** ¿A ESTE cliente le toca anticipo, según la audiencia configurada? */
export function depositAudienceApplies(
  policy: BarberDepositPolicy,
  stats: BarberClientDepositStats | null,
): boolean {
  if (policy.audience === "ALL") return true;
  // Sin historial (cliente nuevo o reserva sin cuenta) = cliente nuevo.
  const s = stats ?? { doneVisits: 0, noShows: 0 };
  if (policy.audience === "NEW") return s.doneVisits === 0;
  return s.noShows > 0;
}

/**
 * Cuánto anticipo pedir, en CENTAVOS. Nunca más que el total del servicio
 * (cobrar de anticipo más que el servicio sería una trampa) y nunca más que
 * el tope configurado.
 */
export function computeDepositCents(
  policy: BarberDepositPolicy,
  serviceTotalCents: number,
): number {
  if (!policy.enabled) return 0;
  const total = Math.max(0, Math.round(serviceTotalCents));
  if (total === 0) return 0;

  let amount = policy.mode === "PERCENT" ? percentOfCents(total, policy.percent) : policy.fixedCents;
  if (policy.maxCents > 0) amount = Math.min(amount, policy.maxCents);
  amount = Math.min(amount, total);
  return Math.max(0, amount);
}

export interface DepositQuote {
  required: boolean;
  amountCents: number;
  /** Por qué se pide (o no). Sirve para explicarlo en pantalla sin adivinar. */
  reason: "DISABLED" | "NOT_IN_AUDIENCE" | "ZERO_AMOUNT" | "REQUIRED";
  policy: BarberDepositPolicy;
}

export function quoteDeposit(
  policy: BarberDepositPolicy,
  serviceTotalCents: number,
  stats: BarberClientDepositStats | null,
): DepositQuote {
  if (!policy.enabled) {
    return { required: false, amountCents: 0, reason: "DISABLED", policy };
  }
  if (!depositAudienceApplies(policy, stats)) {
    return { required: false, amountCents: 0, reason: "NOT_IN_AUDIENCE", policy };
  }
  const amountCents = computeDepositCents(policy, serviceTotalCents);
  if (amountCents <= 0) {
    return { required: false, amountCents: 0, reason: "ZERO_AMOUNT", policy };
  }
  return { required: true, amountCents, reason: "REQUIRED", policy };
}

/**
 * Texto de la política que se le muestra al cliente ANTES de pagar. Sin letra
 * chica: qué paga, a qué se aplica y hasta cuándo se devuelve. Si la barbería
 * escribió su propio texto, ese manda.
 */
export function describeDepositPolicy(
  policy: BarberDepositPolicy,
  args: { amountCents: number; currency?: string; locale?: string },
): string {
  if (policy.policyText) return policy.policyText;

  const locale = args.locale === "en" ? "en" : "es";
  const money = formatCents(args.amountCents, args.currency ?? "MXN", locale);
  const h = policy.refundWindowHours;

  if (locale === "en") {
    const refund =
      h > 0
        ? `You can cancel or reschedule for free up to ${h} h before your appointment and we refund it in full. After that, the deposit is not refunded.`
        : "This deposit is not refundable once paid.";
    return `To hold your appointment we ask for a ${money} deposit. It is fully applied to your service total on the day of your visit. ${refund}`;
  }

  const refund =
    h > 0
      ? `Puedes cancelar o reagendar sin costo hasta ${h} h antes de tu cita y te lo devolvemos completo. Después de ese momento el anticipo no se devuelve.`
      : "Este anticipo no es reembolsable una vez pagado.";
  return `Para apartar tu cita te pedimos un anticipo de ${money}. Se aplica completo al total de tu servicio el día de la visita. ${refund}`;
}

/** ¿La cita todavía está dentro de la ventana de reembolso? */
export function isWithinRefundWindow(
  policy: BarberDepositPolicy,
  appointmentStartAt: Date,
  now: Date,
): boolean {
  if (policy.refundWindowHours <= 0) return false;
  const cutoff = appointmentStartAt.getTime() - policy.refundWindowHours * 3_600_000;
  return now.getTime() <= cutoff;
}

// ═══════════════════════════════════════════════════════════════════════
// Stripe: montos y periodicidad (puro, sin SDK)
// ═══════════════════════════════════════════════════════════════════════

/** Monto mínimo que Stripe acepta en MXN (10.00 MXN). */
export const STRIPE_MIN_MXN_CENTS = 1_000;

export function toStripeAmount(cents: number): number {
  return Math.max(0, Math.round(cents));
}

export function isChargeableAmount(cents: number, currency = "MXN"): boolean {
  if (currency.toUpperCase() !== "MXN") return cents > 0;
  return cents >= STRIPE_MIN_MXN_CENTS;
}

/**
 * periodDays del plan → `recurring` de Stripe. 30/31 → mensual, 7 → semanal,
 * 365 → anual; cualquier otro se expresa en días (Stripe acepta hasta 365).
 */
export function toStripeRecurring(periodDays: number): {
  interval: "day" | "week" | "month" | "year";
  interval_count: number;
} {
  const d = Math.max(1, Math.min(365, Math.round(periodDays || 30)));
  if (d === 365) return { interval: "year", interval_count: 1 };
  if (d === 30 || d === 31) return { interval: "month", interval_count: 1 };
  if (d === 7) return { interval: "week", interval_count: 1 };
  if (d === 14) return { interval: "week", interval_count: 2 };
  return { interval: "day", interval_count: d };
}

/** Vista de un anticipo para el panel y para el portal del cliente (T5). */
export interface BarberDepositView {
  appointmentId: string;
  clientId: string | null;
  clientName: string;
  startAt: string;
  status: "PENDING" | "PAID" | "REFUNDED" | "FORFEITED";
  amount: number;
  appointmentStatus: string;
  /** true si ya se descontó de un ticket (línea de crédito presente). */
  applied: boolean;
}

export function depositViewAmount(cents: number): number {
  return centsToNumber(cents);
}
