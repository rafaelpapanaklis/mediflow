/**
 * DaleControl INMUEBLES — núcleo PURO y client-safe de la configuración de
 * planes del vertical (espejo de src/lib/barber/plan-shared.ts).
 *
 * Aquí viven SOLO valores/tipos sin dependencias de servidor (no importa
 * prisma ni "server-only"): importable desde client components (sidebar,
 * tarjetas de precios) y desde el server.
 *
 * La fuente de verdad EN VIVO es la tabla `realty_plan_configs`, resuelta
 * server-side por src/lib/realty/plans.ts (getRealtyPlan / getRealtyPlans)
 * con caché + FALLBACK a estas constantes si la tabla está vacía o no
 * responde. El FALLBACK ES EL SEED (mismos números que sql/realty.sql).
 *
 * REGLA DURA: CERO precios escritos en la UI — siempre se consume un
 * RealtyResolvedPlan (tabla) y se formatea con formatRealtyPrice.
 */
import type { RealtyPlanId } from "@/lib/realty/types";

export type { RealtyPlanId } from "@/lib/realty/types";

export const REALTY_PLAN_IDS = ["PROPIETARIO", "ASESOR", "INMOBILIARIA"] as const;

export function isRealtyPlanId(v: unknown): v is RealtyPlanId {
  return typeof v === "string" && (REALTY_PLAN_IDS as readonly string[]).includes(v);
}

/** -1 = ilimitado en maxUsers / maxOffices / maxProperties / messageQuota. */
export const REALTY_UNLIMITED = -1;

export function isRealtyUnlimited(n: number): boolean {
  return n === REALTY_UNLIMITED;
}

// ── Catálogo de features que un plan puede habilitar (las llaves EXACTAS
//    del Json `features` de realty_plan_configs). ──
export const REALTY_FEATURES: { key: string; label: string }[] = [
  { key: "properties", label: "Cartera de inmuebles" },
  { key: "leads", label: "Prospectos y embudo" },
  { key: "publicWeb", label: "Tu web pública" },
  { key: "webEditor", label: "Editor visual de la web" },
  { key: "tours3d", label: "Recorridos 3D y 360°" },
  { key: "calculators", label: "Calculadoras (ISAI, crédito, rendimiento)" },
  { key: "rentals", label: "Contratos de renta y cobranza" },
  { key: "maintenance", label: "Mantenimientos e incidencias" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "whatsappInbox", label: "Inbox de WhatsApp" },
  { key: "portalsFeed", label: "Feed para portales" },
  { key: "commissions", label: "Comisiones y su reparto" },
  { key: "multiOffice", label: "Varias oficinas" },
  { key: "agentPages", label: "Página pública por asesor" },
  { key: "mls", label: "Bolsa compartida (MLS)" },
  { key: "pld", label: "Prevención de lavado de dinero" },
  { key: "aiStudio", label: "Estudio con IA (fotos y textos)" },
  { key: "advancedRoles", label: "Roles avanzados" },
  { key: "analytics", label: "Analytics" },
  { key: "affiliates", label: "Programa de socios" },
  { key: "clientPortal", label: "Portal del cliente" },
];

export const REALTY_FEATURE_KEYS: string[] = REALTY_FEATURES.map((f) => f.key);

export function realtyFeatureLabel(key: string): string {
  return REALTY_FEATURES.find((f) => f.key === key)?.label ?? key;
}

/** Forma cruda de un plan (= columnas de realty_plan_configs, Decimal → number). */
export interface RealtyPlanConfigShape {
  name: string;
  priceMonthly: number;
  priceYearly: number | null;
  maxUsers: number;
  maxOffices: number;
  /** -1 = propiedades ilimitadas. Los tres planes lo tienen ilimitado hoy. */
  maxProperties: number;
  /** Cupo de archivos en MEGABYTES (fotos + tours + documentos). */
  storageQuotaMb: number;
  /** PROVISIONAL: el número final depende del costo de Meta. 0 = sin WhatsApp. */
  messageQuota: number;
  features: Record<string, boolean>;
  /** Clave de búsqueda del precio en Stripe (la ola de cobro la resuelve). */
  stripeLookupKey: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Plan ya resuelto para UI (lo que devuelve getRealtyPlan / getRealtyPlans). */
export interface RealtyResolvedPlan extends RealtyPlanConfigShape {
  id: RealtyPlanId;
}

function features(keys: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of REALTY_FEATURES) out[f.key] = keys.includes(f.key);
  return out;
}

// El reparto es ACUMULATIVO: cada plan añade sobre el anterior. Así, una
// feature nueva se agrega en un solo renglón y sube sola por la escalera.
const PROPIETARIO_FEATURES = [
  "properties",
  "leads",
  "publicWeb",
  "webEditor",
  // 3D/360 va en los TRES planes a propósito: es el gancho del producto.
  // Lo que cambia entre planes es el CUPO DE STORAGE, no la función.
  "tours3d",
  "calculators",
  "rentals",
  "maintenance",
];

const ASESOR_FEATURES = [
  ...PROPIETARIO_FEATURES,
  // WhatsApp arranca en ASESOR: el plan de $199 NO lo tiene.
  "whatsapp",
  "whatsappInbox",
  "portalsFeed",
  "commissions",
  "clientPortal",
];

const INMOBILIARIA_FEATURES = [
  ...ASESOR_FEATURES,
  "multiOffice",
  "agentPages",
  "mls",
  "pld",
  "aiStudio",
  "advancedRoles",
  "analytics",
  "affiliates",
];

/**
 * FALLBACK = SEED (mismos números que el INSERT de sql/realty.sql).
 * Precios mensuales 199 / 349 / 649 MXN.
 *   PROPIETARIO  1 usuario,  1 oficina,  2 GB, SIN WhatsApp
 *   ASESOR       6 usuarios, 1 oficina, 10 GB, CON WhatsApp
 *   INMOBILIARIA usuarios y oficinas ilimitados (-1), 40 GB, CON WhatsApp
 * Propiedades ILIMITADAS en los tres. Editable en la tabla sin redeploy.
 */
export const FALLBACK_REALTY_PLAN_CONFIG: Record<RealtyPlanId, RealtyPlanConfigShape> = {
  PROPIETARIO: {
    name: "Propietario",
    priceMonthly: 199,
    priceYearly: null,
    maxUsers: 1,
    maxOffices: 1,
    maxProperties: REALTY_UNLIMITED,
    storageQuotaMb: 2048,
    messageQuota: 0,
    features: features(PROPIETARIO_FEATURES),
    stripeLookupKey: null,
    sortOrder: 0,
    isActive: true,
  },
  ASESOR: {
    name: "Asesor",
    priceMonthly: 349,
    priceYearly: null,
    maxUsers: 6,
    maxOffices: 1,
    maxProperties: REALTY_UNLIMITED,
    storageQuotaMb: 10240,
    messageQuota: 500,
    features: features(ASESOR_FEATURES),
    stripeLookupKey: null,
    sortOrder: 1,
    isActive: true,
  },
  INMOBILIARIA: {
    name: "Inmobiliaria",
    priceMonthly: 649,
    priceYearly: null,
    maxUsers: REALTY_UNLIMITED,
    maxOffices: REALTY_UNLIMITED,
    maxProperties: REALTY_UNLIMITED,
    storageQuotaMb: 40960,
    messageQuota: 2000,
    features: features(INMOBILIARIA_FEATURES),
    stripeLookupKey: null,
    sortOrder: 2,
    isActive: true,
  },
};

// ── Helpers de features / comparación ───────────────────────────────────

/** ¿El plan (resuelto o su mapa features) tiene habilitada la feature? */
export function realtyPlanHasFeature(
  plan: { features: Record<string, boolean> } | Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  if (!plan) return false;
  const map =
    "features" in plan && typeof (plan as { features?: unknown }).features === "object"
      ? (plan as { features: Record<string, boolean> }).features
      : (plan as Record<string, boolean>);
  return map?.[key] === true;
}

/** Orden de los planes (PROPIETARIO < ASESOR < INMOBILIARIA). */
export function realtyPlanRank(plan: RealtyPlanId): number {
  return (REALTY_PLAN_IDS as readonly string[]).indexOf(plan);
}

/** ¿`plan` es al menos `min`? (para gates "ASESOR o superior"). */
export function isRealtyPlanAtLeast(plan: RealtyPlanId, min: RealtyPlanId): boolean {
  return realtyPlanRank(plan) >= realtyPlanRank(min);
}

/** Compara dos planes por rango (para ordenar tarjetas). */
export function compareRealtyPlans(a: RealtyPlanId, b: RealtyPlanId): number {
  return realtyPlanRank(a) - realtyPlanRank(b);
}

// ── Formato de precio (es-MX, sin decimales cuando el precio es entero). ──
export function formatRealtyPrice(amount: number, currency: string = "MXN"): string {
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

/** "6 usuarios" / "Usuarios ilimitados" a partir del límite de la tabla. */
export function formatRealtyLimit(n: number, singular: string, plural: string): string {
  if (isRealtyUnlimited(n)) {
    return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitados`;
  }
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}

/** "2 GB" / "10 GB" a partir de storageQuotaMb. -1 = sin límite. */
export function formatRealtyStorage(mb: number): string {
  if (isRealtyUnlimited(mb)) return "Espacio ilimitado";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

// ── Estado de suscripción de la cuenta (espejo de barber). ──────────────
// Registro sin trial → nace "pending_payment" (sin acceso hasta pagar).
export const REALTY_ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid"]);

export function isRealtySubscriptionActive(
  account: { subscriptionStatus?: string | null } | null | undefined,
): boolean {
  const status = account?.subscriptionStatus ?? null;
  return status !== null && REALTY_ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * Menú con la suscripción IMPAGA (pending_payment / past_due / canceled):
 * solo la sección "cuenta" sin Configuración — el camino claro es pagar.
 * Helper PURO para el layout del panel (una línea allí). La ola de
 * suscripción lo cablea; la Ola 0 lo deja escrito y probado.
 */
export function realtyNavItemsWhileUnpaid<T extends { key: string; section: string }>(
  items: T[],
): T[] {
  return items.filter((i) => i.section === "cuenta" && i.key !== "configuracion");
}
