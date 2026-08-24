/**
 * DaleControl BARBER — tipos y helpers CLIENT-SAFE de la pantalla de
 * suscripción. Sin prisma, sin Stripe, sin "server-only": los tipos del
 * servidor entran como `import type` (se borran al compilar).
 *
 * DINERO: todo llega en CENTAVOS enteros (calculados en el servidor con
 * Decimal). Aquí solo se FORMATEA con aritmética entera — jamás se opera
 * con floats.
 */
import type { Dictionary } from "@/i18n/t";
import type { BarberPlanId } from "@/lib/barber/types";
import type { BarberLimitKey } from "@/lib/barber/gating";
import type {
  BarberBillingSummary,
  BarberChargeFailureReason,
  BarberInvoiceSummary,
  BarberPlanChangePreview,
  BarberSubscriptionSummary,
} from "@/lib/barber/billing";

export type {
  BarberBillingSummary,
  BarberChargeFailureReason,
  BarberInvoiceSummary,
  BarberPlanChangePreview,
  BarberSubscriptionSummary,
  BarberLimitKey,
  Dictionary,
};

export type BarberBillingIntervalUI = "month" | "year";

/** Plan tal como lo pinta la tarjeta (precios en centavos, leídos de la tabla). */
export interface BarberPlanCardDTO {
  id: BarberPlanId;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  firstMonthCents: number | null;
  maxBarbers: number;
  maxBranches: number;
  messageQuota: number;
  /** Llaves de feature habilitadas, en el orden del catálogo. */
  features: string[];
  isActive: boolean;
}

export interface BarberLimitStateDTO {
  max: number;
  used: number;
  overLimit: boolean;
}

export interface BarberGateDTO {
  planId: BarberPlanId;
  planName: string;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  limits: Record<BarberLimitKey, BarberLimitStateDTO>;
}

export interface BarberLimitWarningDTO {
  key: BarberLimitKey;
  used: number;
  max: number;
}

/** Respuesta de POST /api/barber/billing/change-plan/preview. */
export type BarberChangePreviewDTO = BarberPlanChangePreview & {
  targetPlanId: BarberPlanId;
  limitWarnings: BarberLimitWarningDTO[];
};

/** Respuesta de GET /api/barber/billing/status. */
export interface BarberBillingStatusDTO {
  gate: BarberGateDTO;
  summary: BarberBillingSummary;
}

export function toBarberGateDTO(gate: {
  planId: BarberPlanId;
  plan: { name: string };
  subscriptionStatus: string;
  subscriptionActive: boolean;
  limits: Record<BarberLimitKey, BarberLimitStateDTO>;
}): BarberGateDTO {
  return {
    planId: gate.planId,
    planName: gate.plan.name,
    subscriptionStatus: gate.subscriptionStatus,
    subscriptionActive: gate.subscriptionActive,
    limits: {
      barbers: { ...gate.limits.barbers },
      branches: { ...gate.limits.branches },
    },
  };
}

// ── Estado de la suscripción → llave de UI ───────────────────────────────

export type BarberBillingStatusKey = "active" | "trialing" | "pending" | "pastDue" | "canceled" | "unknown";

/** Estados de BD/Stripe → las 4 caras visibles (activa, pago pendiente, vencida, cancelada). */
export function billingStatusKey(status: string | null | undefined): BarberBillingStatusKey {
  switch (status) {
    case "active":
    case "paid":
      return "active";
    case "trialing":
      return "trialing";
    case "pending_payment":
    case "incomplete":
    case "paused":
      return "pending";
    case "past_due":
    case "unpaid":
      return "pastDue";
    case "canceled":
    case "cancelled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "unknown";
  }
}

export type BarberTone = "ok" | "warn" | "danger" | "neutral";

export function billingStatusTone(key: BarberBillingStatusKey): BarberTone {
  if (key === "active" || key === "trialing") return "ok";
  if (key === "pastDue") return "danger";
  if (key === "pending") return "warn";
  return "neutral";
}

export type BarberInvoiceStatusKey = "paid" | "open" | "failed" | "void" | "uncollectible" | "draft";

export function invoiceStatusKey(inv: Pick<BarberInvoiceSummary, "status" | "failed">): BarberInvoiceStatusKey {
  if (inv.status === "paid") return "paid";
  if (inv.status === "void") return "void";
  if (inv.status === "uncollectible") return "uncollectible";
  if (inv.status === "draft") return "draft";
  if (inv.failed) return "failed";
  return "open";
}

// ── Formato ──────────────────────────────────────────────────────────────

function intlLocale(locale: string | null | undefined): string {
  return locale === "en" ? "en-US" : "es-MX";
}

/**
 * Centavos → "$1,234.50" con aritmética ENTERA: la parte entera se formatea
 * como moneda sin decimales y los centavos se pegan como texto.
 */
export function formatBarberCents(cents: number, currency: string = "MXN", locale?: string | null): string {
  const value = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let wholeText: string;
  try {
    wholeText = new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(whole);
  } catch {
    wholeText = `$${whole} ${currency}`;
  }
  const text = frac > 0 ? `${wholeText}.${String(frac).padStart(2, "0")}` : wholeText;
  return negative ? `-${text}` : text;
}

/** Precio anual → equivalente mensual en centavos (división entera, redondeo al centavo). */
export function yearlyToMonthlyCents(yearlyCents: number): number {
  return Math.round(yearlyCents / 12);
}

export function formatBarberDate(iso: string | null | undefined, locale?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric" }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatCardExpiry(expMonth: number, expYear: number): string {
  if (!expMonth || !expYear) return "—";
  return `${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`;
}
