import "server-only";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError } from "@/lib/barber/permissions";
import { getBarberPlan, getBarberPlans } from "@/lib/barber/plans";
import {
  formatBarberPrice,
  isBarberUnlimited,
  isBarbershopSubscriptionActive,
  type BarberPlanId,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";
import { getBarberT } from "@/i18n/dictionaries/barber";

/**
 * DaleControl BARBER — gate por PLAN (features y límites duros).
 *
 * Dos ejes distintos, ambos en el SERVIDOR:
 *   · por ROL  → src/lib/barber/permissions.ts (hasBarberPermission /
 *                assertBarberPermission en barber-auth). No se duplica aquí.
 *   · por PLAN → ESTE módulo: ¿el plan contratado incluye la feature? ¿cabe
 *                un barbero / una sede más? ¿la suscripción está al día?
 *
 * Fuente de verdad: la tabla barber_plan_configs vía getBarberPlan /
 * getBarberPlans (src/lib/barber/plans.ts). Aquí NO hay precios ni límites
 * escritos: todo se lee. Los mensajes de "qué plan lo permite" salen del
 * diccionario barber.suscripcion.gate.* con el precio leído de la tabla.
 *
 * QUIÉN PAGA: la MATRIZ (parentId null). Una sucursal hereda plan y estado de
 * su matriz — el webhook de suscripción los propaga a toda la familia, y aquí
 * el gate se resuelve SIEMPRE sobre la fila raíz. Los límites se cuentan sobre
 * la familia completa (matriz + sucursales activas): la unidad que paga es la
 * unidad que se limita.
 *
 * REGLA DE ORO: ocultar un botón no es gating. Cada endpoint de una feature de
 * pago llama assertBarberFeature / assertBarberLimit ANTES de actuar y mapea
 * el error con barberGateErrorPayload. Las funciones son async (el plan vive
 * en la tabla): un `if (hasBarberFeature(...))` sin await es un bug — una
 * Promise siempre es truthy.
 *
 * DEGRADACIÓN DE PLAN (decisión documentada): si una barbería con 4 barberos
 * baja a un plan de 1, NO se borra ni desactiva nada. `used > max` deja a la
 * barbería "excedida": assertBarberLimit bloquea la creación de más (con el
 * mensaje de qué plan lo permite) y getBarberGate expone `overLimit` para que
 * la pantalla de suscripción avise. Lo existente sigue operando.
 */

export type BarberLimitKey = "barbers" | "branches";

export type BarberGateCode = "SUBSCRIPTION_INACTIVE" | "FEATURE_LOCKED" | "LIMIT_REACHED";

/** Error tipado del gate por plan; las APIs lo mapean con barberGateErrorPayload. */
export class BarberPlanGateError extends Error {
  readonly code: BarberGateCode;
  /** 402 = hay que pagar/activar; 403 = el plan no lo incluye / tope alcanzado. */
  readonly status: 402 | 403;
  readonly feature: string | null;
  readonly limit: BarberLimitKey | null;
  /** Plan (id) que SÍ lo permite, si existe uno. */
  readonly requiredPlan: BarberPlanId | null;

  constructor(
    code: BarberGateCode,
    message: string,
    extra?: { feature?: string; limit?: BarberLimitKey; requiredPlan?: BarberPlanId | null },
  ) {
    super(message);
    this.name = "BarberPlanGateError";
    this.code = code;
    this.status = code === "SUBSCRIPTION_INACTIVE" ? 402 : 403;
    this.feature = extra?.feature ?? null;
    this.limit = extra?.limit ?? null;
    this.requiredPlan = extra?.requiredPlan ?? null;
  }
}

export interface BarberLimitState {
  /** -1 = ilimitado (BARBER_UNLIMITED). */
  max: number;
  used: number;
  /** used > max con límite finito: la barbería está EXCEDIDA (bajó de plan). */
  overLimit: boolean;
}

export interface BarberGate {
  /** Fila que paga (matriz). Igual a ctx.barbershopId si la sesión es de la matriz. */
  rootBarbershopId: string;
  planId: BarberPlanId;
  plan: BarberResolvedPlan;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  limits: Record<BarberLimitKey, BarberLimitState>;
}

export interface BarberLimitCheck {
  ok: boolean;
  key: BarberLimitKey;
  max: number;
  used: number;
  adding: number;
  overLimit: boolean;
  /** Plan más barato (activo, distinto del actual) que sí permite `used + adding`. */
  requiredPlan: BarberResolvedPlan | null;
  /** Mensaje listo para el usuario (locale de la barbería). Vacío si ok. */
  message: string;
}

// ── Núcleo PURO (sin BD) — lo usan los helpers de abajo y las pruebas ────

/** ¿El plan resuelto incluye la feature? (mapa `features` de la tabla) */
export function evaluateBarberFeature(
  plan: Pick<BarberResolvedPlan, "features"> | null | undefined,
  featureKey: string,
): boolean {
  return plan?.features?.[featureKey] === true;
}

export function planLimit(plan: Pick<BarberResolvedPlan, "maxBarbers" | "maxBranches">, key: BarberLimitKey): number {
  return key === "barbers" ? plan.maxBarbers : plan.maxBranches;
}

export function limitAllows(max: number, needed: number): boolean {
  return isBarberUnlimited(max) || needed <= max;
}

/**
 * Plan más BARATO (mensual) entre los activos, distinto de `currentPlanId`,
 * cuyo límite `key` admite `needed`. null si ninguno lo permite.
 */
export function pickBarberPlanForLimit(
  plans: BarberResolvedPlan[],
  key: BarberLimitKey,
  needed: number,
  currentPlanId?: BarberPlanId | null,
): BarberResolvedPlan | null {
  const candidates = plans
    .filter((p) => p.isActive && p.id !== currentPlanId && limitAllows(planLimit(p, key), needed))
    .sort((a, b) => a.priceMonthly - b.priceMonthly);
  return candidates[0] ?? null;
}

/** Decisión pura del límite: ¿caben `adding` más con `used` en uso? */
export function evaluateBarberLimit(args: {
  plan: BarberResolvedPlan;
  plans: BarberResolvedPlan[];
  key: BarberLimitKey;
  used: number;
  adding?: number;
}): Omit<BarberLimitCheck, "message"> {
  const adding = Math.max(0, args.adding ?? 1);
  const max = planLimit(args.plan, args.key);
  const ok = limitAllows(max, args.used + adding);
  const overLimit = !isBarberUnlimited(max) && args.used > max;
  const requiredPlan = ok
    ? null
    : pickBarberPlanForLimit(args.plans, args.key, args.used + adding, args.plan.id);
  return { ok, key: args.key, max, used: args.used, adding, overLimit, requiredPlan };
}

/** Texto "1 barbero" / "5 barberos" / "Barberos ilimitados" en el locale dado. */
export function describeBarberLimit(
  t: ReturnType<typeof getBarberT>,
  key: BarberLimitKey,
  max: number,
): string {
  const base = `barber.suscripcion.limits.${key}`;
  if (isBarberUnlimited(max)) return t(`${base}.unlimited`);
  return t(`${base}.count`, { count: max });
}

/** Mensaje de tope alcanzado con el plan que sí lo permite (precio LEÍDO de la tabla). */
export function limitReachedMessage(
  t: ReturnType<typeof getBarberT>,
  plan: BarberResolvedPlan,
  check: Omit<BarberLimitCheck, "message">,
): string {
  const noun = t(`barber.suscripcion.limits.${check.key}.noun`);
  const head = t("barber.suscripcion.gate.limitReached", {
    plan: plan.name,
    limit: describeBarberLimit(t, check.key, check.max),
    noun,
  });
  if (!check.requiredPlan) return `${head} ${t("barber.suscripcion.gate.noPlanAllows", { noun })}`;
  return `${head} ${t("barber.suscripcion.gate.upgradeTo", {
    plan: check.requiredPlan.name,
    limit: describeBarberLimit(t, check.key, planLimit(check.requiredPlan, check.key)),
    price: formatBarberPrice(check.requiredPlan.priceMonthly),
  })}`;
}

// ── Resolución de la matriz + uso real (BD) ──────────────────────────────

function rootIdOf(ctx: Pick<BarberContext, "barbershopId" | "barbershop">): string {
  return ctx.barbershop.parentId ?? ctx.barbershopId;
}

/** Fila que paga: la matriz. Si la sesión ya es la matriz, no se vuelve a leer. */
async function loadRootShop(ctx: BarberContext): Promise<{
  id: string;
  plan: string;
  subscriptionStatus: string;
}> {
  const rootId = rootIdOf(ctx);
  if (rootId === ctx.barbershopId) {
    return {
      id: ctx.barbershopId,
      plan: ctx.barbershop.plan,
      subscriptionStatus: ctx.barbershop.subscriptionStatus,
    };
  }
  const root = await prisma.barbershop.findUnique({
    where: { id: rootId },
    select: { id: true, plan: true, subscriptionStatus: true },
  });
  // Matriz borrada/inexistente: la sucursal se evalúa con su propia fila
  // (que el webhook mantiene sincronizada) antes que abrir la puerta.
  return root ?? {
    id: ctx.barbershopId,
    plan: ctx.barbershop.plan,
    subscriptionStatus: ctx.barbershop.subscriptionStatus,
  };
}

/** Sedes ACTIVAS de la familia (matriz primero). La matriz cuenta aunque esté inactiva. */
export async function getBarberFamilyIds(rootId: string): Promise<string[]> {
  const rows = await prisma.barbershop.findMany({
    where: { OR: [{ id: rootId }, { parentId: rootId, isActive: true }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const ids = rows.map((r) => r.id).filter((id) => id !== rootId);
  return [rootId, ...ids];
}

/**
 * Uso real contra los límites: barberos ACTIVOS de toda la familia y sedes
 * activas INCLUYENDO la matriz (maxBranches = número total de sedes; 1 = solo
 * la matriz). Lo inactivo no cuenta: degradar de plan no borra nada.
 */
export async function countBarberUsage(rootId: string): Promise<Record<BarberLimitKey, number>> {
  const familyIds = await getBarberFamilyIds(rootId);
  const barbers = await prisma.barber.count({
    where: { barbershopId: { in: familyIds }, isActive: true },
  });
  return { barbers, branches: familyIds.length };
}

// ── API pública (async: el plan vive en la tabla) ────────────────────────

/** Estado completo del gate de la barbería (plan resuelto, suscripción, uso vs límites). */
export async function getBarberGate(ctx: BarberContext): Promise<BarberGate> {
  const root = await loadRootShop(ctx);
  const plan = await getBarberPlan(root.plan);
  const used = await countBarberUsage(root.id);
  const limitState = (key: BarberLimitKey): BarberLimitState => {
    const max = planLimit(plan, key);
    return { max, used: used[key], overLimit: !isBarberUnlimited(max) && used[key] > max };
  };
  return {
    rootBarbershopId: root.id,
    planId: plan.id,
    plan,
    subscriptionStatus: root.subscriptionStatus,
    subscriptionActive: isBarbershopSubscriptionActive(root),
    limits: { barbers: limitState("barbers"), branches: limitState("branches") },
  };
}

/**
 * ¿El plan contratado incluye la feature? Pregunta SOLO por el plan (igual
 * que el sidebar): no mira si la suscripción está pagada. Para cortar un
 * endpoint usa assertBarberFeature, que exige además suscripción activa.
 */
export async function hasBarberFeature(ctx: BarberContext, featureKey: string): Promise<boolean> {
  const root = await loadRootShop(ctx);
  const plan = await getBarberPlan(root.plan);
  return evaluateBarberFeature(plan, featureKey);
}

/** Suscripción al día (active | trialing | paid) sobre la fila que paga. */
export async function assertBarberSubscriptionActive(ctx: BarberContext): Promise<void> {
  const root = await loadRootShop(ctx);
  if (!isBarbershopSubscriptionActive(root)) {
    const t = getBarberT(ctx.barbershop.locale);
    throw new BarberPlanGateError("SUBSCRIPTION_INACTIVE", t("barber.suscripcion.gate.inactive"));
  }
}

/**
 * Gate de una feature de pago para endpoints: suscripción activa Y plan que
 * la incluye. Lanza BarberPlanGateError (402 / 403).
 *
 *   const ctx = await getBarberContext();
 *   if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
 *   try { assertBarberPermission(ctx, "walkin.manage"); await assertBarberFeature(ctx, "walkinQueue"); }
 *   catch (err) { const gate = barberGateErrorPayload(err); if (gate) return NextResponse.json(gate.body, { status: gate.status }); throw err; }
 */
export async function assertBarberFeature(ctx: BarberContext, featureKey: string): Promise<void> {
  const root = await loadRootShop(ctx);
  const t = getBarberT(ctx.barbershop.locale);
  if (!isBarbershopSubscriptionActive(root)) {
    throw new BarberPlanGateError("SUBSCRIPTION_INACTIVE", t("barber.suscripcion.gate.inactive"), {
      feature: featureKey,
    });
  }
  const plan = await getBarberPlan(root.plan);
  if (evaluateBarberFeature(plan, featureKey)) return;

  // Plan más barato que SÍ la incluye (para decir cuál, con su precio leído).
  const plans = await getBarberPlans();
  const required = plans
    .filter((p) => p.isActive && p.id !== plan.id && evaluateBarberFeature(p, featureKey))
    .sort((a, b) => a.priceMonthly - b.priceMonthly)[0] ?? null;
  // t() devuelve la propia llave si no existe la traducción → se muestra la key.
  const featureLabel = t(`barber.suscripcion.features.${featureKey}`);
  const label = featureLabel.endsWith(`.${featureKey}`) ? featureKey : featureLabel;
  const message = required
    ? t("barber.suscripcion.gate.featureLockedUpgrade", {
        feature: label,
        plan: plan.name,
        required: required.name,
        price: formatBarberPrice(required.priceMonthly),
      })
    : t("barber.suscripcion.gate.featureLocked", { feature: label, plan: plan.name });
  throw new BarberPlanGateError("FEATURE_LOCKED", message, {
    feature: featureKey,
    requiredPlan: required?.id ?? null,
  });
}

/** ¿Caben `adding` barberos/sedes más? No lanza: devuelve la decisión + mensaje. */
export async function checkBarberLimit(
  ctx: BarberContext,
  key: BarberLimitKey,
  adding: number = 1,
): Promise<BarberLimitCheck> {
  const root = await loadRootShop(ctx);
  const [plan, plans, used] = await Promise.all([
    getBarberPlan(root.plan),
    getBarberPlans(),
    countBarberUsage(root.id),
  ]);
  const decision = evaluateBarberLimit({ plan, plans, key, used: used[key], adding });
  const t = getBarberT(ctx.barbershop.locale);
  return { ...decision, message: decision.ok ? "" : limitReachedMessage(t, plan, decision) };
}

/**
 * Límite duro en el SERVIDOR: lanza BarberPlanGateError (403, LIMIT_REACHED)
 * con el mensaje de qué plan lo permite. Llamar ANTES de crear el barbero o la
 * sede (y dentro de la misma petición que crea, para que la cuenta sea fresca).
 */
export async function assertBarberLimit(
  ctx: BarberContext,
  key: BarberLimitKey,
  adding: number = 1,
): Promise<void> {
  const check = await checkBarberLimit(ctx, key, adding);
  if (check.ok) return;
  throw new BarberPlanGateError("LIMIT_REACHED", check.message, {
    limit: key,
    requiredPlan: check.requiredPlan?.id ?? null,
  });
}

// ── Mapeo a respuesta HTTP (sin importar next/server: cuerpo + status) ───

export interface BarberGateErrorPayload {
  status: number;
  body: {
    error: string;
    code: string;
    feature?: string | null;
    limit?: BarberLimitKey | null;
    requiredPlan?: BarberPlanId | null;
    permission?: string;
  };
}

/**
 * Traduce los errores de los dos ejes a `{ status, body }`:
 *   · BarberPlanGateError  → 402 / 403 con code SUBSCRIPTION_INACTIVE |
 *                            FEATURE_LOCKED | LIMIT_REACHED (+ requiredPlan).
 *   · BarberForbiddenError → 403 con code FORBIDDEN (permiso de rol).
 * Cualquier otro error → null (la ruta decide).
 */
export function barberGateErrorPayload(err: unknown): BarberGateErrorPayload | null {
  if (err instanceof BarberPlanGateError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        feature: err.feature,
        limit: err.limit,
        requiredPlan: err.requiredPlan,
      },
    };
  }
  if (err instanceof BarberForbiddenError) {
    return {
      status: 403,
      body: { error: "Sin permiso para esta acción.", code: "FORBIDDEN", permission: err.permission },
    };
  }
  return null;
}
