/**
 * MÉTODO DE PAGO EN CONFIGURACIÓN → SUSCRIPCIÓN — con tarjeta en Stripe lo
 * dice; sin respuesta de Stripe no miente.
 *
 * Run: npm run test:metodo-de-pago
 *
 * Conduce la RUTA real (`GET /api/billing/payment-method`) contra un doble de
 * prisma y un doble de Stripe, y pasa su respuesta por el MISMO resolutor que
 * usan las dos vistas de la pestaña (`resolverMetodoPago`). El caso real es
 * BEVADENT: suscripción activa, tarjeta terminada en 0038 en Stripe y
 * `paymentMethodCollected = false` porque el alta no la pidió.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolverMetodoPago,
  textosMetodoPago,
  avisoMetodoPago,
} from "@/lib/billing/metodo-de-pago-vista";

// ── Dobles ──────────────────────────────────────────────────────────────────

let clinica: Record<string, any> | null;
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findUnique: async ({ where }: any) => (clinica && clinica.id === where.id ? clinica : null),
      },
    },
  },
});

let sesion: { clinicId: string; role: string };
(mock as any).module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => sesion },
});

type Stripe = {
  subscriptions: { retrieve: (...a: any[]) => Promise<any> };
  customers: { retrieve: (...a: any[]) => Promise<any> };
  paymentMethods: { retrieve: (...a: any[]) => Promise<any> };
};
let stripe: Stripe | null;
const llamadas: string[] = [];
(mock as any).module("@/lib/stripe", {
  namedExports: { getStripeSafe: () => stripe },
});

const TARJETA_0038 = {
  id: "pm_0038",
  type: "card",
  card: { brand: "visa", last4: "0038", exp_month: 12, exp_year: 2030 },
};

function stripeConTarjetaEnSuscripcion(): Stripe {
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        llamadas.push(`subscriptions.retrieve ${id}`);
        return {
          id,
          status: "active",
          default_payment_method: TARJETA_0038,
          items: { data: [{ price: { unit_amount: 68900, currency: "mxn", recurring: { interval: "month", interval_count: 1 } }, quantity: 1 }] },
        };
      },
    },
    customers: { retrieve: async () => { throw new Error("no debería llegar al customer"); } },
    paymentMethods: { retrieve: async () => { throw new Error("ya venía expandido"); } },
  };
}

function stripeSinMetodo(): Stripe {
  return {
    subscriptions: {
      retrieve: async (id: string) => ({ id, status: "active", default_payment_method: null, items: { data: [] } }),
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", deleted: false, invoice_settings: { default_payment_method: null } }),
    },
    paymentMethods: { retrieve: async () => null },
  };
}

function stripeCaido(): Stripe {
  const caida = async () => { throw new Error("ECONNRESET"); };
  return {
    subscriptions: { retrieve: caida },
    customers: { retrieve: caida },
    paymentMethods: { retrieve: caida },
  };
}

async function consultar() {
  const { GET } = await import("@/app/api/billing/payment-method/route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

const ALTA_SIN_TARJETA = { collected: false, type: null, last4: null };

beforeEach(() => {
  llamadas.length = 0;
  sesion = { clinicId: "bevadent", role: "SUPER_ADMIN" };
  clinica = { id: "bevadent", stripeCustomerId: "cus_bevadent", stripeSubscriptionId: "sub_bevadent" };
  stripe = stripeConTarjetaEnSuscripcion();
});

// ═══════════════════════════════════════════════════════════════════════════
// Con tarjeta en Stripe lo dice
// ═══════════════════════════════════════════════════════════════════════════

test("BEVADENT: la ruta devuelve la Visa terminada en 0038 aunque el alta no la pidió", async () => {
  const { status, body } = await consultar();
  assert.equal(status, 200);
  assert.deepEqual(body.paymentMethod, {
    state: "found", type: "card", brand: "visa", last4: "0038", expMonth: 12, expYear: 2030, source: "subscription",
  });
  assert.deepEqual(llamadas, ["subscriptions.retrieve sub_bevadent"], "una sola llamada, la de la suscripción");

  const vista = resolverMetodoPago({ live: body.paymentMethod, alta: ALTA_SIN_TARJETA, subscriptionActive: true });
  assert.deepEqual(vista, { kind: "card", brand: "visa", last4: "0038" });

  const t = (k: string, p?: Record<string, string | number>) =>
    k === "shell.subscriptionTab.cardBrandEndingIn" ? `${p!.brand} terminada en •••• ${p!.last4}` : k;
  assert.deepEqual(textosMetodoPago(vista, t, false), {
    marca: "CARD",
    titulo: "Visa terminada en •••• 0038",
    sub: "shell.subscriptionTab.autoMonthlyCharge",
  });
});

test("la tarjeta de Stripe manda sobre lo que dijo el alta (SPEI en el formulario, tarjeta después)", async () => {
  const { body } = await consultar();
  const vista = resolverMetodoPago({
    live: body.paymentMethod,
    alta: { collected: true, type: "spei", last4: null },
    subscriptionActive: true,
  });
  assert.equal(vista.kind, "card");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin Stripe no miente
// ═══════════════════════════════════════════════════════════════════════════

test("Stripe caído: la ruta contesta 200 «unavailable» y la vista no afirma que no hay método", async () => {
  stripe = stripeCaido();
  const { status, body } = await consultar();
  assert.equal(status, 200, "la pantalla no se cae");
  assert.equal(body.paymentMethod.state, "unavailable");

  const vista = resolverMetodoPago({ live: body.paymentMethod, alta: ALTA_SIN_TARJETA, subscriptionActive: true });
  assert.deepEqual(vista, { kind: "unknown" });
  const aviso = avisoMetodoPago(vista);
  assert.equal(aviso.clave, "shell.subscriptionTab.paymentMethodUnknown");
  assert.equal(aviso.tono, "neutro", "sin respuesta no se alarma");
  assert.notEqual(aviso.clave, "shell.subscriptionTab.noPaymentMethod");
});

test("Stripe sin configurar: «unavailable», y si el alta sí dijo algo, se enseña eso", async () => {
  stripe = null;
  const { body } = await consultar();
  assert.equal(body.paymentMethod.state, "unavailable");

  const vista = resolverMetodoPago({
    live: body.paymentMethod,
    alta: { collected: true, type: "spei", last4: null },
    subscriptionActive: true,
  });
  assert.deepEqual(vista, { kind: "signup", type: "spei", last4: null });
});

test("mientras carga tampoco se afirma nada", () => {
  const vista = resolverMetodoPago({ live: null, alta: ALTA_SIN_TARJETA, subscriptionActive: true });
  assert.deepEqual(vista, { kind: "loading" });
  assert.equal(avisoMetodoPago(vista).tono, "neutro");
});

// ═══════════════════════════════════════════════════════════════════════════
// Stripe contesta «sin método»: se dice, sin contradecir a una suscripción activa
// ═══════════════════════════════════════════════════════════════════════════

test("sin método en Stripe y suscripción activa: aviso neutro, no la alarma de «configura uno»", async () => {
  stripe = stripeSinMetodo();
  const { body } = await consultar();
  assert.equal(body.paymentMethod.state, "none");

  const activa = resolverMetodoPago({ live: body.paymentMethod, alta: ALTA_SIN_TARJETA, subscriptionActive: true });
  assert.deepEqual(activa, { kind: "none-active" });
  assert.equal(avisoMetodoPago(activa).tono, "neutro");

  const vencida = resolverMetodoPago({ live: body.paymentMethod, alta: ALTA_SIN_TARJETA, subscriptionActive: false });
  assert.deepEqual(vencida, { kind: "none" });
  assert.equal(avisoMetodoPago(vencida).clave, "shell.subscriptionTab.noPaymentMethod");
  assert.equal(avisoMetodoPago(vencida).tono, "alerta");
});

test("sin cliente en Stripe: «none» (no hay tarjeta en Stripe), sin llamar a Stripe y sin decir «no pudimos consultar»", async () => {
  clinica = { id: "bevadent", stripeCustomerId: null, stripeSubscriptionId: null };
  stripe = stripeCaido(); // si la ruta llamara a Stripe, saldría «unavailable»
  const { body } = await consultar();
  assert.deepEqual(body.paymentMethod, { state: "none" });
  assert.deepEqual(llamadas, []);

  // Clínica por SPEI (el alta lo dijo): se enseña la transferencia.
  const spei = resolverMetodoPago({ live: body.paymentMethod, alta: { collected: true, type: "spei", last4: null }, subscriptionActive: true });
  assert.deepEqual(spei, { kind: "signup", type: "spei", last4: null });
  // Sin nada en el alta y con la suscripción activa: aviso neutro.
  const nada = resolverMetodoPago({ live: body.paymentMethod, alta: ALTA_SIN_TARJETA, subscriptionActive: true });
  assert.deepEqual(nada, { kind: "none-active" });
});

test("Stripe dice «sin método» y el alta dijo «tarjeta»: no se enseña una tarjeta que Stripe no tiene", async () => {
  stripe = stripeSinMetodo();
  const { body } = await consultar();
  const vista = resolverMetodoPago({ live: body.paymentMethod, alta: { collected: true, type: "card", last4: "4242" }, subscriptionActive: true });
  assert.deepEqual(vista, { kind: "none-active" });
});

test("Stripe caído y el alta dijo «tarjeta»: se enseña la del alta (no se afirma lo contrario)", async () => {
  stripe = stripeCaido();
  const { body } = await consultar();
  const vista = resolverMetodoPago({ live: body.paymentMethod, alta: { collected: true, type: "card", last4: "4242" }, subscriptionActive: true });
  assert.deepEqual(vista, { kind: "signup", type: "card", last4: "4242" });
});

// ═══════════════════════════════════════════════════════════════════════════
// Aislamiento
// ═══════════════════════════════════════════════════════════════════════════

test("el clinicId sale de la sesión: otra sesión no ve la clínica de BEVADENT", async () => {
  sesion = { clinicId: "otra", role: "SUPER_ADMIN" };
  const { status } = await consultar();
  assert.equal(status, 404);
  assert.deepEqual(llamadas, []);
});

test("un usuario sin permiso de facturación recibe 403", async () => {
  sesion = { clinicId: "bevadent", role: "RECEPTIONIST" };
  const { status } = await consultar();
  assert.equal(status, 403);
  assert.deepEqual(llamadas, []);
});
