/**
 * Núcleo PURO y client-safe de la configuración de planes.
 *
 * Aquí viven SOLO valores/tipos sin dependencias de servidor (no importa
 * prisma ni "server-only"), por lo que puede importarse desde client
 * components (sidebar, editor admin, tarjetas de precios) y desde el server.
 *
 * La fuente de verdad EN VIVO (editable desde el admin sin redeploy) es la
 * tabla `plan_configs` que lee `src/lib/plans.ts` (server). Lo de aquí es:
 *   - el FALLBACK (= seed) si la tabla está vacía o no responde,
 *   - el catálogo de módulos del panel que el plan puede habilitar (casillas),
 *   - el copy de marketing (bullets) que se muestra en las tarjetas,
 *   - utilidades puras (formatBytes) y los tipos compartidos.
 */
import type { PlanId } from "@/lib/billing/plans";

const GB = 1024 ** 3;

/** Límites efectivos de un plan (espejo de lo que devuelve getPlanLimits). */
export interface PlanLimits {
  /** Bytes de storage permitidos para archivos de pacientes */
  storageBytes: number;
  /** Tokens IA por mes (refleja el default de Clinic.aiTokensLimit) */
  aiTokensDefault: number;
  /** WhatsApps salientes por mes estimados para el plan */
  whatsappMonthly: number;
  /** Facturas CFDI (timbres) incluidas por mes calendario (reset día 1) */
  cfdiMonthly: number;
  /** Precio por timbre CFDI excedente, en CENTAVOS MXN (200 = $2.00) */
  cfdiOverageCents: number;
  /** Precio mensual en MXN (compat — el cobro real sale de getResolvedPlan) */
  monthlyPrice: number;
  /** Máximo de pacientes; null = ilimitado */
  maxPatients: number | null;
  /** Máximo de usuarios/profesionales; null = ilimitado */
  maxUsers: number | null;
  /**
   * Máximo de SUCURSALES (clínicas) por dueño; null = ilimitado. Se cuenta por
   * supabaseId con rol SUPER_ADMIN, no por clínica. 1 = sin multi-sucursal.
   * Enforcement en POST /api/clinics vía getBranchQuota (@/lib/branches).
   */
  maxClinics: number | null;
  label: string;
}

/**
 * Plan ya resuelto para UI/checkout. Mantiene `name`/`priceMxn`/`features`
 * (bullets) para ser drop-in del antiguo `getPlan()` y agrega precio anual,
 * límites y el mapa de permisos por módulo (`moduleFeatures`).
 */
export interface ResolvedPlan {
  id: PlanId;
  name: string; // = label
  label: string;
  /** Precio mensual MXN (drop-in del antiguo getPlan().priceMxn) */
  priceMxn: number;
  priceMxnMonthly: number;
  priceMxnAnnual: number;
  storageBytes: number;
  aiTokensDefault: number;
  whatsappMonthly: number;
  /** Facturas CFDI incluidas por mes calendario (reset día 1). */
  cfdiMonthly: number;
  /** Precio por timbre CFDI excedente, en CENTAVOS MXN (200 = $2.00). */
  cfdiOverageCents: number;
  maxPatients: number | null;
  maxUsers: number | null;
  /** Máximo de sucursales por dueño; null = ilimitado (1 = sin multi-sucursal). */
  maxClinics: number | null;
  /** Bullets de marketing para las tarjetas (display). */
  features: string[];
  /** Permisos por módulo del panel: { moduleKey: boolean }. */
  moduleFeatures: Record<string, boolean>;
}

/**
 * Catálogo de módulos del panel que un plan puede habilitar/ocultar (las
 * "casillas" del editor admin). `key` debe coincidir con el `moduleKey` del
 * item correspondiente en `src/components/dashboard/sidebar.tsx` para que el
 * gating de navegación funcione (Fase 1: solo oculta del sidebar).
 */
export const PLAN_MODULES: { key: string; label: string }[] = [
  { key: "ai-assistant", label: "IA asistente" },
  { key: "inbox",        label: "Inbox" },
  { key: "whatsapp",     label: "Mensajes / WhatsApp" },
  { key: "marketplace",  label: "Marketplace" },
  { key: "analytics",    label: "Analytics" },
  { key: "reports",      label: "Reportes" },
  { key: "landing",      label: "Página web" },
  { key: "tv-modes",     label: "Pantallas TV" },
];

export const PLAN_MODULE_KEYS: string[] = PLAN_MODULES.map((m) => m.key);

function allModules(value: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const m of PLAN_MODULES) out[m.key] = value;
  return out;
}

/** Copy de marketing por plan (bullets para tarjetas de precio). */
export const PLAN_MARKETING: Record<PlanId, { name: string; features: string[] }> = {
  BASIC:  { name: "Básico",      features: ["2 usuarios", "500 pacientes", "Agenda + WhatsApp", "CFDI + Portal"] },
  PRO:    { name: "Profesional", features: ["6 usuarios", "IA radiografías", "Analytics + reportes", "Mi Clínica 3D"] },
  CLINIC: { name: "Clínica",     features: ["Usuarios ilimitados", "Multi-sucursal", "Soporte prioritario", "Onboarding dedicado"] },
};

/** Forma cruda de un plan (= columnas de plan_configs, storage en bytes). */
export interface PlanConfigShape {
  label: string;
  priceMxnMonthly: number;
  priceMxnAnnual: number;
  storageBytes: number;
  aiTokensDefault: number;
  whatsappMonthly: number;
  cfdiMonthly: number;
  cfdiOverageCents: number;
  maxPatients: number | null;
  maxUsers: number | null;
  maxClinics: number | null;
  features: Record<string, boolean>;
}

/**
 * FALLBACK = SEED. Precios 419/689/1719 (anual = 35% de descuento →
 * 3264/5376/13404, equivalentes a 272/448/1117 al mes). Límites finales:
 * pacientes 500/∞/∞; usuarios 2/6/∞; sucursales 1/1/3; storage 5/15/75 GB;
 * IA 0/200k/1M; WhatsApp 300/1500/6000; BASIC SIN IA/analytics/tv-modes; PRO y
 * CLINIC con todo. Editable en /admin sin redeploy.
 */
export const FALLBACK_PLAN_CONFIG: Record<PlanId, PlanConfigShape> = {
  BASIC: {
    label: "Básico",
    priceMxnMonthly: 419,
    priceMxnAnnual: 3264,
    storageBytes: 5 * GB,
    aiTokensDefault: 0,
    whatsappMonthly: 300,
    cfdiMonthly: 25,
    cfdiOverageCents: 200,
    maxPatients: 500,
    maxUsers: 2,
    maxClinics: 1,
    features: { ...allModules(true), "ai-assistant": false, analytics: false, "tv-modes": false },
  },
  PRO: {
    label: "Profesional",
    priceMxnMonthly: 689,
    priceMxnAnnual: 5376,
    storageBytes: 15 * GB,
    aiTokensDefault: 200_000,
    whatsappMonthly: 1500,
    cfdiMonthly: 50,
    cfdiOverageCents: 200,
    maxPatients: null,
    maxUsers: 6,
    maxClinics: 1,
    features: allModules(true),
  },
  CLINIC: {
    label: "Clínica",
    priceMxnMonthly: 1719,
    priceMxnAnnual: 13404,
    storageBytes: 75 * GB,
    aiTokensDefault: 1_000_000,
    whatsappMonthly: 6000,
    cfdiMonthly: 150,
    cfdiOverageCents: 125,
    maxPatients: null,
    maxUsers: null,
    // Multi-sucursal: el precio de CLINIC incluye hasta 3 sedes bajo el mismo
    // dueño (sin suscripción Stripe propia). La 4.ª+ = add-on aparte (pendiente).
    maxClinics: 3,
    features: allModules(true),
  },
};

/** Precio mensual de respaldo por plan (solo para estimaciones donde no hay DB). */
export const FALLBACK_PLAN_PRICES_MXN: Record<string, number> = {
  BASIC: 419,
  PRO: 689,
  CLINIC: 1719,
};

/**
 * PROMO 1ER MES (precio TOTAL de la primera factura mensual, MXN + IVA).
 * Solo aplica a la PRIMERA suscripción MENSUAL con tarjeta de una clínica
 * (nunca al plan anual ni a cambios de plan/reactivaciones). NO es trial: el
 * primer mes SE COBRA a este precio; del segundo ciclo en adelante Stripe
 * cobra el precio normal automáticamente. La regla vive en
 * `src/lib/billing/first-month-promo.ts` (server).
 */
export const FIRST_MONTH_PROMO_MXN: Record<PlanId, number> = {
  BASIC: 19,
  PRO: 29,
  CLINIC: 39,
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
