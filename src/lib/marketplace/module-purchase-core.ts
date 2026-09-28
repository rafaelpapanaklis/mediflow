/**
 * Núcleo puro de la compra de un módulo del marketplace (ws1-t2, Ortodoncia
 * es el primer módulo que lo usa) — sin Prisma, sin Stripe, sin Next: todo
 * por argumentos simples, para que los tests no necesiten mocks.
 *
 * El carrito multi-módulo de `pricing.ts` (Sprint 2, "2 meses gratis" +
 * descuento por volumen) sigue sin conectar a ningún checkout real — esto
 * es la compra DIRECTA de UN módulo, que es lo que hace falta para que una
 * clínica pueda comprar Ortodoncia sola.
 *
 * El I/O real vive en:
 *   - src/app/api/marketplace/module-checkout/route.ts (crea la sesión de Stripe)
 *   - src/app/api/webhooks/stripe/route.ts (activa/renueva/cancela desde Stripe)
 *   - src/app/api/marketplace/module-cancel/route.ts (pide la cancelación)
 */

export type ModuleBillingCycle = "monthly" | "annual";
export type ModulePaymentMethod = "card" | "spei" | "oxxo";
export type ClinicModuleStatus = "active" | "paused" | "cancelled";

/**
 * `metadata.kind` que distingue una compra de MÓDULO de todos los demás
 * `kind` que ya vive en el mismo webhook de Stripe (platform-subscription,
 * plan-upgrade-diff, ai-topup, cfdi-overage, patient-invoice…).
 */
export const MODULE_SUBSCRIPTION_KIND = "module-subscription" as const;

/* ── 1. Cuánto se cobra ──────────────────────────────────────────────── */

export interface ModulePriceRow {
  priceMxnMonthly: number;
  /** null = este módulo todavía no tiene precio anual propio configurado. */
  priceMxnAnnual: number | null;
}

export type ResolvedModulePrice =
  | { ok: true; amountMxn: number; billing: ModuleBillingCycle }
  | { ok: false; error: string };

/**
 * Precio a cobrar por un módulo según el ciclo elegido.
 *
 * El anual NUNCA se deriva del mensual con una fórmula genérica: el
 * carrito multi-módulo (`pricing.ts`) usa "2 meses gratis" para TODO el
 * carrito junto, pero cada módulo puede tener su propio descuento anual
 * (Ortodoncia: 15%, decisión de Rafael 28-sep-2026 — ver
 * `computeAnnualPriceMxn`). Si el módulo no trae `priceMxnAnnual`, el
 * ciclo anual simplemente no está disponible todavía para ESE módulo — no
 * se le inventa un precio a nadie.
 */
export function resolveModulePriceMxn(
  mod: ModulePriceRow,
  billing: ModuleBillingCycle,
): ResolvedModulePrice {
  if (billing === "monthly") {
    if (!(mod.priceMxnMonthly > 0)) {
      return { ok: false, error: "Este módulo no tiene precio mensual configurado." };
    }
    return { ok: true, amountMxn: mod.priceMxnMonthly, billing };
  }
  if (mod.priceMxnAnnual == null || !(mod.priceMxnAnnual > 0)) {
    return { ok: false, error: "Este módulo todavía no tiene precio anual configurado." };
  }
  return { ok: true, amountMxn: mod.priceMxnAnnual, billing };
}

/**
 * Precio anual con X% de descuento sobre 12 meses, redondeado a pesos
 * enteros (el marketplace factura en enteros — ver
 * sql/marketplace-modulo-ortodoncia-precio.sql). Para Ortodoncia:
 * `computeAnnualPriceMxn(129, 15)` = 1316 (129×12×0.85 = 1315.80 → 1316).
 * Es una utilidad para calcular el número UNA vez al fijar el precio, no
 * una fórmula que el checkout aplique en caliente — el precio real que se
 * cobra siempre sale de `priceMxnAnnual` ya guardado en `modules`.
 */
export function computeAnnualPriceMxn(monthlyMxn: number, discountPct: number): number {
  return Math.round(monthlyMxn * 12 * (1 - discountPct / 100));
}

/* ── 2. ¿Ya tiene acceso? (bloquea la compra, admin o pagado) ─────────── */

export interface ExistingClinicModuleAccess {
  status: string;
  currentPeriodEnd: Date;
}

/** Igual criterio que `hasActiveOrthodonticsModule`: activo Y vigente. */
export function hasActiveAccess(cm: ExistingClinicModuleAccess | null, now: Date): boolean {
  if (!cm) return false;
  return cm.status === "active" && cm.currentPeriodEnd.getTime() > now.getTime();
}

/* ── 3. Activación desde el webhook (idempotente) ─────────────────────── */

export interface ActivateModulePurchaseInput {
  billing: ModuleBillingCycle;
  amountMxn: number;
  paymentMethod: ModulePaymentMethod;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date;
  now: Date;
}

/** Lo que hay que escribir en `clinic_modules` — el wrapper hace el upsert real. */
export interface ClinicModuleWrite {
  status: "active";
  billingCycle: ModuleBillingCycle;
  activatedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt: null;
  stripeSubscriptionId: string | null;
  paymentMethod: ModulePaymentMethod;
  pricePaidMxn: number;
}

/**
 * Qué escribir al activar (alta nueva O renovación/reactivación — un
 * upsert por `[clinicId, moduleId]` cubre los tres casos con la MISMA
 * escritura). Idempotente: reenviar el mismo evento de Stripe produce
 * exactamente la misma fila, sin duplicar ni acumular nada.
 */
export function buildActivateModuleWrite(input: ActivateModulePurchaseInput): ClinicModuleWrite {
  return {
    status: "active",
    billingCycle: input.billing,
    activatedAt: input.now,
    currentPeriodStart: input.now,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelledAt: null,
    stripeSubscriptionId: input.stripeSubscriptionId,
    paymentMethod: input.paymentMethod,
    pricePaidMxn: input.amountMxn,
  };
}

/* ── 4. Sincronizar desde customer.subscription.updated (renovación) ──── */

const GRANTING_STATUSES = new Set(["active", "trialing"]);
const PAST_DUE_STATUSES = new Set(["past_due", "unpaid"]);

export interface ModuleSubscriptionSyncInput {
  /** null = esta suscripción de Stripe no corresponde a ningún ClinicModule que conozcamos. */
  clinicModuleExists: boolean;
  /** `sub.status` de Stripe. */
  subscriptionStatus: string;
  /** `subscriptionPeriodEndSeconds(sub)` ya convertido a Date, o null si Stripe no lo reportó. */
  periodEndFromStripe: Date | null;
}

export type ModuleSyncAction =
  | { type: "update"; status: ClinicModuleStatus; currentPeriodEnd: Date | null }
  | { type: "noop"; reason: string };

/**
 * Qué hacer con un ClinicModule cuando llega `customer.subscription.created`
 * o `.updated`. Mismo criterio que `PERIOD_GRANTING_STATUSES` de
 * `lib/billing/proration.ts` (active/trialing = periodo con derecho a
 * acceso), para que el mismo evento de Stripe se lea igual en la
 * plataforma y en un módulo.
 */
export function resolveModuleSubscriptionSync(input: ModuleSubscriptionSyncInput): ModuleSyncAction {
  if (!input.clinicModuleExists) return { type: "noop", reason: "sin_clinic_module_para_esta_suscripcion" };
  if (GRANTING_STATUSES.has(input.subscriptionStatus)) {
    return { type: "update", status: "active", currentPeriodEnd: input.periodEndFromStripe };
  }
  if (PAST_DUE_STATUSES.has(input.subscriptionStatus)) {
    // Pago fallido, Stripe reintentando: pausa el acceso, NO cancela — si el
    // reintento cobra, el próximo evento vuelve a poner "active".
    return { type: "update", status: "paused", currentPeriodEnd: null };
  }
  // canceled/incomplete_expired/etc.: la baja real la maneja
  // customer.subscription.deleted (abajo), no este evento.
  return { type: "noop", reason: `estado_${input.subscriptionStatus}_sin_accion_aqui` };
}

/* ── 5. Cancelación ────────────────────────────────────────────────────── */

export interface CancellableClinicModule {
  paymentMethod: string;
  stripeSubscriptionId: string | null;
  status: string;
}

export type CancelRequestResult =
  | { ok: true; stripeSubscriptionId: string }
  | { ok: false; error: string };

/**
 * ¿Se puede pedir la cancelación (cancel_at_period_end) de este módulo? La
 * baja real de `clinic_modules` NO pasa aquí: llega después, por
 * `customer.subscription.deleted` cuando Stripe cierra el periodo — hasta
 * entonces el módulo sigue activo y los datos del caso no se tocan.
 */
export function canRequestModuleCancellation(
  cm: CancellableClinicModule | null,
): CancelRequestResult {
  if (!cm) return { ok: false, error: "No tienes este módulo activo." };
  if (cm.paymentMethod === "admin") {
    return { ok: false, error: "Este módulo lo activó soporte; escríbenos si ya no lo necesitas." };
  }
  if (cm.status === "cancelled") return { ok: false, error: "Este módulo ya está cancelado." };
  if (!cm.stripeSubscriptionId) {
    return {
      ok: false,
      error: "Este módulo se pagó con SPEI/OXXO (pago único): no tiene una suscripción que cancelar — simplemente no se renueva.",
    };
  }
  return { ok: true, stripeSubscriptionId: cm.stripeSubscriptionId };
}

/** ¿Un `customer.subscription.deleted` real debe cancelar este ClinicModule? */
export function resolveModuleDeletion(
  cm: CancellableClinicModule | null,
): { type: "cancel" } | { type: "noop"; reason: string } {
  if (!cm) return { type: "noop", reason: "sin_clinic_module_para_esta_suscripcion" };
  if (cm.paymentMethod === "admin") return { type: "noop", reason: "admin_grant_no_lo_cancela_stripe" };
  return { type: "cancel" };
}

/* ── 6. A dónde vuelve la clínica después del checkout ─────────────────── */

/**
 * Desde dónde se pidió la compra. "marketplace" es lo de siempre; "contratar"
 * (ws1-t3, 28-sep-2026) es la página propia del módulo, a la que se llega por
 * el candado del menú. Hace falta porque Marketplace está OCULTO en el menú
 * nuevo: volver ahí después de pagar dejaba a la clínica en una pantalla que
 * no sabe cómo encontró.
 */
export type ModuleCheckoutOrigin = "marketplace" | "contratar";

/** Módulos con página propia de contratar. Los demás vuelven a Marketplace. */
const RUTA_CONTRATAR: Readonly<Record<string, string>> = {
  // La misma que RUTA_CONTRATAR_ORTODONCIA (src/lib/orthodontics/contratar.ts);
  // un test comprueba que no se separen.
  orthodontics: "/dashboard/contratar/ortodoncia",
};

export interface ModuleCheckoutReturnUrls {
  successUrl: string;
  cancelUrl: string;
}

/**
 * URLs de vuelta del checkout. Con origen "marketplace" (o un módulo sin
 * página de contratar) devuelve EXACTAMENTE las de siempre, letra por letra.
 * `{CHECKOUT_SESSION_ID}` lo rellena Stripe; aquí va tal cual.
 */
export function resolveModuleCheckoutReturnUrls(input: {
  baseUrl: string;
  moduleKey: string;
  method: ModulePaymentMethod;
  origin: ModuleCheckoutOrigin;
}): ModuleCheckoutReturnUrls {
  const { baseUrl, moduleKey, method, origin } = input;
  const contratar = origin === "contratar" ? RUTA_CONTRATAR[moduleKey] : undefined;
  if (contratar) {
    return {
      successUrl:
        method === "card"
          ? `${baseUrl}${contratar}?compra=ok&session_id={CHECKOUT_SESSION_ID}`
          : `${baseUrl}${contratar}?compra=pendiente&metodo=${method}`,
      cancelUrl: `${baseUrl}${contratar}?compra=cancelada`,
    };
  }
  return {
    successUrl:
      method === "card"
        ? `${baseUrl}/dashboard/marketplace?compra=${moduleKey}&session_id={CHECKOUT_SESSION_ID}`
        : `${baseUrl}/dashboard/marketplace?compra=${moduleKey}&pendiente=${method}`,
    cancelUrl: `${baseUrl}/dashboard/marketplace`,
  };
}

/* ── 6b. Doble pago (ws1-t2, 28-sep-2026) ─────────────────────────────── */

/**
 * `hasActiveAccess` (arriba) solo bloquea la compra si el módulo YA quedó
 * activo — con dos pestañas (o llamando al endpoint dos veces seguidas) se
 * podían abrir dos sesiones de Stripe ANTES de que la primera se pagara y
 * el webhook alcanzara a activar nada. Esto añade la segunda mitad: si ya
 * hay una sesión de checkout ABIERTA o una suscripción de ESTE módulo EN
 * CURSO para esta clínica, tampoco se crea una sesión nueva.
 */

/** Una Checkout Session de Stripe, ya filtrada a las de este módulo+clínica. */
export interface OpenModuleCheckoutSession {
  /** `session.status` de Stripe: "open" | "complete" | "expired". */
  status: string | null;
}

/** Una Subscription de Stripe, ya filtrada a las de este módulo+clínica. */
export interface OpenModuleSubscription {
  /** `subscription.status` de Stripe. */
  status: string;
}

/** Solo una sesión "open" bloquea — "complete" ya la procesó (o está por
 * procesar) el webhook, y "expired" ya no puede pagarse. */
const BLOCKING_SESSION_STATUSES = new Set(["open"]);

/** Cualquier suscripción que no esté YA cerrada bloquea otra compra nueva:
 * "incomplete" (esperando el primer cobro), "trialing"/"active" (viva),
 * "past_due"/"unpaid" (reintentando, sigue viva). Solo "canceled" e
 * "incomplete_expired" dejan comprar de nuevo. */
const BLOCKING_SUBSCRIPTION_STATUSES = new Set([
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
]);

/**
 * ¿Hay una compra de este módulo YA en curso para esta clínica? Si es así,
 * el checkout debe rechazar con 409 ANTES de crear una sesión nueva de
 * Stripe — nunca después.
 */
export function hasDuplicatePurchaseInFlight(args: {
  sessions: OpenModuleCheckoutSession[];
  subscriptions: OpenModuleSubscription[];
}): boolean {
  return (
    args.sessions.some((s) => s.status !== null && BLOCKING_SESSION_STATUSES.has(s.status)) ||
    args.subscriptions.some((s) => BLOCKING_SUBSCRIPTION_STATUSES.has(s.status))
  );
}

/* ── 6c. Red de seguridad en el webhook: si igual se coló una segunda ──── */

export interface ActiveModuleSubscriptionState {
  status: string;
  stripeSubscriptionId: string | null;
}

export type ActivationConflictResolution =
  | { type: "activate" }
  | { type: "cancel_incoming"; reason: string };

/**
 * Última red de seguridad, por si el checkout de arriba no alcanzó a
 * atajarlo (dos pagos que se completan casi al mismo tiempo, uno en cada
 * pestaña): si YA hay una suscripción de tarjeta activa de este módulo con
 * OTRO `stripeSubscriptionId`, la que llega ahora se cancela en vez de
 * pisar a la primera — así nunca quedan dos suscripciones cobrando el
 * mismo módulo en paralelo. Gana la primera que activó el webhook, sea
 * cual sea el orden en que Stripe mande los eventos.
 *
 * Solo compara SUSCRIPCIONES DE TARJETA (las que sí se cobran solas para
 * siempre si nadie las cancela): un pago único de SPEI/OXXO no tiene
 * `stripeSubscriptionId` y no puede "seguir cobrando" — para ese caso, la
 * defensa de verdad es el checkout de arriba, no esta función.
 */
export function resolveActivationConflict(
  existing: ActiveModuleSubscriptionState | null,
  incomingSubscriptionId: string | null,
): ActivationConflictResolution {
  if (!existing) return { type: "activate" };
  if (existing.status !== "active") return { type: "activate" };
  if (!existing.stripeSubscriptionId) return { type: "activate" };
  if (!incomingSubscriptionId) return { type: "activate" };
  if (existing.stripeSubscriptionId === incomingSubscriptionId) return { type: "activate" };
  return {
    type: "cancel_incoming",
    reason: "La clínica ya tenía una suscripción de tarjeta activa de este módulo; se cancela la nueva para no cobrar dos veces.",
  };
}

/* ── 7. Quién puede comprar ────────────────────────────────────────────── */

/**
 * Comprar un módulo compromete un cobro recurrente a la clínica: solo su
 * dueño o un administrador, la misma regla que la pestaña «Suscripción» de
 * Configuración. Antes el endpoint no lo comprobaba y cualquier usuario de la
 * clínica podía abrir un checkout.
 */
export function canPurchaseModules(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/* ── 8. ¿Esta factura de Stripe es de un módulo? (ws1-t5, 28-sep-2026) ──── */

/**
 * La suscripción de un módulo comparte el `customer` de Stripe con la del
 * plan, así que sus facturas llegan al mismo `invoice.paid` /
 * `invoice.payment_failed`. Sin distinguirlas, una mensualidad de módulo
 * rechazada dejaba a la CLÍNICA ENTERA en `past_due` (sin panel, con el plan
 * al corriente) y una pagada mandaba el correo «Tu plan está activo».
 *
 * La factura no trae `metadata.kind` propio: lo hereda de la suscripción, y
 * según la versión de la API de Stripe viene en un sitio o en otro. Se miran
 * los tres.
 */
export interface FacturaStripeParaModulo {
  parent?: { subscription_details?: { subscription?: unknown; metadata?: Record<string, string> | null } | null } | null;
  /** Forma anterior a la API 2025: los detalles colgaban de la factura. */
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  subscription?: unknown;
  lines?: { data?: Array<{ metadata?: Record<string, string> | null } | null> | null } | null;
}

export interface ReferenciaDeFactura {
  /** `true` si la metadata dice que es de un módulo. */
  esDeModulo: boolean;
  moduleKey: string | null;
  /**
   * La suscripción que generó la factura, si se pudo leer. Con ella el webhook
   * puede comprobar contra `clinic_modules` cuando la metadata no llegó.
   */
  stripeSubscriptionId: string | null;
}

function idDe(valor: unknown): string | null {
  if (typeof valor === "string" && valor) return valor;
  if (valor && typeof valor === "object") {
    const id = (valor as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

export function referenciaDeFactura(invoice: FacturaStripeParaModulo | null | undefined): ReferenciaDeFactura {
  if (!invoice) return { esDeModulo: false, moduleKey: null, stripeSubscriptionId: null };
  const candidatas: Array<Record<string, string> | null | undefined> = [
    invoice.parent?.subscription_details?.metadata,
    invoice.subscription_details?.metadata,
    ...(invoice.lines?.data ?? []).map((l) => l?.metadata),
  ];
  const meta = candidatas.find((m) => m?.kind === MODULE_SUBSCRIPTION_KIND) ?? null;
  return {
    esDeModulo: meta !== null,
    moduleKey: meta?.moduleKey ?? null,
    stripeSubscriptionId:
      idDe(invoice.parent?.subscription_details?.subscription) ?? idDe(invoice.subscription),
  };
}
