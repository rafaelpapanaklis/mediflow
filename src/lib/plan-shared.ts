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

/**
 * Copy de marketing por plan (bullets para tarjetas de precio).
 *
 * La IA de imagen solo procesa radiografías 2D (/api/xrays/[id]/analyze rechaza
 * lo que no sea image/*): NO existe IA sobre CBCT/DICOM. Cualquier bullet que
 * junte "3D" con "IA" es una promesa incumplible — mantenerlos separados.
 *
 * ⚠️ Aquí SOLO va el copy que no depende de un número. Los tres cupos que sí lo
 * hacen — USUARIOS, PACIENTES y SEDES — no se escriben a mano: los inyecta
 * `planBullets` (abajo) desde el valor REAL de plan_configs, así que "3 usuarios"
 * / "5 usuarios" / "Usuarios ilimitados" y "1 sede" / "Hasta 3 sedes" salen de
 * maxUsers / maxClinics y no pueden quedar mintiendo cuando el admin edita el
 * tope. Antes BASIC decía "2 usuarios" y PRO "6 usuarios" a mano. Igual que el
 * cupo CFDI (cfdiBullet), que las superficies insertan en la posición 3.
 */
export const PLAN_MARKETING: Record<PlanId, { name: string; features: string[] }> = {
  BASIC:  { name: "Básico",      features: ["Agenda + WhatsApp", "CFDI + Portal"] },
  PRO:    { name: "Profesional", features: ["IA en radiografías 2D", "Analytics + reportes", "Mi Clínica 3D"] },
  CLINIC: { name: "Clínica",     features: ["Soporte prioritario", "Onboarding dedicado"] },
};

/**
 * Lo que un plan con más de una sede ofrece POR TENER varias sedes. Solo se
 * muestra cuando el plan de verdad permite más de una (ver planBullets): un
 * plan de 1 sede no puede prometer «comparación entre sedes».
 */
export const MULTI_SEDE_BULLET = "Reportes consolidados y comparación entre sedes";

/** Forma cruda de un plan (= columnas de plan_configs, storage en bytes). */
export interface PlanConfigShape {
  label: string;
  priceMxnMonthly: number;
  priceMxnAnnual: number;
  storageBytes: number;
  aiTokensDefault: number;
  /**
   * @deprecated RETIRADO DEL PRODUCTO (2026-07-27). Nunca bloqueó ni cobró nada:
   * cada clínica conecta SU propio número (Clinic.waPhoneNumberId +
   * waAccessToken) y Meta le factura a ella, así que el cupo no protegía ningún
   * costo nuestro. Ya no aparece en PlanLimits/ResolvedPlan, no se puede editar
   * desde /admin y nada lo aplica.
   *
   * Sobrevive SOLO aquí porque la columna plan_configs."whatsappMonthly" sigue
   * siendo NOT NULL sin DEFAULT (no se hace DROP COLUMN) y el upsert de
   * /api/admin/plan-config tiene que mandarle un valor al crear la fila.
   * NO leerlo para nada más.
   */
  whatsappMonthly: number;
  cfdiMonthly: number;
  cfdiOverageCents: number;
  maxPatients: number | null;
  maxUsers: number | null;
  maxClinics: number | null;
  features: Record<string, boolean>;
}

/**
 * FALLBACK = SEED de las ALTAS NUEVAS (planes de sep-2026). Precios mensuales
 * 419/689/1489; anual 3264/5376/11614 (35% de descuento sobre 12 meses; el de
 * CLINIC es 1489 × 12 × 0.65 = 11614.20, entero porque priceMxnAnnual es Int).
 * Límites: pacientes 500/∞/∞; usuarios
 * 3/5/∞; sucursales 1/1/3; storage 5/15/75 GB; IA 0/200k/1M; BASIC SIN
 * IA/analytics/tv-modes; PRO y CLINIC con todo. Editable en /admin sin redeploy.
 *
 * Las clínicas dadas de alta ANTES (usuarios 2/6/∞, Clínica $1,719 / $13,404 al
 * año) NO leen esto: conservan lo suyo en los campos `*Override` de su fila de
 * Clinic (src/lib/billing/plan-overrides.ts).
 *
 * Precio anual de CLINIC confirmado por Rafael el 26-sep-2026: 11614 (+IVA). Los
 * anuales de BASIC y PRO (3264 y 5376) no se tocan.
 *
 * `whatsappMonthly` está DEPRECADO (ver PlanConfigShape): se conserva solo como
 * relleno del INSERT en plan_configs, no es un límite de nada.
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
    cfdiOverageCents: 300,
    maxPatients: 500,
    maxUsers: 3,
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
    maxUsers: 5,
    maxClinics: 1,
    features: allModules(true),
  },
  CLINIC: {
    label: "Clínica",
    priceMxnMonthly: 1489,
    priceMxnAnnual: 11614,
    storageBytes: 75 * GB,
    aiTokensDefault: 1_000_000,
    whatsappMonthly: 6000,
    cfdiMonthly: 150,
    cfdiOverageCents: 125,
    maxPatients: null,
    maxUsers: null,
    // Multi-sucursal: el precio de CLINIC incluye hasta 3 sedes bajo el mismo
    // dueño (sin suscripción Stripe propia). La 4.ª+ = add-on aparte (pendiente).
    // Las clínicas que ya estaban registradas conservan el tope que tenían (override).
    maxClinics: 3,
    features: allModules(true),
  },
};

/** Precio mensual de respaldo por plan (solo para estimaciones donde no hay DB). */
export const FALLBACK_PLAN_PRICES_MXN: Record<string, number> = {
  BASIC: 419,
  PRO: 689,
  CLINIC: 1489,
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

/**
 * Bullet de marketing del cupo CFDI para las tarjetas de plan. FUENTE ÚNICA
 * del copy (no repetir la cadena en ninguna otra superficie): p. ej.
 * "25 facturas CFDI al mes ($3.00 c/u adicional)". El precio del excedente se
 * formatea a pesos con 2 decimales desde los centavos (300 → $3.00).
 */
export function cfdiBullet(p: { cfdiMonthly: number; cfdiOverageCents: number }): string {
  const overage = (p.cfdiOverageCents / 100).toFixed(2);
  return `${p.cfdiMonthly} facturas CFDI al mes ($${overage} c/u adicional)`;
}

/**
 * Bullet del cupo de PACIENTES para las tarjetas de plan. FUENTE ÚNICA del copy:
 * "500 pacientes" cuando hay tope, "Pacientes ilimitados" cuando `maxPatients`
 * es null (PRO y CLINIC en el seed). El número JAMÁS se escribe a mano — sale de
 * plan_configs.maxPatients, editable desde /admin sin redeploy.
 */
export function patientsBullet(maxPatients: number | null): string {
  return maxPatients == null
    ? "Pacientes ilimitados"
    : `${maxPatients.toLocaleString("es-MX")} pacientes`;
}

/**
 * Bullet del cupo de USUARIOS. FUENTE ÚNICA del copy: "3 usuarios" con tope,
 * "Usuarios ilimitados" cuando `maxUsers` es null. Sale de plan_configs.maxUsers.
 */
export function usersBullet(maxUsers: number | null): string {
  return maxUsers == null ? "Usuarios ilimitados" : `${maxUsers} ${maxUsers === 1 ? "usuario" : "usuarios"}`;
}

/**
 * Bullet del cupo de SEDES: "1 sede", "Hasta 3 sedes" o "Sedes ilimitadas".
 * Sale de plan_configs.maxClinics (null = ilimitado).
 */
export function branchesBullet(maxClinics: number | null): string {
  if (maxClinics == null) return "Sedes ilimitadas";
  return maxClinics <= 1 ? "1 sede" : `Hasta ${maxClinics} sedes`;
}

/**
 * Bullets de marketing de un plan ya con sus cupos reales, en el orden que las
 * superficies esperan:
 *
 *   0 usuarios · 1 pacientes · 2 sedes [· multi-sede] · …copy fijo de PLAN_MARKETING
 *
 * Las tres superficies que pintan tarjetas (signup paso 3, ajustes →
 * suscripción, /dashboard/suspended) insertan el cupo CFDI en el índice 2
 * (`slice(0, 2)` + cfdiBullet + `slice(2)`), así que usuarios y pacientes DEBEN
 * seguir en 0 y 1: el bullet de CFDI conserva la posición 3 que fijó el fix de
 * cupos. Las sedes van justo detrás, ya como parte del resto.
 *
 * El bullet de «reportes consolidados y comparación entre sedes» solo sale si el
 * plan de verdad permite más de una sede.
 */
export function planBullets(
  planId: PlanId,
  limits: { maxPatients: number | null; maxUsers: number | null; maxClinics: number | null },
): string[] {
  const multiSede = limits.maxClinics == null || limits.maxClinics > 1;
  return [
    usersBullet(limits.maxUsers),
    patientsBullet(limits.maxPatients),
    branchesBullet(limits.maxClinics),
    ...(multiSede ? [MULTI_SEDE_BULLET] : []),
    ...PLAN_MARKETING[planId].features,
  ];
}

/**
 * Plan resuelto a partir de su fila de plan_configs (o del fallback si no hay
 * fila). PURO: lo usa `getResolvedPlan` (server, con caché) y los tests.
 */
export function buildResolvedPlan(planId: PlanId, row: PlanConfigShape | null): ResolvedPlan {
  const fb = FALLBACK_PLAN_CONFIG[planId];
  const src = row ?? fb;
  const moduleFeatures =
    row && row.features && typeof row.features === "object"
      ? { ...fb.features, ...row.features }
      : fb.features;
  return {
    id: planId,
    name: src.label,
    label: src.label,
    priceMxn: src.priceMxnMonthly,
    priceMxnMonthly: src.priceMxnMonthly,
    priceMxnAnnual: src.priceMxnAnnual,
    storageBytes: src.storageBytes,
    aiTokensDefault: src.aiTokensDefault,
    // whatsappMonthly NO se propaga a propósito: cupo retirado del producto
    // (ver PlanConfigShape). La columna sigue en la DB.
    cfdiMonthly: src.cfdiMonthly,
    cfdiOverageCents: src.cfdiOverageCents,
    maxPatients: src.maxPatients,
    maxUsers: src.maxUsers,
    // NULL = ilimitado, igual que maxPatients/maxUsers. Que un NULL accidental
    // (columna recién agregada, fila sin sembrar) NO abra sucursales infinitas
    // en BASIC es responsabilidad del DEFAULT 1 de la columna — ver
    // sql/plan_configs_max_clinics.sql. Aquí un NULL sí es intención explícita
    // del admin ("Ilimitado" en /admin/settings → Planes).
    maxClinics: src.maxClinics,
    features: planBullets(planId, src),
    moduleFeatures,
  };
}
