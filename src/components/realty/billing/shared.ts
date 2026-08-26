/**
 * DaleControl INMUEBLES — contrato CLIENT-SAFE de la pantalla de suscripción.
 *
 * Sin prisma, sin "server-only", sin Stripe: solo tipos y formateo. Lo
 * importan por igual el server component que arma los datos y los
 * componentes "use client" que los pintan.
 *
 * 🔴 CERO PRECIOS AQUÍ. Todo importe entra por props, en CENTAVOS enteros
 * (para que el cliente nunca sume floats) y sale de `realty_plan_configs`.
 * Si en este archivo aparece un número que parezca un precio, es un bug.
 */
import {
  formatRealtyPrice,
  formatRealtyStorage,
  isRealtyUnlimited,
  type RealtyPlanId,
} from "@/lib/realty/plan-shared";
import type { RealtyLimitKey } from "@/lib/realty/gating";

/** Un plan tal como lo pinta la tarjeta. Precios en CENTAVOS. */
export interface RealtyPlanCardDTO {
  id: RealtyPlanId;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  maxUsers: number;
  maxOffices: number;
  maxProperties: number;
  storageQuotaMb: number;
  messageQuota: number;
  /** Llaves de feature habilitadas, en el orden del catálogo. */
  features: string[];
  isActive: boolean;
}

/** Un límite ya evaluado. Sin Infinity: `unlimited` lo dice, y viaja por JSON. */
export interface RealtyLimitDTO {
  key: RealtyLimitKey;
  used: number;
  /** -1 = ilimitado. En `storage` son BYTES. */
  limit: number;
  unlimited: boolean;
  percent: number;
  nearLimit: boolean;
  atLimit: boolean;
}

export interface RealtySubscriptionDTO {
  id: string;
  status: string;
  interval: "month" | "year";
  cancelAtPeriodEnd: boolean;
  currentPeriodEndAt: string | null;
  trialEndsAt: string | null;
  unitAmountCents: number | null;
  openInvoiceUrl: string | null;
}

export interface RealtyInvoiceDTO {
  id: string;
  number: string | null;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  failureReason: string | null;
}

export interface RealtyBillingScreenData {
  planId: RealtyPlanId;
  planName: string;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  stripeConfigured: boolean;
  stripeUnreachable: boolean;
  hasCustomer: boolean;
  /** ¿Este usuario puede tocar el dinero? (permiso billing.manage) */
  canManage: boolean;
  subscription: RealtySubscriptionDTO | null;
  invoices: RealtyInvoiceDTO[];
  plans: RealtyPlanCardDTO[];
  limits: RealtyLimitDTO[];
}

// ── Formato ─────────────────────────────────────────────────────────────

/**
 * Centavos → "$1,234". El ÚNICO punto donde se divide entre 100.
 * (Ni siquiera como ejemplo se escribe aquí un precio del catálogo: la prueba
 * `suscripcion.test.ts` falla si aparece, y con razón — un comentario también
 * envejece mal.)
 */
export function formatCentsMXN(cents: number, currency = "MXN"): string {
  return formatRealtyPrice((cents ?? 0) / 100, currency);
}

const BYTES_PER_MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < BYTES_PER_MB) return `${Math.round(b / 1024)} KB`;
  return formatRealtyStorage(Math.round(b / BYTES_PER_MB));
}

/** Valor de un límite listo para pintar (bytes en `storage`, enteros en el resto). */
export function formatLimitValue(key: RealtyLimitKey, value: number): string {
  if (key === "storage") return formatBytes(value);
  return String(value);
}

export function shortDate(iso: string | null | undefined, locale = "es-MX"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

/** Estado de Stripe → llave del diccionario (siempre existe una). */
const KNOWN_STATES = new Set([
  "active",
  "trialing",
  "paid",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
  "pending_payment",
  "suspended",
]);

export function stateKey(status: string | null | undefined): string {
  const s = (status ?? "").trim();
  // Stripe escribe "canceled" con una L; el dental escribe "cancelled".
  if (s === "cancelled") return "canceled";
  return KNOWN_STATES.has(s) ? s : "unknown";
}

/**
 * Estados en los que la cuenta YA CONTRATÓ un plan (aunque el cobro vaya
 * tarde, o soporte la tenga en pausa).
 *
 * 🔴 POR QUÉ ESTO EXISTE. `RealtyAccount.plan` trae `@default(PROPIETARIO)`:
 * una cuenta recién registrada YA llega con el plan de entrada escrito en la
 * columna sin haber pagado un peso. Preguntar solo `plan.id === currentPlanId`
 * marcaba esa tarjeta como "Tu plan actual" y le apagaba el botón — o sea,
 * nadie podía contratar el plan de entrada del vertical.
 *
 * Se responde con `subscriptionStatus` de la CUENTA y NO con el objeto de
 * Stripe (`data.subscription`), porque ese objeto solo se pide con permiso
 * `billing.manage` (ver la página: `canManage ? getRealtyBillingSummary(...)
 * : null`). Si no, un MANAGER de una agencia que sí paga vería las tres
 * tarjetas como si no tuviera plan.
 *
 * Fuera a propósito:
 *  · `pending_payment` → el default de la columna; no ha contratado nada.
 *  · `incomplete` / `incomplete_expired` → el primer cobro nunca cerró; tiene
 *    que poder reintentar ESE MISMO plan.
 *  · `canceled` → se dio de baja; tiene que poder volver a contratar el que
 *    tenía (antes esa tarjeta también nacía muerta).
 *  · cualquier estado desconocido → ante la duda se deja vender, que es el
 *    modo de falla barato: el caro es el que estamos arreglando.
 */
const SUBSCRIBED_STATES = new Set([
  "active",
  "trialing",
  "paid",
  "past_due",
  "unpaid",
  "paused",
  "suspended",
]);

/** ¿La cuenta tiene un plan contratado? (pregunta del badge "Tu plan actual"). */
export function realtyAccountIsSubscribed(status: string | null | undefined): boolean {
  return SUBSCRIBED_STATES.has(stateKey(status));
}

export type BillingTone = "success" | "warning" | "danger" | "neutral";

export function stateTone(status: string | null | undefined): BillingTone {
  switch (stateKey(status)) {
    case "active":
    case "paid":
      return "success";
    case "trialing":
    case "past_due":
    case "incomplete":
    case "paused":
      return "warning";
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
    case "suspended":
      return "danger";
    default:
      return "neutral";
  }
}

export function invoiceStatusKey(status: string): string {
  switch (status) {
    case "paid":
      return "statusPaid";
    case "open":
      return "statusOpen";
    case "void":
      return "statusVoid";
    case "uncollectible":
      return "statusUncollectible";
    default:
      return "statusDraft";
  }
}

/**
 * Cupos del plan DESTINO que el consumo de hoy ya rebasa.
 *
 * Bajar de plan no borra nada, pero deja la cuenta "excedida": no puede
 * agregar más hasta liberar. Hay que decirlo ANTES de confirmar — un cambio
 * que deja a la cuenta con 14 usuarios en un plan de 1, sin avisar, es una
 * sorpresa desagradable que se descubre al intentar dar de alta a alguien.
 */
export function limitsOverTargetPlan(
  limits: RealtyLimitDTO[],
  target: RealtyPlanCardDTO,
): RealtyLimitKey[] {
  const caps: Record<RealtyLimitKey, number> = {
    users: target.maxUsers,
    offices: target.maxOffices,
    properties: target.maxProperties,
    storage: target.storageQuotaMb < 0 ? -1 : target.storageQuotaMb * BYTES_PER_MB,
    messages: target.messageQuota,
  };
  return limits
    .filter((l) => {
      const cap = caps[l.key];
      if (cap < 0) return false; // ilimitado en el destino: nunca sobra
      return l.used > cap;
    })
    .map((l) => l.key);
}

/** Barra de consumo: color por umbral. 90 % avisa, 100 % bloquea. */
export function usageTone(limit: RealtyLimitDTO): BillingTone {
  if (limit.unlimited) return "success";
  if (limit.atLimit) return "danger";
  if (limit.nearLimit) return "warning";
  return "success";
}

export { isRealtyUnlimited };
