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
  /** Precio mensual en MXN (compat — el cobro real sale de getResolvedPlan) */
  monthlyPrice: number;
  /** Máximo de pacientes; null = ilimitado */
  maxPatients: number | null;
  /** Máximo de usuarios/profesionales; null = ilimitado */
  maxUsers: number | null;
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
  maxPatients: number | null;
  maxUsers: number | null;
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
  BASIC:  { name: "Básico",      features: ["1 profesional", "200 pacientes", "Agenda", "Facturación"] },
  PRO:    { name: "Profesional", features: ["3 profesionales", "Pacientes ilimitados", "Expedientes", "Reportes"] },
  CLINIC: { name: "Clínica",     features: ["Todo ilimitado", "Multi-sucursal", "API", "Manager"] },
};

/** Forma cruda de un plan (= columnas de plan_configs, storage en bytes). */
export interface PlanConfigShape {
  label: string;
  priceMxnMonthly: number;
  priceMxnAnnual: number;
  storageBytes: number;
  aiTokensDefault: number;
  whatsappMonthly: number;
  maxPatients: number | null;
  maxUsers: number | null;
  features: Record<string, boolean>;
}

/**
 * FALLBACK = SEED. Valores ACTUALES correctos: precios 499/999/1999
 * (anual = ×10, 2 meses gratis) + límites de los antiguos PLAN_LIMITS.
 * BASIC arranca SIN ai-assistant/analytics/tv-modes (tier de entrada);
 * PRO y CLINIC con todo habilitado. El admin puede editar todo sin redeploy.
 */
export const FALLBACK_PLAN_CONFIG: Record<PlanId, PlanConfigShape> = {
  BASIC: {
    label: "Básico",
    priceMxnMonthly: 499,
    priceMxnAnnual: 4990,
    storageBytes: 1 * GB,
    aiTokensDefault: 50_000,
    whatsappMonthly: 200,
    maxPatients: 200,
    maxUsers: 1,
    features: { ...allModules(true), "ai-assistant": false, analytics: false, "tv-modes": false },
  },
  PRO: {
    label: "Profesional",
    priceMxnMonthly: 999,
    priceMxnAnnual: 9990,
    storageBytes: 10 * GB,
    aiTokensDefault: 200_000,
    whatsappMonthly: 1000,
    maxPatients: null,
    maxUsers: 3,
    features: allModules(true),
  },
  CLINIC: {
    label: "Clínica",
    priceMxnMonthly: 1999,
    priceMxnAnnual: 19990,
    storageBytes: 100 * GB,
    aiTokensDefault: 1_000_000,
    whatsappMonthly: 5000,
    maxPatients: null,
    maxUsers: null,
    features: allModules(true),
  },
};

/** Precio mensual de respaldo por plan (solo para estimaciones donde no hay DB). */
export const FALLBACK_PLAN_PRICES_MXN: Record<string, number> = {
  BASIC: 499,
  PRO: 999,
  CLINIC: 1999,
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
