/**
 * DaleControl INMUEBLES — pruebas OFFLINE del gate por plan y del cobro.
 *
 * Run (sin BD, sin Stripe, sin red):
 *   node --import tsx --import ./src/lib/realty/__tests__/offline.mjs \
 *        --test src/lib/realty/__tests__/suscripcion.test.ts
 *
 * El hook resuelve `server-only`, que NO es un paquete instalado sino un
 * alias interno de Next: sin él, importar billing.ts revienta con
 * MODULE_NOT_FOUND antes de la primera aserción. (La prueba equivalente de
 * barber referencia un `scripts/barber-test-hook.mjs` que nunca se subió al
 * repo, así que está escrita pero no se puede correr; aquí el hook vive
 * dentro del propio __tests__ para que no se pierda.)
 *
 * QUÉ PROTEGE (los tres modos de falla que ya costaron caro en otros
 * verticales):
 *  1. PRECIOS ESCRITOS EN LA UI. Hay un barrido estático que falla si el
 *     precio del seed aparece en cualquier archivo de esta ola. Un `$199`
 *     en un componente miente el día que se edita la fila.
 *  2. GATEAR POR EL ID DEL PLAN en vez de por la FEATURE. Todas las pruebas
 *     usan un catálogo SINTÉTICO con números y repartos distintos del seed:
 *     si algo estuviera escrito en código, fallarían.
 *  3. EL WEBHOOK NO IDEMPOTENTE. Se aplica el mismo evento dos veces y se
 *     comprueba que escribe exactamente lo mismo, sin insertar nada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  REALTY_UNLIMITED,
  FALLBACK_REALTY_PLAN_CONFIG,
  realtyNavItemsWhileUnpaid,
  type RealtyResolvedPlan,
} from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS } from "@/lib/realty/types";
import {
  RealtyGateError,
  assertRealtyFeature,
  assertRealtyLimit,
  assertRealtySubscription,
  realtyFeatureGate,
  realtyFeatureUpgradePlan,
  realtyLimitGate,
  realtyLimitState,
  realtyNavGate,
  realtyUploadGate,
  realtyUsageStates,
  resolveRealtyMessageQuota,
  type RealtyUsageCounts,
} from "@/lib/realty/gating";
import {
  applyRealtySubscription,
  buildRealtySubscriptionUpdateParams,
  handleRealtyStripeEvent,
  isRealtyPriceUsable,
  isRealtySubscription,
  isRealtyWebhookEventType,
  realtyPlanAmountCents,
  realtyPreviewAmountDueCents,
  realtyPriceLookupKey,
  realtySubscriptionPatch,
  realtySubscriptionPeriodEndSeconds,
  resolveRealtyChangeDirection,
  toRealtyCents,
  type RealtyAccountRef,
  type RealtyBillingDb,
  type SubscriptionLike,
} from "@/lib/realty/billing";
import { limitsOverTargetPlan } from "@/components/realty/billing/shared";

const RAIZ = join(__dirname, "..", "..", "..", ".."); // → raíz del repo

// ── Catálogo SINTÉTICO: números y reparto distintos del seed a propósito ──
// Si alguna decisión estuviera escrita en código en vez de leerse de la
// tabla, estas pruebas fallarían.
function plan(
  over: Partial<RealtyResolvedPlan> & Pick<RealtyResolvedPlan, "id" | "name">,
): RealtyResolvedPlan {
  return {
    priceMonthly: 100,
    priceYearly: null,
    maxUsers: 1,
    maxOffices: 1,
    maxProperties: REALTY_UNLIMITED,
    storageQuotaMb: 1024,
    messageQuota: 0,
    features: {},
    stripeLookupKey: null,
    sortOrder: 0,
    isActive: true,
    ...over,
  };
}

const BASE = plan({
  id: "PROPIETARIO",
  name: "Base",
  priceMonthly: 111,
  maxUsers: 2,
  maxOffices: 1,
  storageQuotaMb: 100,
  messageQuota: 0,
  features: { properties: true, rentals: true },
});

const MEDIO = plan({
  id: "ASESOR",
  name: "Medio",
  priceMonthly: 222,
  maxUsers: 5,
  maxOffices: 2,
  storageQuotaMb: 500,
  messageQuota: 10,
  sortOrder: 1,
  features: { properties: true, rentals: true, whatsapp: true, commissions: true },
});

const ALTO = plan({
  id: "INMOBILIARIA",
  name: "Alto",
  priceMonthly: 333,
  maxUsers: REALTY_UNLIMITED,
  maxOffices: REALTY_UNLIMITED,
  storageQuotaMb: 1000,
  messageQuota: 50,
  sortOrder: 2,
  features: {
    properties: true,
    rentals: true,
    whatsapp: true,
    commissions: true,
    mls: true,
    multiOffice: true,
  },
});

const CATALOGO = [BASE, MEDIO, ALTO];

const usage = (over: Partial<RealtyUsageCounts> = {}): RealtyUsageCounts => ({
  users: 0,
  offices: 0,
  properties: 0,
  storageBytes: 0,
  messages: 0,
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════
// 1. CERO PRECIOS ESCRITOS
// ═══════════════════════════════════════════════════════════════════════

function recorrer(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p, out);
    // También .css y .json: el precio se puede colar en una leyenda o en el
    // diccionario, no solo en el TSX.
    else if (/[.](tsx?|css|json)$/.test(entrada)) out.push(p);
  }
  return out;
}

const CARPETAS_DE_LA_OLA = [
  join(RAIZ, "src", "app", "inmobiliaria", "(panel)", "suscripcion"),
  join(RAIZ, "src", "app", "api", "realty", "billing"),
  join(RAIZ, "src", "app", "api", "realty", "stripe"),
  join(RAIZ, "src", "app", "admin", "inmobiliarias"),
  join(RAIZ, "src", "app", "api", "admin", "inmobiliarias"),
  join(RAIZ, "src", "components", "realty", "billing"),
  join(RAIZ, "src", "components", "admin", "inmobiliarias"),
];

const ARCHIVOS_SUELTOS = [
  join(RAIZ, "src", "lib", "realty", "billing.ts"),
  join(RAIZ, "src", "lib", "realty", "gating.ts"),
  join(RAIZ, "src", "lib", "realty", "admin.ts"),
  join(RAIZ, "src", "lib", "realty", "plans.ts"),
];

test("ningún archivo de esta ola trae escrito un precio o un cupo del catálogo", () => {
  const catalogo = Object.values(FALLBACK_REALTY_PLAN_CONFIG);
  const prohibidos = [
    // Precios en pesos, y también en CENTAVOS: la lookup key los lleva dentro
    // y ya se coló uno en una nota de la pantalla del admin.
    ...catalogo.map((p) => String(p.priceMonthly)),
    ...catalogo.map((p) => String(Math.round(p.priceMonthly * 100))),
    // Cupos de archivos. No se incluyen messageQuota (500 / 2000) ni los
    // límites de 1 / 6 porque chocan con usos legítimos: HTTP 500, el tope de
    // 500 filas del listado, `limit: 12`, índices y porcentajes.
    ...catalogo.map((p) => String(p.storageQuotaMb)),
  ];

  const precios = Array.from(new Set(prohibidos));
  const archivos = [
    ...CARPETAS_DE_LA_OLA.flatMap((d) => recorrer(d)),
    ...ARCHIVOS_SUELTOS.filter((f) => existsSync(f)),
  ];
  assert.ok(archivos.length > 0, "el barrido no encontró archivos: revisa las rutas");

  const culpables: string[] = [];
  for (const archivo of archivos) {
    const fuente = readFileSync(archivo, "utf8");
    for (const precio of precios) {
      // \b para no cazar 1199 ni 34900: solo el número suelto.
      if (new RegExp(`\\b${precio}\\b`).test(fuente)) {
        culpables.push(
          `${archivo.slice(RAIZ.length + 1).replace(/\\/g, "/")} contiene "${precio}"`,
        );
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `precios escritos a mano (deben salir de realty_plan_configs): ${culpables.join("; ")}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2. GATE POR FEATURE (nunca por el id del plan)
// ═══════════════════════════════════════════════════════════════════════

test("una feature apagada dice EN QUÉ PLAN viene y con el precio de la tabla", () => {
  const gate = realtyFeatureGate(BASE, "whatsapp", CATALOGO);
  assert.equal(gate.allowed, false);
  assert.ok(gate.upgradePlan, "debe proponer el plan más barato que sí la trae");
  assert.equal(gate.upgradePlan?.id, "ASESOR");
  assert.ok(
    gate.message.includes("Medio"),
    "el mensaje debe nombrar el plan de la tabla, no uno escrito en código",
  );
  assert.ok(
    gate.message.includes("222"),
    "el precio del mensaje sale de la tabla: " + gate.message,
  );
});

test("mover una feature de plan es EDITAR UNA FILA, no tocar código", () => {
  // Mismo id de plan, otro reparto de features: el gate cambia solo.
  const baseConMls = plan({ ...BASE, features: { ...BASE.features, mls: true } });
  assert.equal(realtyFeatureGate(BASE, "mls", CATALOGO).allowed, false);
  assert.equal(realtyFeatureGate(baseConMls, "mls", CATALOGO).allowed, true);
});

test("si ningún plan trae la feature, el mensaje NO se inventa un precio", () => {
  const gate = realtyFeatureGate(BASE, "aiStudio", CATALOGO);
  assert.equal(gate.allowed, false);
  assert.equal(gate.upgradePlan, null);
  assert.ok(!/\d/.test(gate.message), "no debe haber números: " + gate.message);
});

test("el plan propuesto es el MÁS BARATO por encima del actual", () => {
  assert.equal(realtyFeatureUpgradePlan("whatsapp", CATALOGO, "PROPIETARIO")?.id, "ASESOR");
  // Desde ASESOR ya la tiene, pero si se pide por encima, sube al siguiente.
  assert.equal(realtyFeatureUpgradePlan("mls", CATALOGO, "ASESOR")?.id, "INMOBILIARIA");
});

test("assertRealtyFeature lanza un error tipado con el plan destino", () => {
  assert.throws(
    () => assertRealtyFeature(BASE, "commissions", CATALOGO),
    (err: unknown) => {
      assert.ok(err instanceof RealtyGateError);
      assert.equal(err.code, "FEATURE_LOCKED");
      assert.equal(err.upgradePlanId, "ASESOR");
      return true;
    },
  );
  assert.doesNotThrow(() => assertRealtyFeature(MEDIO, "commissions", CATALOGO));
});

// ═══════════════════════════════════════════════════════════════════════
// 3. LÍMITES DUROS: avisa al 90 %, bloquea al 100 %
// ═══════════════════════════════════════════════════════════════════════

test("al 90 % del cupo se AVISA pero todavía se deja", () => {
  const state = realtyLimitState("storage", 90, 100);
  assert.equal(state.percent, 90);
  assert.equal(state.nearLimit, true);
  assert.equal(state.atLimit, false);
});

test("al 100 % se BLOQUEA y el mensaje dice cuál plan alcanza", () => {
  const gate = realtyLimitGate("addUser", {
    plan: BASE,
    usage: usage({ users: 2 }),
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.upgradePlan?.id, "ASESOR");
  assert.ok(gate.message.includes("Medio"), gate.message);
});

test("un cupo ilimitado (-1) nunca bloquea", () => {
  const gate = realtyLimitGate("addUser", {
    plan: ALTO,
    usage: usage({ users: 9999 }),
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.state.unlimited, true);
  assert.equal(gate.state.percent, 0);
});

test("cupo 0 = el plan no lo incluye, y se dice así (no '0 de 0')", () => {
  const gate = realtyLimitGate("sendMessage", {
    plan: BASE,
    usage: usage(),
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, false);
  assert.ok(gate.message.startsWith("Tu plan no incluye"), gate.message);
});

test("el cupo de mensajes de la CUENTA pisa el del plan", () => {
  assert.equal(resolveRealtyMessageQuota(null, MEDIO), 10);
  assert.equal(resolveRealtyMessageQuota({ messageQuota: null }, MEDIO), 10);
  assert.equal(resolveRealtyMessageQuota({ messageQuota: 999 }, MEDIO), 999);
  // 0 explícito en la cuenta también manda (apagarle WhatsApp a una cuenta).
  assert.equal(resolveRealtyMessageQuota({ messageQuota: 0 }, MEDIO), 0);
});

test("la subida que no cabe se bloquea diciendo cuánto queda", () => {
  const MB = 1024 * 1024;
  const gate = realtyUploadGate({
    plan: BASE, // 100 MB
    storageUsedBytes: 95 * MB,
    incomingBytes: 20 * MB,
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, false);
  assert.ok(gate.message.includes("MB"), gate.message);
  assert.equal(gate.upgradePlan?.id, "ASESOR");
});

test("la subida que sí cabe pasa, pero con aviso si ya va en el 95 %", () => {
  const MB = 1024 * 1024;
  const gate = realtyUploadGate({
    plan: BASE,
    storageUsedBytes: 95 * MB,
    incomingBytes: 1 * MB,
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, true);
  assert.ok(gate.warning, "al 95 % hay que avisar aunque se deje");
});

test("storageUsedBytes puede llegar como BigInt (la columna lo es)", () => {
  const gate = realtyUploadGate({
    plan: BASE,
    storageUsedBytes: BigInt(50 * 1024 * 1024),
    incomingBytes: 1024,
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.state.used, 50 * 1024 * 1024);
});

test("assertRealtyLimit lanza LIMIT_REACHED con la llave del cupo", () => {
  assert.throws(
    () =>
      assertRealtyLimit("addOffice", {
        plan: BASE,
        usage: usage({ offices: 1 }),
        catalog: CATALOGO,
      }),
    (err: unknown) => {
      assert.ok(err instanceof RealtyGateError);
      assert.equal(err.code, "LIMIT_REACHED");
      assert.equal(err.limitKey, "offices");
      return true;
    },
  );
});

test("los cinco medidores salen del plan y del consumo, sin números propios", () => {
  const states = realtyUsageStates(MEDIO, usage({ users: 5, messages: 9 }), null);
  assert.equal(states.users.atLimit, true);
  assert.equal(states.messages.percent, 90);
  assert.equal(states.messages.nearLimit, true);
  assert.equal(states.properties.unlimited, true);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. GATE POR MODO (el eje propio del vertical)
// ═══════════════════════════════════════════════════════════════════════

test("un rentista (OWNER) no ve Prospectos: lo corta el MODO, no el plan", () => {
  const gate = realtyNavGate(
    { mode: "OWNER", role: "OWNER", plan: ALTO },
    "prospectos",
    CATALOGO,
  );
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedBy, "mode");
});

test("WhatsApp lo corta la FEATURE del plan, no el modo", () => {
  const gate = realtyNavGate(
    { mode: "AGENCY", role: "OWNER", plan: BASE },
    "whatsapp",
    CATALOGO,
  );
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedBy, "feature");
  assert.equal(gate.feature?.upgradePlan?.id, "ASESOR");
});

test("la suscripción la corta el PERMISO: MANAGER no toca el dinero", () => {
  const owner = realtyNavGate(
    { mode: "AGENCY", role: "OWNER", plan: ALTO },
    "suscripcion",
    CATALOGO,
  );
  const manager = realtyNavGate(
    { mode: "AGENCY", role: "MANAGER", plan: ALTO },
    "suscripcion",
    CATALOGO,
  );
  assert.equal(owner.allowed, true);
  assert.equal(manager.allowed, false);
  assert.equal(manager.blockedBy, "permission");
});

test("impaga = sin acceso; past_due tampoco entra aunque Stripe la vea viva", () => {
  assert.doesNotThrow(() => assertRealtySubscription({ subscriptionStatus: "active" }));
  assert.doesNotThrow(() => assertRealtySubscription({ subscriptionStatus: "trialing" }));
  for (const status of ["pending_payment", "past_due", "unpaid", "canceled", "suspended"]) {
    assert.throws(
      () => assertRealtySubscription({ subscriptionStatus: status }),
      (err: unknown) => {
        assert.ok(err instanceof RealtyGateError);
        assert.equal(err.code, "SUBSCRIPTION_INACTIVE");
        return true;
      },
      `"${status}" NO debe dar acceso`,
    );
  }
  // isActive=false gana sobre cualquier estado de pago.
  assert.throws(
    () => assertRealtySubscription({ subscriptionStatus: "active", isActive: false }),
    RealtyGateError,
  );
});

test("bajar de plan avisa qué cupos quedan rebasados", () => {
  const MB = 1024 * 1024;
  const destino = {
    id: BASE.id,
    name: BASE.name,
    priceMonthlyCents: 0,
    priceYearlyCents: null,
    maxUsers: BASE.maxUsers, // 2
    maxOffices: BASE.maxOffices, // 1
    maxProperties: BASE.maxProperties, // ilimitado
    storageQuotaMb: BASE.storageQuotaMb, // 100 MB
    messageQuota: BASE.messageQuota, // 0
    features: [],
    isActive: true,
  };
  const estados = realtyUsageStates(
    ALTO,
    usage({ users: 14, offices: 3, properties: 900, storageBytes: 700 * MB, messages: 4 }),
    null,
  );
  const limites = Object.values(estados).map(({ remaining, ...rest }) => rest);

  const sobra = limitsOverTargetPlan(limites, destino);
  assert.deepEqual(
    sobra.sort(),
    ["messages", "offices", "storage", "users"],
    "inmuebles NO sobra: es ilimitado en el destino",
  );

  // Subir de plan nunca deja nada rebasado.
  const arriba = { ...destino, maxUsers: -1, maxOffices: -1, storageQuotaMb: -1, messageQuota: 999 };
  assert.deepEqual(limitsOverTargetPlan(limites, arriba), []);
});

test("menú con la suscripción impaga: solo el camino a pagar", () => {
  const nav = realtyNavItemsWhileUnpaid(REALTY_NAV_ITEMS);
  assert.deepEqual(
    nav.map((i) => i.key),
    ["suscripcion", "soporte"],
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 5. DINERO Y LOOKUP KEY
// ═══════════════════════════════════════════════════════════════════════

test("los pesos se vuelven centavos sin error de float", () => {
  assert.equal(toRealtyCents(0.1 + 0.2), 30);
  assert.equal(toRealtyCents(349), 34900);
  assert.equal(toRealtyCents("199.99"), 19999);
  assert.equal(toRealtyCents(null), 0);
});

test("la lookup key lleva el importe dentro (por eso se auto-cura)", () => {
  assert.equal(realtyPriceLookupKey("ASESOR", "month", 34900), "dcrealty_ASESOR_month_34900");
  // Cambiar el precio cambia la clave → nace un precio nuevo, no se muta el viejo.
  assert.notEqual(
    realtyPriceLookupKey("ASESOR", "month", 34900),
    realtyPriceLookupKey("ASESOR", "month", 39900),
  );
});

test("un plan sin precio anual no puede cobrarse anual", () => {
  assert.equal(realtyPlanAmountCents(MEDIO, "year"), null);
  assert.equal(realtyPlanAmountCents(MEDIO, "month"), 22200);
});

test("jamás se reutiliza un precio ajeno aunque coincida el importe", () => {
  const ajeno = {
    id: "price_x",
    active: true,
    currency: "mxn",
    unit_amount: 22200,
    recurring: { interval: "month" },
    metadata: { dc_vertical: "barber" },
    product: { metadata: { dc_vertical: "barber" } },
  };
  assert.equal(isRealtyPriceUsable(ajeno, { cents: 22200, interval: "month" }), false);

  const propio = { ...ajeno, metadata: { dc_vertical: "realty" } };
  assert.equal(isRealtyPriceUsable(propio, { cents: 22200, interval: "month" }), true);

  // La marca también vale si está en el PRODUCTO.
  const marcadoEnProducto = {
    ...ajeno,
    metadata: {},
    product: { metadata: { dc_vertical: "realty" } },
  };
  assert.equal(
    isRealtyPriceUsable(marcadoEnProducto, { cents: 22200, interval: "month" }),
    true,
  );

  // Importe que ya no coincide con la tabla → se descarta.
  assert.equal(isRealtyPriceUsable(propio, { cents: 19900, interval: "month" }), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 6. CAMBIO DE PLAN Y PRORRATEO
// ═══════════════════════════════════════════════════════════════════════

test("bajar de tier NUNCA se cobra hoy, aunque el importe suba", () => {
  // Precio congelado bajo (promoción vieja) + destino más caro pero de tier
  // inferior: manda el tier.
  const dir = resolveRealtyChangeDirection({
    currentCents: 10000,
    targetCents: 22200,
    currentPlanId: "INMOBILIARIA",
    targetPlanId: "ASESOR",
  });
  assert.equal(dir, "downgrade");
});

test("subir de plan cobra HOY y no cambia si la tarjeta rechaza", () => {
  const up = buildRealtySubscriptionUpdateParams({
    itemId: "si_1",
    priceId: "price_1",
    direction: "upgrade",
    metadata: {},
  });
  assert.equal(up.proration_behavior, "always_invoice");
  assert.equal(up.payment_behavior, "error_if_incomplete");
  // 🔴 La fecha de renovación NO se mueve: si alguien mete
  // billing_cycle_anchor, el cliente ve un cobro completo antes de tiempo.
  assert.equal("billing_cycle_anchor" in up, false);
});

test("bajar de plan deja crédito, sin cobro inmediato", () => {
  const down = buildRealtySubscriptionUpdateParams({
    itemId: "si_1",
    priceId: "price_1",
    direction: "downgrade",
    metadata: {},
  });
  assert.equal(down.proration_behavior, "create_prorations");
  assert.equal("payment_behavior" in down, false);
});

test("la vista previa devuelve null antes que enseñar un importe inflado", () => {
  const periodEnd = 2_000_000;
  // Sin líneas de prorrateo → no es la factura del cobro de hoy.
  assert.equal(
    realtyPreviewAmountDueCents({ amount_due: 50000, lines: { data: [{ proration: false }] } }, periodEnd),
    null,
  );
  // Con la renovación del siguiente ciclo dentro → tampoco.
  assert.equal(
    realtyPreviewAmountDueCents(
      {
        amount_due: 50000,
        lines: {
          data: [
            { proration: true, amount: 1000 },
            { proration: false, period: { start: periodEnd } },
          ],
        },
      },
      periodEnd,
    ),
    null,
  );
  // Solo prorrateo → el importe es de fiar.
  assert.equal(
    realtyPreviewAmountDueCents(
      { amount_due: 4321, lines: { data: [{ proration: true, amount: 4321 }] } },
      periodEnd,
    ),
    4321,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 7. WEBHOOK: aislamiento e idempotencia
// ═══════════════════════════════════════════════════════════════════════

const REALTY_SUB: SubscriptionLike = {
  id: "sub_realty",
  status: "active",
  customer: "cus_1",
  metadata: { dc_vertical: "realty", dc_kind: "realty-subscription", accountId: "acc_1", dc_plan: "ASESOR" },
  items: {
    data: [
      {
        id: "si_1",
        current_period_end: 1_800_000,
        price: {
          id: "price_1",
          unit_amount: 22200,
          recurring: { interval: "month" },
          metadata: { dc_vertical: "realty", dc_plan: "ASESOR" },
        },
      },
    ],
  },
};

function fakeDb(account: RealtyAccountRef | null) {
  const writes: unknown[] = [];
  const db: RealtyBillingDb = {
    realtyAccount: {
      async findFirst() {
        return account;
      },
      async update(args: unknown) {
        writes.push(args);
        return {};
      },
    },
  };
  return { db, writes };
}

test("el webhook solo mira sus familias de evento", () => {
  assert.equal(isRealtyWebhookEventType("customer.subscription.updated"), true);
  assert.equal(isRealtyWebhookEventType("checkout.session.completed"), true);
  assert.equal(isRealtyWebhookEventType("invoice.payment_failed"), false);
  assert.equal(isRealtyWebhookEventType("account.updated"), false);
});

test("una suscripción del dental o de barber NO es nuestra", () => {
  assert.equal(isRealtySubscription(REALTY_SUB), true);
  assert.equal(
    isRealtySubscription({ id: "sub_b", status: "active", metadata: { dc_vertical: "barber" } }),
    false,
  );
  assert.equal(
    isRealtySubscription({ id: "sub_d", status: "active", metadata: { clinicId: "c1" } }),
    false,
  );
});

test("el parche escribe el estado de Stripe TAL CUAL, y el plan si se sabe", () => {
  const patch = realtySubscriptionPatch(REALTY_SUB);
  assert.deepEqual(patch, {
    subscriptionStatus: "active",
    stripeSubscriptionId: "sub_realty",
    plan: "ASESOR",
  });
  // Sin pistas del plan, NO se toca el plan de la cuenta.
  const sinPlan = realtySubscriptionPatch({
    id: "sub_x",
    status: "past_due",
    metadata: { dc_vertical: "realty" },
    items: { data: [{ id: "si", price: { id: "p" } }] },
  });
  assert.equal("plan" in sinPlan, false);
  assert.equal(sinPlan.subscriptionStatus, "past_due");
});

test("aplicar el MISMO evento dos veces escribe exactamente lo mismo", async () => {
  const account: RealtyAccountRef = {
    id: "acc_1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_realty",
    subscriptionStatus: "active",
  };
  const { db, writes } = fakeDb(account);
  const a = await applyRealtySubscription(db, REALTY_SUB);
  const b = await applyRealtySubscription(db, REALTY_SUB);
  assert.equal(a.applied, true);
  assert.equal(b.applied, true);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
});

test("el eco de una suscripción vieja y MUERTA no pisa a la que hoy paga", async () => {
  const account: RealtyAccountRef = {
    id: "acc_1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_vigente",
    subscriptionStatus: "active",
  };
  const { db, writes } = fakeDb(account);
  const vieja: SubscriptionLike = { ...REALTY_SUB, id: "sub_vieja", status: "canceled" };
  const res = await applyRealtySubscription(db, vieja);
  assert.equal(res.applied, false);
  assert.equal(res.reason, "stale-subscription");
  assert.equal(writes.length, 0);
});

test("una contratación NUEVA tras cancelar sí se adopta", async () => {
  const account: RealtyAccountRef = {
    id: "acc_1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_vieja",
    subscriptionStatus: "canceled",
  };
  const { db, writes } = fakeDb(account);
  const nueva: SubscriptionLike = { ...REALTY_SUB, id: "sub_nueva", status: "active" };
  const res = await applyRealtySubscription(db, nueva);
  assert.equal(res.applied, true);
  assert.equal(writes.length, 1);
});

test("un checkout de OTRO producto se ignora sin tocar la base", async () => {
  const { db, writes } = fakeDb(null);
  const stripe = {
    subscriptions: {
      async retrieve() {
        throw new Error("no debería llamarse");
      },
    },
  };
  const out = await handleRealtyStripeEvent(stripe, db, {
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", metadata: { dc_kind: "barber-subscription" } } },
  });
  assert.equal(out.handled, false);
  assert.equal(out.action, "not-realty");
  assert.equal(writes.length, 0);
});

test("el webhook RELEE la suscripción viva, no se fía del payload", async () => {
  const account: RealtyAccountRef = {
    id: "acc_1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_realty",
    subscriptionStatus: "active",
  };
  const { db, writes } = fakeDb(account);
  let releida = 0;
  const stripe = {
    subscriptions: {
      async retrieve() {
        releida += 1;
        // Estado de HOY, distinto del que traía el evento viejo.
        return { ...REALTY_SUB, status: "past_due" };
      },
    },
  };
  const out = await handleRealtyStripeEvent(stripe, db, {
    id: "evt_2",
    type: "customer.subscription.updated",
    data: { object: { ...REALTY_SUB, status: "active" } },
  });
  assert.equal(releida, 1);
  assert.equal(out.handled, true);
  const write = writes[0] as { data: { subscriptionStatus: string } };
  assert.equal(
    write.data.subscriptionStatus,
    "past_due",
    "debe escribir lo que dice Stripe HOY, no lo que traía el evento",
  );
});

test("una suspensión MANUAL de soporte NO la levanta el webhook", async () => {
  // Escenario real: soporte suspende una cuenta que sigue pagando en Stripe.
  // En la próxima renovación llega un customer.subscription.updated con
  // status "active". Si se escribiera tal cual, la suspensión se levantaría
  // sola y nadie se enteraría.
  const account: RealtyAccountRef = {
    id: "acc_1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_realty",
    subscriptionStatus: "suspended",
  };
  const { db, writes } = fakeDb(account);
  const res = await applyRealtySubscription(db, REALTY_SUB);
  assert.equal(res.applied, true);
  assert.equal(res.reason, "manual-hold");
  const write = writes[0] as { data: Record<string, unknown> };
  assert.equal(
    "subscriptionStatus" in write.data,
    false,
    "el estado suspendido lo escribió un humano: Stripe no lo pisa",
  );
  // Pero los ids y el plan SÍ se siguen sincronizando, para que al reactivar
  // la fila ya esté al día.
  assert.equal(write.data.stripeSubscriptionId, "sub_realty");
  assert.equal(write.data.plan, "ASESOR");
});

test("el plan se deduce de la lookup key del precio (campo de primer nivel)", () => {
  const sinMetadata: SubscriptionLike = {
    id: "sub_x",
    status: "active",
    metadata: { dc_vertical: "realty" },
    items: {
      data: [
        {
          id: "si",
          // Suscripción creada a mano en el dashboard: sin dc_plan.
          price: { id: "p", lookup_key: "dcrealty_INMOBILIARIA_month_99900" },
        },
      ],
    },
  };
  // Se lee `price.lookup_key`, NO `price.metadata.lookup_key` (que no existe).
  assert.equal(realtySubscriptionPatch(sinMetadata).plan, "INMOBILIARIA");
});

test("si no se pudo contar el consumo, el cupo falla CERRADO", () => {
  // Con ceros de mentira, "0 de 2 usuarios" dejaría pasar a cualquiera.
  const gate = realtyLimitGate("addUser", {
    plan: BASE,
    usage: usage({ degraded: true }),
    catalog: CATALOGO,
  });
  assert.equal(gate.allowed, false);
  assert.ok(gate.message.includes("consumo"), gate.message);
});

test("el fin de periodo se lee del ITEM y, si no, de la suscripción", () => {
  assert.equal(realtySubscriptionPeriodEndSeconds(REALTY_SUB), 1_800_000);
  assert.equal(
    realtySubscriptionPeriodEndSeconds({
      id: "s",
      status: "active",
      current_period_end: 999,
      items: { data: [{ id: "si", price: {} }] },
    }),
    999,
  );
  assert.equal(
    realtySubscriptionPeriodEndSeconds({ id: "s", status: "active" }),
    null,
  );
});
