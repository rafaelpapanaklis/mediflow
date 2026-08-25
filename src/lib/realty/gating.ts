/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — GATING. El punto ÚNICO que responde
 * "¿esta cuenta puede X?".
 *
 * 🔴 REGLA DURA: se gatea por la FEATURE del plan (`whatsapp`, `webEditor`,
 * `commissions`, `multiOffice`, `agentPages`, `mls`, `pld`, `aiStudio`…),
 * NUNCA por el id del plan escrito a mano. Cambiar el reparto de features
 * entre planes debe ser EDITAR UNA FILA de `realty_plan_configs`, no tocar
 * código. Si en una pantalla lees `plan.id === "INMOBILIARIA"`, eso es un
 * bug: usa `realtyCan(plan, "mls")`.
 *
 * 🔴 CERO PRECIOS EN EL CÓDIGO. Cuando una feature está apagada, el mensaje
 * dice en qué plan viene y cuánto cuesta — con el precio LEÍDO del catálogo
 * (`getRealtyPlans()` → tabla `realty_plan_configs`). Este módulo nunca
 * inventa un número: si no le pasas el catálogo, no menciona precio.
 *
 * Sin dark patterns: se explica qué falta y dónde está, sin contadores
 * falsos, sin "última oportunidad" y sin esconder el botón de cancelar.
 *
 * ── DÓNDE VIVE CADA COSA ───────────────────────────────────────────────
 * · ESTE archivo es PURO y client-safe: no importa prisma ni "server-only".
 *   Se puede usar en server components, en route handlers y en el cliente.
 *   Todo lo que necesita ya viene resuelto en `getRealtyContext()`:
 *   `ctx.plan` (tabla con fallback) y `ctx.account` (consumo de storage y
 *   de mensajes).
 * · MEDIR el consumo que sí requiere base (usuarios, oficinas, inmuebles)
 *   vive en `@/lib/realty/billing.ts` → `getRealtyUsage(accountId)`, que es
 *   server-only. Aquí se DECIDE; allá se MIDE.
 *
 * ── LÍMITES DUROS ──────────────────────────────────────────────────────
 *   maxUsers · maxOffices · maxProperties · storageQuotaMb · messageQuota
 * Al 90 % del cupo se AVISA (`nearLimit`, `warning`); al 100 % se BLOQUEA
 * con un mensaje que dice qué pasó y cuál es la salida.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  REALTY_UNLIMITED,
  formatRealtyPrice,
  formatRealtyStorage,
  isRealtySubscriptionActive,
  isRealtyUnlimited,
  realtyFeatureLabel,
  realtyPlanHasFeature,
  realtyPlanRank,
  type RealtyPlanId,
  type RealtyResolvedPlan,
} from "@/lib/realty/plan-shared";
import {
  REALTY_NAV_ITEMS,
  navItemAllowsMode,
  type RealtyMode,
  type RealtyNavItemDef,
  type RealtyRole,
} from "@/lib/realty/types";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";

export { isRealtySubscriptionActive };

/** A partir de este porcentaje del cupo se avisa (pero todavía se deja). */
export const REALTY_QUOTA_WARNING_PCT = 90;

const BYTES_PER_MB = 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════
// 1. FEATURES
// ═══════════════════════════════════════════════════════════════════════

/** ¿El plan trae esta feature? Booleano pelado, para un `if` rápido. */
export function realtyCan(
  plan: { features: Record<string, boolean> } | null | undefined,
  featureKey: string,
): boolean {
  return realtyPlanHasFeature(plan, featureKey);
}

export interface RealtyFeatureGate {
  allowed: boolean;
  featureKey: string;
  /** Etiqueta humana de la feature (catálogo de plan-shared). */
  featureLabel: string;
  /** Plan MÁS BARATO que sí la incluye. null = no la trae ningún plan. */
  upgradePlan: RealtyResolvedPlan | null;
  /** Copy honesto para la UI. Vacío cuando `allowed` es true. */
  message: string;
}

/**
 * El plan más barato del catálogo que trae la feature, por encima del
 * plan actual. `catalog` sale de `getRealtyPlans()`; si llega vacío, el
 * resultado es null y el mensaje NO menciona precio (nunca se inventa uno).
 */
export function realtyFeatureUpgradePlan(
  featureKey: string,
  catalog: readonly RealtyResolvedPlan[],
  from?: RealtyPlanId | null,
): RealtyResolvedPlan | null {
  const minRank = from ? realtyPlanRank(from) : -1;
  const candidates = catalog
    .filter(
      (p) =>
        p.isActive && realtyPlanHasFeature(p, featureKey) && realtyPlanRank(p.id) > minRank,
    )
    .sort((a, b) => realtyPlanRank(a.id) - realtyPlanRank(b.id));
  return candidates[0] ?? null;
}

/**
 * Puerta de una feature, con el copy ya armado para la pantalla.
 *
 *   const gate = realtyFeatureGate(ctx.plan, "commissions", catalogo);
 *   if (!gate.allowed) return <RealtyFeatureLock gate={gate} />;
 */
export function realtyFeatureGate(
  plan: Pick<RealtyResolvedPlan, "id" | "features">,
  featureKey: string,
  catalog: readonly RealtyResolvedPlan[] = [],
): RealtyFeatureGate {
  const featureLabel = realtyFeatureLabel(featureKey);
  if (realtyPlanHasFeature(plan, featureKey)) {
    return { allowed: true, featureKey, featureLabel, upgradePlan: null, message: "" };
  }
  const upgradePlan = realtyFeatureUpgradePlan(featureKey, catalog, plan.id);
  const message = upgradePlan
    ? `${featureLabel} viene en el plan ${upgradePlan.name}, ` +
      `${formatRealtyPrice(upgradePlan.priceMonthly)} al mes.`
    : `${featureLabel} no está incluido en tu plan.`;
  return { allowed: false, featureKey, featureLabel, upgradePlan, message };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. LÍMITES DUROS
// ═══════════════════════════════════════════════════════════════════════

export type RealtyLimitKey = "users" | "offices" | "properties" | "storage" | "messages";

/** Acciones que un límite puede frenar. */
export type RealtyLimitedAction =
  | "addUser"
  | "addOffice"
  | "addProperty"
  | "uploadFile"
  | "sendMessage";

const ACTION_LIMIT: Record<RealtyLimitedAction, RealtyLimitKey> = {
  addUser: "users",
  addOffice: "offices",
  addProperty: "properties",
  uploadFile: "storage",
  sendMessage: "messages",
};

const LIMIT_NOUN: Record<RealtyLimitKey, { singular: string; plural: string }> = {
  users: { singular: "usuario", plural: "usuarios" },
  offices: { singular: "oficina", plural: "oficinas" },
  properties: { singular: "inmueble", plural: "inmuebles" },
  storage: { singular: "espacio", plural: "espacio" },
  messages: { singular: "mensaje", plural: "mensajes" },
};

export interface RealtyLimitState {
  key: RealtyLimitKey;
  /** Consumo actual. En `storage` son BYTES. */
  used: number;
  /** Cupo. -1 = ilimitado. En `storage` son BYTES (ya convertidos de MB). */
  limit: number;
  unlimited: boolean;
  /** Lo que queda. Infinity si es ilimitado. */
  remaining: number;
  /** 0-999. Es 0 cuando es ilimitado; puede pasar de 100 si ya se excedió. */
  percent: number;
  /** ≥ 90 % y no ilimitado: todavía se puede, pero hay que avisar. */
  nearLimit: boolean;
  atLimit: boolean;
}

/** Estado de un límite. `limit` -1 = ilimitado, 0 = el plan no lo incluye. */
export function realtyLimitState(
  key: RealtyLimitKey,
  used: number,
  limit: number,
): RealtyLimitState {
  const u = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  if (isRealtyUnlimited(limit)) {
    return {
      key,
      used: u,
      limit: REALTY_UNLIMITED,
      unlimited: true,
      remaining: Number.POSITIVE_INFINITY,
      percent: 0,
      nearLimit: false,
      atLimit: false,
    };
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  // cap 0 (p. ej. messageQuota del plan de entrada) = cupo agotado desde el
  // primer minuto: 100 % y bloqueado. Eso es correcto — la feature de
  // WhatsApp además está apagada en ese plan, así que la UI ni la ofrece.
  const percent = cap === 0 ? 100 : Math.min(999, Math.round((u / cap) * 100));
  return {
    key,
    used: u,
    limit: cap,
    unlimited: false,
    remaining: Math.max(0, cap - u),
    percent,
    nearLimit: percent >= REALTY_QUOTA_WARNING_PCT,
    atLimit: u >= cap,
  };
}

/** Cupo del plan para un límite. `storage` sale en BYTES, no en MB. */
export function realtyPlanLimit(
  plan: Pick<
    RealtyResolvedPlan,
    "maxUsers" | "maxOffices" | "maxProperties" | "storageQuotaMb" | "messageQuota"
  >,
  key: RealtyLimitKey,
): number {
  switch (key) {
    case "users":
      return plan.maxUsers;
    case "offices":
      return plan.maxOffices;
    case "properties":
      return plan.maxProperties;
    case "storage":
      return isRealtyUnlimited(plan.storageQuotaMb)
        ? REALTY_UNLIMITED
        : plan.storageQuotaMb * BYTES_PER_MB;
    case "messages":
      return plan.messageQuota;
  }
}

/**
 * Cupo EFECTIVO de mensajes: la columna `messageQuota` de la cuenta PISA
 * la del plan (así soporte puede regalar mensajes sin cambiar de plan).
 * null/undefined en la cuenta = manda `realty_plan_configs`.
 */
export function resolveRealtyMessageQuota(
  account: { messageQuota?: number | null } | null | undefined,
  plan: Pick<RealtyResolvedPlan, "messageQuota">,
): number {
  const own = account?.messageQuota;
  return own === null || own === undefined ? plan.messageQuota : own;
}

/** Consumo medido de una cuenta. Lo llena `getRealtyUsage()` (billing.ts). */
export interface RealtyUsageCounts {
  users: number;
  offices: number;
  properties: number;
  /** BYTES de `realty_accounts.storageUsedBytes`. */
  storageBytes: number;
  /** Mensajes del periodo (`messagesUsedPeriod`). */
  messages: number;
  /**
   * true = NO se pudo contar (la base falló). Los medidores se pintan igual
   * con lo que haya, pero los CUPOS fallan CERRADOS: con ceros de mentira,
   * "0 de 1 usuarios" deja pasar a todo el mundo. Un cupo que se cae en
   * silencio regala capacidad.
   */
  degraded?: boolean;
}

/** Los cinco límites de una cuenta, listos para pintar barras de consumo. */
export function realtyUsageStates(
  plan: RealtyResolvedPlan,
  usage: RealtyUsageCounts,
  account?: { messageQuota?: number | null } | null,
): Record<RealtyLimitKey, RealtyLimitState> {
  return {
    users: realtyLimitState("users", usage.users, realtyPlanLimit(plan, "users")),
    offices: realtyLimitState("offices", usage.offices, realtyPlanLimit(plan, "offices")),
    properties: realtyLimitState(
      "properties",
      usage.properties,
      realtyPlanLimit(plan, "properties"),
    ),
    storage: realtyLimitState("storage", usage.storageBytes, realtyPlanLimit(plan, "storage")),
    messages: realtyLimitState(
      "messages",
      usage.messages,
      resolveRealtyMessageQuota(account, plan),
    ),
  };
}

/** Plan más barato cuyo cupo alcanza para `needed` (o es ilimitado). */
export function realtyLimitUpgradePlan(
  key: RealtyLimitKey,
  needed: number,
  catalog: readonly RealtyResolvedPlan[],
  from?: RealtyPlanId | null,
): RealtyResolvedPlan | null {
  const minRank = from ? realtyPlanRank(from) : -1;
  const candidates = catalog
    .filter((p) => {
      if (!p.isActive || realtyPlanRank(p.id) <= minRank) return false;
      const cap = realtyPlanLimit(p, key);
      return isRealtyUnlimited(cap) || cap >= needed;
    })
    .sort((a, b) => realtyPlanRank(a.id) - realtyPlanRank(b.id));
  return candidates[0] ?? null;
}

export interface RealtyLimitGate {
  allowed: boolean;
  key: RealtyLimitKey;
  state: RealtyLimitState;
  upgradePlan: RealtyResolvedPlan | null;
  /** Por qué NO se puede. Vacío cuando `allowed` es true. */
  message: string;
  /** Aviso del 90 %: se puede, pero conviene decirlo. null si no aplica. */
  warning: string | null;
}

/** "2 GB" / "512 MB" — el consumo de storage se enseña en bytes humanos. */
export function formatRealtyBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < BYTES_PER_MB) return `${Math.round(b / 1024)} KB`;
  return formatRealtyStorage(Math.round(b / BYTES_PER_MB));
}

function describeLimit(key: RealtyLimitKey, value: number): string {
  if (key === "storage") return formatRealtyBytes(value);
  const noun = LIMIT_NOUN[key];
  return value === 1 ? `1 ${noun.singular}` : `${value} ${noun.plural}`;
}

function upgradeTail(plan: RealtyResolvedPlan | null, key: RealtyLimitKey): string {
  if (!plan) return "";
  const cap = realtyPlanLimit(plan, key);
  const capTxt = isRealtyUnlimited(cap)
    ? key === "storage"
      ? "espacio ilimitado"
      : `${LIMIT_NOUN[key].plural} ilimitados`
    : describeLimit(key, cap);
  return (
    ` El plan ${plan.name} (${formatRealtyPrice(plan.priceMonthly)} al mes) ` +
    `incluye ${capTxt}.`
  );
}

/**
 * ¿Cabe una acción más dentro del cupo?
 *
 *   const gate = realtyLimitGate("addUser", { plan, usage, catalog });
 *   if (!gate.allowed) return NextResponse.json({ error: gate.message }, { status: 402 });
 *
 * `amount` es cuánto se quiere consumir (1 usuario, N bytes de un archivo).
 */
export function realtyLimitGate(
  action: RealtyLimitedAction,
  input: {
    plan: RealtyResolvedPlan;
    usage: RealtyUsageCounts;
    catalog?: readonly RealtyResolvedPlan[];
    account?: { messageQuota?: number | null } | null;
    amount?: number;
  },
): RealtyLimitGate {
  const key = ACTION_LIMIT[action];
  const catalog = input.catalog ?? [];
  const state = realtyUsageStates(input.plan, input.usage, input.account ?? null)[key];
  const amount = Math.max(1, Math.floor(input.amount ?? 1));

  const warning =
    state.nearLimit && !state.atLimit
      ? key === "storage"
        ? `Ya usaste el ${state.percent} % de tu espacio ` +
          `(${formatRealtyBytes(state.used)} de ${formatRealtyBytes(state.limit)}).`
        : `Ya usaste el ${state.percent} % de tu cupo de ${LIMIT_NOUN[key].plural} ` +
          `(${state.used} de ${state.limit}).`
      : null;

  // No se pudo medir → no se autoriza (ver `degraded` en RealtyUsageCounts).
  if (input.usage.degraded) {
    return {
      allowed: false,
      key,
      state,
      upgradePlan: null,
      message:
        "No pudimos comprobar tu consumo en este momento. Inténtalo de nuevo en un minuto.",
      warning: null,
    };
  }

  if (state.unlimited) {
    return { allowed: true, key, state, upgradePlan: null, message: "", warning: null };
  }

  const fits = state.used + amount <= state.limit;
  if (fits) {
    return { allowed: true, key, state, upgradePlan: null, message: "", warning };
  }

  const needed = state.used + amount;
  const upgradePlan = realtyLimitUpgradePlan(key, needed, catalog, input.plan.id);

  let message: string;
  if (key === "storage") {
    message =
      state.remaining <= 0
        ? `Te quedaste sin espacio: usaste ${formatRealtyBytes(state.used)} de ` +
          `${formatRealtyBytes(state.limit)}. Borra archivos que ya no uses o cambia de plan.`
        : `Ese archivo (${formatRealtyBytes(amount)}) no cabe: te quedan ` +
          `${formatRealtyBytes(state.remaining)} de ${formatRealtyBytes(state.limit)}.`;
  } else if (key === "messages") {
    message =
      state.limit === 0
        ? "Tu plan no incluye mensajes de WhatsApp."
        : `Se agotaron los ${state.limit} mensajes de tu plan en este periodo.`;
  } else {
    message =
      `Tu plan ${input.plan.name} llega hasta ${describeLimit(key, state.limit)} ` +
      `y ya tienes ${state.used}.`;
  }

  return { allowed: false, key, state, upgradePlan, message: message + upgradeTail(upgradePlan, key), warning };
}

/**
 * Atajo para la subida de archivos, que es el caso con más aristas: avisa
 * al 90 % y bloquea al 100 % con el tamaño real del archivo.
 */
export function realtyUploadGate(input: {
  plan: RealtyResolvedPlan;
  storageUsedBytes: number | bigint;
  incomingBytes: number;
  catalog?: readonly RealtyResolvedPlan[];
}): RealtyLimitGate {
  const used = typeof input.storageUsedBytes === "bigint"
    ? Number(input.storageUsedBytes)
    : input.storageUsedBytes;
  return realtyLimitGate("uploadFile", {
    plan: input.plan,
    usage: { users: 0, offices: 0, properties: 0, storageBytes: used, messages: 0 },
    catalog: input.catalog,
    amount: Math.max(1, Math.floor(input.incomingBytes)),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 3. ERROR TIPADO — para que las APIs devuelvan siempre lo mismo
// ═══════════════════════════════════════════════════════════════════════

export type RealtyGateCode =
  | "SUBSCRIPTION_INACTIVE"
  | "FEATURE_LOCKED"
  | "LIMIT_REACHED";

/**
 * Lo lanzan los `assert*`. Las rutas lo mapean a **402 Payment Required**
 * (no 403: no es que no tengas permiso, es que tu plan no lo incluye).
 */
export class RealtyGateError extends Error {
  readonly code: RealtyGateCode;
  readonly featureKey: string | null;
  readonly limitKey: RealtyLimitKey | null;
  readonly upgradePlanId: RealtyPlanId | null;

  constructor(
    code: RealtyGateCode,
    message: string,
    extra?: {
      featureKey?: string | null;
      limitKey?: RealtyLimitKey | null;
      upgradePlanId?: RealtyPlanId | null;
    },
  ) {
    super(message);
    this.name = "RealtyGateError";
    this.code = code;
    this.featureKey = extra?.featureKey ?? null;
    this.limitKey = extra?.limitKey ?? null;
    this.upgradePlanId = extra?.upgradePlanId ?? null;
  }
}

/**
 * ¿La cuenta pagó? Punto ÚNICO del corte por suscripción impaga.
 *
 * 🔴 HUECO CONOCIDO DEL VERTICAL: hoy el único corte real está en el router
 * `/inmobiliaria/page.tsx`. El layout del panel NO corta (a propósito: cortar
 * ahí crearía un bucle con /inmobiliaria/suscripcion), así que una cuenta
 * impaga que escriba la URL de una pantalla interna a mano entra igual.
 * `src/app/inmobiliaria/(panel)/layout.tsx` está FUERA de la allowlist de
 * esta ola, así que aquí se deja el punto único listo y cada pantalla o
 * endpoint lo cablea con UNA línea:
 *
 *   assertRealtySubscription(ctx.account);   // 402 si no pagó
 *
 * Y en el layout, cuando su dueño lo cablee, la única línea que falta es
 * recortar el menú con `realtyNavItemsWhileUnpaid` (plan-shared).
 *
 * Ojo con los DOS conjuntos: "con acceso" (active | trialing | paid) NO es lo
 * mismo que "viva para Stripe" (active | trialing | past_due | unpaid). Un
 * past_due sigue siendo una suscripción viva en Stripe, pero NO da acceso.
 */
export function assertRealtySubscription(
  account: { subscriptionStatus?: string | null; isActive?: boolean } | null | undefined,
): void {
  if (account?.isActive === false) {
    throw new RealtyGateError(
      "SUBSCRIPTION_INACTIVE",
      "Esta cuenta está deshabilitada. Escríbenos a soporte.",
    );
  }
  if (isRealtySubscriptionActive(account)) return;
  throw new RealtyGateError(
    "SUBSCRIPTION_INACTIVE",
    "Tu suscripción no está al corriente. Ponla al día desde Suscripción para seguir usando el panel.",
  );
}

/** Lanza si la feature está apagada. Úsalo en route handlers y actions. */
export function assertRealtyFeature(
  plan: Pick<RealtyResolvedPlan, "id" | "features">,
  featureKey: string,
  catalog: readonly RealtyResolvedPlan[] = [],
): void {
  const gate = realtyFeatureGate(plan, featureKey, catalog);
  if (gate.allowed) return;
  throw new RealtyGateError("FEATURE_LOCKED", gate.message, {
    featureKey,
    upgradePlanId: gate.upgradePlan?.id ?? null,
  });
}

/** Lanza si el cupo ya no da. Mismo contrato que `assertRealtyFeature`. */
export function assertRealtyLimit(
  action: RealtyLimitedAction,
  input: Parameters<typeof realtyLimitGate>[1],
): void {
  const gate = realtyLimitGate(action, input);
  if (gate.allowed) return;
  throw new RealtyGateError("LIMIT_REACHED", gate.message, {
    limitKey: gate.key,
    upgradePlanId: gate.upgradePlan?.id ?? null,
  });
}

/** `{ error, code, upgradePlan }` para el `NextResponse.json` de un 402. */
export function realtyGateErrorBody(err: RealtyGateError): {
  error: string;
  code: RealtyGateCode;
  featureKey: string | null;
  limitKey: RealtyLimitKey | null;
  upgradePlan: RealtyPlanId | null;
} {
  return {
    error: err.message,
    code: err.code,
    featureKey: err.featureKey,
    limitKey: err.limitKey,
    upgradePlan: err.upgradePlanId,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4. GATING POR MODO (AGENCY | AGENT | OWNER) + feature + permiso
// ═══════════════════════════════════════════════════════════════════════

export type RealtyBlockReason = "mode" | "feature" | "permission";

export interface RealtyNavGate {
  allowed: boolean;
  /** null cuando `allowed`. Qué de los tres filtros cerró la puerta. */
  blockedBy: RealtyBlockReason | null;
  /** Solo cuando `blockedBy === "feature"`: el copy con el precio real. */
  feature: RealtyFeatureGate | null;
}

/** Lo mínimo que hace falta para decidir una pantalla. */
export interface RealtyGateView {
  mode: RealtyMode;
  role: RealtyRole;
  permissionsOverride?: string[] | null;
  plan: RealtyResolvedPlan;
}

/**
 * El AND de los TRES filtros del vertical, en un solo lugar:
 *   1. MODO de la cuenta   (`modes`)
 *   2. FEATURE del plan    (`featureKey`)  ← realty_plan_configs
 *   3. PERMISO del rol     (`permission`)
 *
 * El layout del panel hoy repite este AND en línea (Ola 0). Cualquier
 * pantalla nueva debe llamar a esto en vez de escribir su propio `if`.
 */
export function realtyNavGate(
  view: RealtyGateView,
  navKey: string,
  catalog: readonly RealtyResolvedPlan[] = [],
): RealtyNavGate {
  const item = REALTY_NAV_ITEMS.find((i) => i.key === navKey);
  if (!item) return { allowed: false, blockedBy: "mode", feature: null };
  return realtyNavItemGate(view, item, catalog);
}

function realtyNavItemGate(
  view: RealtyGateView,
  item: RealtyNavItemDef,
  catalog: readonly RealtyResolvedPlan[],
): RealtyNavGate {
  if (!navItemAllowsMode(item, view.mode)) {
    return { allowed: false, blockedBy: "mode", feature: null };
  }
  if (item.featureKey) {
    const gate = realtyFeatureGate(view.plan, item.featureKey, catalog);
    if (!gate.allowed) return { allowed: false, blockedBy: "feature", feature: gate };
  }
  if (
    item.permission &&
    !hasRealtyPermission(
      { role: view.role, permissionsOverride: view.permissionsOverride ?? null },
      item.permission as RealtyPermissionKey,
    )
  ) {
    return { allowed: false, blockedBy: "permission", feature: null };
  }
  return { allowed: true, blockedBy: null, feature: null };
}

/** Items del menú visibles para esta vista (mismo AND que `realtyNavGate`). */
export function realtyVisibleNavItems(
  view: RealtyGateView,
  catalog: readonly RealtyResolvedPlan[] = [],
): RealtyNavItemDef[] {
  return REALTY_NAV_ITEMS.filter((item) => realtyNavItemGate(view, item, catalog).allowed);
}
