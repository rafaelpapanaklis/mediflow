/**
 * CONDICIONES CONSERVADAS por clínica (planes nuevos, sep-2026).
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"): es LA regla única de
 * «¿qué límites y qué precio tiene ESTA clínica?». Los sitios que aplican un
 * tope o calculan un importe a cobrar NO comparan contra `plan_configs` a pelo:
 * pasan por aquí (server: `getResolvedPlanForClinic` / `getPlanLimitsForClinic`
 * de @/lib/plans).
 *
 * POR QUÉ EXISTE. Los límites y precios viven por PLAN en `plan_configs`, no por
 * clínica. Cambiar `plan_configs` a los planes nuevos (usuarios 3/5/∞, sedes
 * 1/1/3, Clínica $1,489) cambiaría al instante a TODAS las clínicas de ese plan,
 * y las que ya estaban registradas se quedarían con menos de lo que contrataron
 * (los Profesional bajarían de 6 a 5 usuarios) o pagarían otro precio. Cada
 * fila de Clinic guarda entonces lo suyo en cuatro campos que, si tienen valor,
 * mandan sobre el plan:
 *
 *   maxUsersOverride · maxClinicsOverride · priceMxnMonthlyOverride ·
 *   priceMxnAnnualOverride
 *
 * REGLAS
 *  1. NULL = sin override: sigue lo que diga el plan.
 *  2. En los dos LÍMITES, `-1` (UNLIMITED_OVERRIDE) = ilimitado a propósito. No
 *     puede ser NULL porque NULL ya significa «sin override».
 *  3. Un precio ≤ 0 se ignora (un cero nunca es «gratis» por accidente).
 *  4. GUARDA `planOverrideFor`: los campos solo valen mientras `clinic.plan`
 *     siga siendo ese plan. Quien cambia de plan —desde la app, por un
 *     webhook, desde /admin— deja de tener overrides SIN que ningún sitio se
 *     acuerde de limpiarlos, y pasa a las condiciones vigentes del plan nuevo.
 *     (Volver después al plan de origen por una vía que no limpie la fila los
 *     recupera; `clearOverridesData()` existe para los sitios que sí pueden.)
 *  5. Solo se aplican al plan PROPIO de la clínica: `applyClinicOverrides` no
 *     toca un plan distinto al suyo, así que las tarjetas del resto de planes
 *     (a los que podría cambiarse) muestran siempre las condiciones nuevas.
 */
import type { PlanId } from "@/lib/billing/plans";
import { planBullets, type PlanLimits, type ResolvedPlan } from "@/lib/plan-shared";

/** En maxUsersOverride / maxClinicsOverride: «ilimitado» (NULL = sin override). */
export const UNLIMITED_OVERRIDE = -1;

/** Los campos de Clinic que este módulo lee. Todos opcionales: una fila vieja (o un select corto) = sin override. */
export interface ClinicOverrideFields {
  plan?: string | null;
  planOverrideFor?: string | null;
  maxUsersOverride?: number | null;
  maxClinicsOverride?: number | null;
  priceMxnMonthlyOverride?: number | null;
  priceMxnAnnualOverride?: number | null;
}

/**
 * `select` de Prisma con lo necesario para resolver overrides. Se mezcla en el
 * `select` de cada consulta de clínica que luego llama a getResolvedPlanForClinic:
 *   select: { id: true, ...CLINIC_OVERRIDE_SELECT }
 */
export const CLINIC_OVERRIDE_SELECT = {
  plan: true,
  planOverrideFor: true,
  maxUsersOverride: true,
  maxClinicsOverride: true,
  priceMxnMonthlyOverride: true,
  priceMxnAnnualOverride: true,
} as const;

/** Lo que gana la clínica sobre su plan. `undefined` = sigue el plan; `null` = ilimitado. */
export interface ActiveOverrides {
  maxUsers?: number | null;
  maxClinics?: number | null;
  priceMxnMonthly?: number;
  priceMxnAnnual?: number;
}

function decodeLimit(v: number | null | undefined): number | null | undefined {
  if (v === null || v === undefined || !Number.isFinite(v)) return undefined;
  return v < 0 ? null : Math.floor(v);
}

function decodePrice(v: number | null | undefined): number | undefined {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.round(v);
}

/**
 * Los overrides que de verdad valen HOY para esta clínica, o `null` si ninguno
 * (sin datos, sin guarda, o la clínica ya está en otro plan que el que se
 * conservó).
 */
export function activeOverrides(clinic: ClinicOverrideFields | null | undefined): ActiveOverrides | null {
  if (!clinic || !clinic.plan) return null;
  if (!clinic.planOverrideFor || clinic.planOverrideFor !== clinic.plan) return null;

  const out: ActiveOverrides = {};
  const users = decodeLimit(clinic.maxUsersOverride);
  if (users !== undefined) out.maxUsers = users;
  const branches = decodeLimit(clinic.maxClinicsOverride);
  if (branches !== undefined) out.maxClinics = branches;
  const monthly = decodePrice(clinic.priceMxnMonthlyOverride);
  if (monthly !== undefined) out.priceMxnMonthly = monthly;
  const annual = decodePrice(clinic.priceMxnAnnualOverride);
  if (annual !== undefined) out.priceMxnAnnual = annual;

  return Object.keys(out).length > 0 ? out : null;
}

/** ¿Esta clínica conserva algo distinto de lo que dice su plan? (para la pantalla de /admin). */
export function hasActiveOverrides(clinic: ClinicOverrideFields | null | undefined): boolean {
  return activeOverrides(clinic) !== null;
}

/**
 * El plan RESUELTO con las condiciones de la clínica encima. Si `plan` no es el
 * plan propio de la clínica, o no tiene overrides vigentes, devuelve el mismo
 * objeto sin tocar. Nunca muta.
 */
export function applyClinicOverrides(
  plan: ResolvedPlan,
  clinic: ClinicOverrideFields | null | undefined,
): ResolvedPlan {
  if (!clinic || clinic.plan !== plan.id) return plan;
  const o = activeOverrides(clinic);
  if (!o) return plan;

  const maxUsers = o.maxUsers !== undefined ? o.maxUsers : plan.maxUsers;
  const maxClinics = o.maxClinics !== undefined ? o.maxClinics : plan.maxClinics;
  const priceMxnMonthly = o.priceMxnMonthly ?? plan.priceMxnMonthly;
  const priceMxnAnnual = o.priceMxnAnnual ?? plan.priceMxnAnnual;

  return {
    ...plan,
    priceMxn: priceMxnMonthly,
    priceMxnMonthly,
    priceMxnAnnual,
    maxUsers,
    maxClinics,
    // Los bullets de usuarios/sedes salen de los topes: con override, de los de
    // la clínica (una Profesional de antes ve «6 usuarios», no «5»).
    features: planBullets(plan.id, { maxPatients: plan.maxPatients, maxUsers, maxClinics }),
  };
}

/** Los límites (forma de getPlanLimits) de un plan ya resuelto. */
export function planToLimits(r: ResolvedPlan): PlanLimits {
  return {
    storageBytes: r.storageBytes,
    aiTokensDefault: r.aiTokensDefault,
    cfdiMonthly: r.cfdiMonthly,
    cfdiOverageCents: r.cfdiOverageCents,
    monthlyPrice: r.priceMxnMonthly,
    maxPatients: r.maxPatients,
    maxUsers: r.maxUsers,
    maxClinics: r.maxClinics,
    label: r.label,
  };
}

/**
 * `data` de Prisma que deja a la clínica SIN condiciones conservadas. Lo mezclan
 * los sitios que cambian el plan por decisión de la clínica (change-plan): pasa
 * a las condiciones nuevas del plan elegido y no las recupera si vuelve.
 */
export function clearOverridesData(): {
  planOverrideFor: null;
  maxUsersOverride: null;
  maxClinicsOverride: null;
  priceMxnMonthlyOverride: null;
  priceMxnAnnualOverride: null;
} {
  return {
    planOverrideFor: null,
    maxUsersOverride: null,
    maxClinicsOverride: null,
    priceMxnMonthlyOverride: null,
    priceMxnAnnualOverride: null,
  };
}

/**
 * `data` de Prisma para que una sede NUEVA herede las condiciones de su clínica
 * madre. La sede hereda el `plan` de la madre (POST /api/clinics) y va incluida
 * en su suscripción; sin esto, la sede de una clínica de antes leería los topes
 * nuevos y el dueño vería un cupo distinto según desde qué sede mire.
 * Sin overrides vigentes en la madre → objeto vacío (la sede sigue el plan).
 */
export function inheritedOverridesData(mother: ClinicOverrideFields | null | undefined): {
  planOverrideFor?: PlanId;
  maxUsersOverride?: number | null;
  maxClinicsOverride?: number | null;
  priceMxnMonthlyOverride?: number | null;
  priceMxnAnnualOverride?: number | null;
} {
  if (!activeOverrides(mother) || !mother) return {};
  return {
    planOverrideFor: mother.planOverrideFor as PlanId,
    maxUsersOverride: mother.maxUsersOverride ?? null,
    maxClinicsOverride: mother.maxClinicsOverride ?? null,
    // El precio NO se hereda: la sede va incluida en la suscripción de la madre
    // y no se cobra aparte (monthlyPrice 0, sin suscripción propia).
    priceMxnMonthlyOverride: null,
    priceMxnAnnualOverride: null,
  };
}

/** Las cuatro columnas de override, tal cual se guardan en Clinic. */
export interface OverrideColumns {
  maxUsersOverride: number | null;
  maxClinicsOverride: number | null;
  priceMxnMonthlyOverride: number | null;
  priceMxnAnnualOverride: number | null;
}

// Un solo tipo (no una unión ok/error): el repo compila con strict:false y ahí
// una unión discriminada no se estrecha por `ok`.
export interface OverridesParse {
  ok: boolean;
  error: string | null;
  data: OverrideColumns | null;
}

interface FieldParse {
  ok: boolean;
  error: string | null;
  value: number | null;
}

function parseLimit(v: unknown, label: string): FieldParse {
  if (v === undefined || v === null || v === "") return { ok: true, error: null, value: null };
  if (v === "unlimited") return { ok: true, error: null, value: UNLIMITED_OVERRIDE };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 10_000) {
    return { ok: false, error: `${label}: un entero de 1 a 10000, «Ilimitado», o vacío para seguir el plan`, value: null };
  }
  return { ok: true, error: null, value: n };
}

function parsePrice(v: unknown, label: string): FieldParse {
  if (v === undefined || v === null || v === "") return { ok: true, error: null, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
    return { ok: false, error: `${label}: un entero de pesos mayor que 0, o vacío para seguir el plan`, value: null };
  }
  return { ok: true, error: null, value: n };
}

/**
 * Normaliza lo que manda la pantalla de /admin: `maxUsers` / `maxClinics` =
 * entero ≥ 1, `"unlimited"` o vacío; los dos precios = pesos enteros > 0 o vacío.
 * Los cuatro son independientes y vacío = «sigue el plan». Es lo único que
 * escribe overrides a mano, y siempre lo hace un admin autenticado (ver la ruta).
 */
export function parseOverridesInput(input: Record<string, unknown>): OverridesParse {
  const fields = [
    parseLimit(input.maxUsers, "Usuarios"),
    parseLimit(input.maxClinics, "Sedes"),
    parsePrice(input.priceMxnMonthly, "Precio mensual"),
    parsePrice(input.priceMxnAnnual, "Precio anual"),
  ];
  const bad = fields.find((f) => !f.ok);
  if (bad) return { ok: false, error: bad.error, data: null };
  return {
    ok: true,
    error: null,
    data: {
      maxUsersOverride: fields[0].value,
      maxClinicsOverride: fields[1].value,
      priceMxnMonthlyOverride: fields[2].value,
      priceMxnAnnualOverride: fields[3].value,
    },
  };
}
