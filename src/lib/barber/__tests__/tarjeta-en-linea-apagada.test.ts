// «Tarjeta en línea» APAGADA en membresías y anticipos (G1 de la auditoría
// ws6-t2, decisión de Rafael del 14-nov-2026).
//
// Qué demuestra, sin base de datos y sin red:
//   · la pantalla de «Vender membresía» ya no ofrece el método STRIPE;
//   · POST /api/barber/memberships/checkout responde 503 «por ahora no
//     disponible» SIN leer la base y SIN llamar a Stripe ni una vez;
//   · las dos funciones que inician un cobro en línea (membresía y anticipo)
//     cortan antes de tocar nada;
//   · la política de anticipos nunca queda con «cobrar en línea» encendido.
//
// Con el código anterior estas pruebas fallan: el checkout llegaba a la base
// (aquí un doble que truena) y de ahí a Stripe.
//
//   npx tsx --test src/lib/barber/__tests__/tarjeta-en-linea-apagada.test.ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import {
  BARBER_ONLINE_CARD_DISABLED_CODE,
  BARBER_ONLINE_CARD_ENABLED,
  membershipSaleMethods,
  normalizeDepositPolicy,
} from "../payments-core";

// ── Dobles ──────────────────────────────────────────────────────────────
// Se instalan ANTES de cargar payments.ts y la ruta (por eso esos dos se
// importan dinámicamente en before()).

const calls = { stripe: 0, db: 0 };

/** Cualquier acceso a Stripe cuenta. Nada llega a la red. */
function stripeDouble(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return undefined;
      calls.stripe += 1;
      return new Proxy(function () {}, handler);
    },
    apply() {
      calls.stripe += 1;
      return Promise.reject(new Error("Stripe no debe llamarse con la tarjeta en línea apagada"));
    },
  };
  return new Proxy(function () {}, handler);
}
class FakeStripe {
  constructor() {
    return stripeDouble() as FakeStripe;
  }
}

/** La base tampoco se toca: el candado va antes de cualquier lectura. */
const prismaDouble = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") return undefined;
      calls.db += 1;
      throw new Error(`La base no debe tocarse (prisma.${String(prop)})`);
    },
  },
);

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);

const FAKE_CTX = {
  barberUserId: "u1",
  barbershopId: "shop1",
  barbershop: { id: "shop1", plan: "PROFESIONAL", locale: "es" },
  user: { firstName: "Dueña", lastName: "Prueba", role: "OWNER" },
  barber: null,
  role: "OWNER",
};

const DOUBLES = new Map<string, unknown>([
  [abs("src/lib/prisma.ts"), { prisma: prismaDouble }],
  [
    abs("src/lib/barber-auth.ts"),
    {
      getBarberContext: async () => FAKE_CTX,
      assertBarberPermission: () => undefined,
    },
  ],
  [
    abs("src/lib/barber/plans.ts"),
    { getBarberPlan: async () => ({ features: { memberships: true, deposits: true } }) },
  ],
]);

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "stripe") return { __esModule: true, default: FakeStripe };
  try {
    const resolved = M._resolveFilename(request, parent);
    if (DOUBLES.has(resolved)) return DOUBLES.get(resolved);
  } catch {
    /* que lo resuelva (o falle) el cargador original */
  }
  return originalLoad.call(this, request, parent, isMain);
};

let payments: typeof import("../payments");
let checkoutRoute: typeof import("@/app/api/barber/memberships/checkout/route");

before(async () => {
  // Con una llave puesta, el código anterior SÍ intentaba cobrar.
  process.env.BARBER_PAYMENTS_STRIPE_SECRET_KEY = "sk_test_doble_no_real";
  payments = await import("../payments");
  checkoutRoute = await import("@/app/api/barber/memberships/checkout/route");
});

// ── El interruptor ──────────────────────────────────────────────────────

test("el interruptor de «Tarjeta en línea» está apagado", () => {
  assert.equal(BARBER_ONLINE_CARD_ENABLED, false);
});

test("Vender membresía ofrece efectivo, transferencia y tarjeta de mostrador — no «Tarjeta en línea»", () => {
  assert.deepEqual(membershipSaleMethods(), ["CASH", "SPEI", "CARD"]);
  assert.ok(!membershipSaleMethods().includes("STRIPE"));
  // El código no se borró: encendido vuelve a ofrecerla.
  assert.deepEqual(membershipSaleMethods(true), ["CASH", "SPEI", "CARD", "STRIPE"]);
});

test("el modal de venta pinta la lista del interruptor, no una lista propia con STRIPE", () => {
  const src = fs.readFileSync(abs("src/components/barber/memberships/sell-membership-modal.tsx"), "utf8");
  assert.match(src, /const METHODS: BarberPaymentMethod\[\] = membershipSaleMethods\(\);/);
  assert.doesNotMatch(src, /METHODS[^=\n]*=\s*\[[^\]]*"STRIPE"/);
});

test("Anticipos: el interruptor «cobrar en línea» y el campo acct_… dependen del interruptor", () => {
  const src = fs.readFileSync(abs("src/components/barber/memberships/deposits-tab.tsx"), "utf8");
  const iOnline = src.indexOf('t("barber.membresias.anticipos.online")');
  const iAccount = src.indexOf('t("barber.membresias.anticipos.stripeAccount")');
  assert.ok(iOnline > 0 && iAccount > 0, "siguen en el archivo (no se borró el código)");
  const gateOnline = src.lastIndexOf("{BARBER_ONLINE_CARD_ENABLED ? (", iOnline);
  const gateAccount = src.lastIndexOf("{BARBER_ONLINE_CARD_ENABLED && live.onlineEnabled ? (", iAccount);
  assert.ok(gateOnline > 0 && iOnline - gateOnline < 400, "el interruptor va detrás de la constante");
  assert.ok(gateAccount > 0 && iAccount - gateAccount < 400, "el campo acct_ va detrás de la constante");
});

test("la política de anticipos nunca queda con cobro en línea, aunque llegue encendido", () => {
  const p = normalizeDepositPolicy({ enabled: true, onlineEnabled: true, stripeAccountId: "acct_123ABC" });
  assert.equal(p.onlineEnabled, false);
  assert.equal(p.enabled, true, "el anticipo en mostrador sigue igual");
});

// ── Las funciones que INICIAN un cobro en línea ─────────────────────────

const isDisabled = (e: unknown) =>
  e instanceof payments.BarberPaymentsError &&
  e.code === BARBER_ONLINE_CARD_DISABLED_CODE &&
  e.status === 503 &&
  /por ahora no est[aá] disponible/i.test(e.message);

test("membresía con tarjeta en línea: corta antes de tocar la base o Stripe", async () => {
  calls.stripe = 0;
  calls.db = 0;
  await assert.rejects(
    payments.createMembershipCheckoutSession({
      barbershopId: "shop1",
      clientId: "c1",
      membershipId: "m1",
      recurring: true,
    }),
    isDisabled,
  );
  assert.equal(calls.stripe, 0, "ni una llamada a Stripe");
  assert.equal(calls.db, 0, "ni una lectura de la base");
});

test("anticipo con tarjeta en línea: corta antes de tocar la base o Stripe", async () => {
  calls.stripe = 0;
  calls.db = 0;
  await assert.rejects(
    payments.startDepositPayment({ barbershopId: "shop1", appointmentId: "a1" }),
    isDisabled,
  );
  assert.equal(calls.stripe, 0);
  assert.equal(calls.db, 0);
});

// ── La ruta ─────────────────────────────────────────────────────────────

test("POST /api/barber/memberships/checkout → 503 «por ahora no disponible», sin crear nada en Stripe", async () => {
  calls.stripe = 0;
  calls.db = 0;
  const res = await checkoutRoute.POST(
    new Request("http://localhost/api/barber/memberships/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "c1", membershipId: "m1", recurring: true }),
    }),
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; code: string; url?: string };
  assert.equal(body.code, BARBER_ONLINE_CARD_DISABLED_CODE);
  assert.match(body.error, /por ahora no est[aá] disponible/i);
  assert.equal(body.url, undefined, "no devuelve liga de pago");
  assert.equal(calls.stripe, 0, "ni una llamada a Stripe");
  assert.equal(calls.db, 0, "ni una lectura de la base");
});
