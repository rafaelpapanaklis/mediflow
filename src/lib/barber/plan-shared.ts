/**
 * DaleControl BARBER — núcleo PURO y client-safe de la configuración de
 * planes del vertical (espejo de src/lib/plan-shared.ts del dental).
 *
 * Aquí viven SOLO valores/tipos sin dependencias de servidor (no importa
 * prisma ni "server-only"): importable desde client components (sidebar,
 * tarjetas de precios) y desde el server.
 *
 * La fuente de verdad EN VIVO es la tabla `barber_plan_configs`, resuelta
 * server-side por src/lib/barber/plans.ts (getBarberPlan / getBarberPlans)
 * con caché + FALLBACK a estas constantes si la tabla está vacía o no
 * responde. El FALLBACK ES EL SEED (mismos números que sql/barber.sql).
 *
 * REGLA DURA: ningún precio de plan se hardcodea en la UI — siempre se
 * consume un BarberResolvedPlan (tabla) y se formatea con formatBarberPrice.
 */
import type { BarberPlanId } from "@/lib/barber/types";

export type { BarberPlanId } from "@/lib/barber/types";

export const BARBER_PLAN_IDS = ["BASICO", "AVANZADO", "PROFESIONAL"] as const;

export function isBarberPlanId(v: unknown): v is BarberPlanId {
  return typeof v === "string" && (BARBER_PLAN_IDS as readonly string[]).includes(v);
}

/** -1 = ilimitado en maxBarbers / maxBranches / messageQuota. */
export const BARBER_UNLIMITED = -1;

export function isBarberUnlimited(n: number): boolean {
  return n === BARBER_UNLIMITED;
}

// ── Catálogo de features que un plan puede habilitar (las llaves EXACTAS
//    del Json `features` de barber_plan_configs). ──
export const BARBER_FEATURES: { key: string; label: string }[] = [
  { key: "agenda", label: "Agenda de citas" },
  { key: "clients", label: "Clientes y preferencias" },
  { key: "publicBooking", label: "Reservas en línea" },
  { key: "whatsappReminders", label: "Recordatorios por WhatsApp" },
  { key: "cash", label: "Caja y cortes" },
  { key: "tips", label: "Propinas" },
  { key: "loyalty", label: "Tarjeta de lealtad" },
  { key: "commissions", label: "Comisiones de barberos" },
  { key: "walkinQueue", label: "Fila virtual" },
  { key: "memberships", label: "Membresías de clientes" },
  { key: "deposits", label: "Anticipos anti no-show" },
  { key: "whatsappInbox", label: "Inbox de WhatsApp" },
  { key: "miniWebEditor", label: "Editor de mi web" },
  { key: "products", label: "Productos e inventario" },
  { key: "multiBranch", label: "Multi-sucursal" },
  { key: "whatsappBot", label: "Bot de WhatsApp" },
  { key: "advancedRoles", label: "Roles avanzados" },
  { key: "analytics", label: "Analytics" },
  { key: "affiliates", label: "Programa de socios" },
];

export const BARBER_FEATURE_KEYS: string[] = BARBER_FEATURES.map((f) => f.key);

export function barberFeatureLabel(key: string): string {
  return BARBER_FEATURES.find((f) => f.key === key)?.label ?? key;
}

/** Forma cruda de un plan (= columnas de barber_plan_configs, Decimal → number). */
export interface BarberPlanConfigShape {
  name: string;
  priceMonthly: number;
  priceYearly: number | null;
  firstMonthPrice: number | null;
  maxBarbers: number;
  maxBranches: number;
  /** PROVISIONAL: el número final depende del costo de Meta (Rafael confirma). */
  messageQuota: number;
  features: Record<string, boolean>;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Plan ya resuelto para UI (lo que devuelve getBarberPlan / getBarberPlans). */
export interface BarberResolvedPlan extends BarberPlanConfigShape {
  id: BarberPlanId;
}

function features(keys: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of BARBER_FEATURES) out[f.key] = keys.includes(f.key);
  return out;
}

const BASICO_FEATURES = [
  "agenda",
  "clients",
  "publicBooking",
  "whatsappReminders",
  "cash",
  "tips",
  "loyalty",
];

const AVANZADO_FEATURES = [
  ...BASICO_FEATURES,
  "commissions",
  "walkinQueue",
  "memberships",
  "deposits",
  "whatsappInbox",
  "miniWebEditor",
  "products",
];

const PROFESIONAL_FEATURES = [
  ...AVANZADO_FEATURES,
  "multiBranch",
  "whatsappBot",
  "advancedRoles",
  "analytics",
  "affiliates",
];

/**
 * FALLBACK = SEED (mismos números que el INSERT de sql/barber.sql).
 * Precios mensuales 199 / 329 / 749 MXN. maxBarbers 1/5/∞; maxBranches
 * 1/1/∞; messageQuota 200/600/∞ (PROVISIONAL — vive en la tabla, no en
 * código de UI). Editable en la tabla sin redeploy.
 */
export const FALLBACK_BARBER_PLAN_CONFIG: Record<BarberPlanId, BarberPlanConfigShape> = {
  BASICO: {
    name: "Básico",
    priceMonthly: 199,
    priceYearly: null,
    firstMonthPrice: null,
    maxBarbers: 1,
    maxBranches: 1,
    messageQuota: 200,
    features: features(BASICO_FEATURES),
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
    sortOrder: 0,
    isActive: true,
  },
  AVANZADO: {
    name: "Avanzado",
    priceMonthly: 329,
    priceYearly: null,
    firstMonthPrice: null,
    maxBarbers: 5,
    maxBranches: 1,
    messageQuota: 600,
    features: features(AVANZADO_FEATURES),
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
    sortOrder: 1,
    isActive: true,
  },
  PROFESIONAL: {
    name: "Profesional",
    priceMonthly: 749,
    priceYearly: null,
    firstMonthPrice: null,
    maxBarbers: BARBER_UNLIMITED,
    maxBranches: BARBER_UNLIMITED,
    messageQuota: BARBER_UNLIMITED,
    features: features(PROFESIONAL_FEATURES),
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
    sortOrder: 2,
    isActive: true,
  },
};

// ── Helpers de features / comparación ───────────────────────────────────

/** ¿El plan (resuelto o su mapa features) tiene habilitada la feature? */
export function barberPlanHasFeature(
  plan: { features: Record<string, boolean> } | Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  if (!plan) return false;
  const map = "features" in plan && typeof (plan as { features?: unknown }).features === "object"
    ? (plan as { features: Record<string, boolean> }).features
    : (plan as Record<string, boolean>);
  return map?.[key] === true;
}

/** Orden de los planes (BASICO < AVANZADO < PROFESIONAL). */
export function barberPlanRank(plan: BarberPlanId): number {
  return (BARBER_PLAN_IDS as readonly string[]).indexOf(plan);
}

/** ¿`plan` es al menos `min`? (para gates "AVANZADO o superior"). */
export function isBarberPlanAtLeast(plan: BarberPlanId, min: BarberPlanId): boolean {
  return barberPlanRank(plan) >= barberPlanRank(min);
}

/** Compara dos planes por rango (para ordenar tarjetas). */
export function compareBarberPlans(a: BarberPlanId, b: BarberPlanId): number {
  return barberPlanRank(a) - barberPlanRank(b);
}

// ── Formato de precio (es-MX, sin decimales cuando el precio es entero). ──
export function formatBarberPrice(amount: number, currency: string = "MXN"): string {
  const hasCents = Math.abs(amount % 1) > 0.001;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    }).format(amount);
  } catch {
    return `$${amount} ${currency}`;
  }
}

/** "5 barberos" / "Barberos ilimitados" a partir del límite de la tabla. */
export function formatBarberLimit(n: number, singular: string, plural: string): string {
  if (isBarberUnlimited(n)) return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitados`;
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}

// ── Estado de suscripción de la barbería (espejo de plan-status dental). ──
// Registro sin trial → nace "pending_payment" (sin acceso hasta pagar).
export const BARBER_ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid"]);

export function isBarbershopSubscriptionActive(
  shop: { subscriptionStatus?: string | null } | null | undefined,
): boolean {
  const status = shop?.subscriptionStatus ?? null;
  return status !== null && BARBER_ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}
