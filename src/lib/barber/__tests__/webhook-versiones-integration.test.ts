// El webhook de barber NO depende de la versión de API del endpoint de Stripe
// (15-nov-2026). Rafael lo crea con 2025-02-24.acacia (el del dental usa
// 2026-05-27.dahlia), mientras el cliente de barber sigue fijado en
// 2024-06-20. Del evento solo se usa el tipo, el id del evento y el id del
// objeto; todo lo demás se RELEE por la API. Y la relectura entiende las dos
// formas por si algún día se sube la versión fijada:
//   · acacia/2024: invoice.subscription, invoice.subscription_details,
//     line.price, invoice.payment_intent, subscription.current_period_end;
//   · dahlia: invoice.parent.subscription_details, line.pricing, sin
//     payment_intent en la factura, current_period_end en los items.
// Y en la MISMA cuenta están las suscripciones del DENTAL: su factura, su
// suscripción o su sesión llegan aquí y se ignoran con 200, sin escribir nada
// y sin error ruidoso.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local (_base-local.ts).
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/webhook-versiones-integration.test.ts
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { skip } from "./_base-local";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_de_prueba_no_sale_a_la_red";
process.env.BARBER_STRIPE_WEBHOOK_SECRET = "whsec_de_prueba";

let prisma: typeof import("@/lib/prisma")["prisma"];
let POST: typeof import("@/app/api/barber/stripe/webhook/route")["POST"];

/* ═══════════ Stripe simulado: lo que devuelve la API al RELEER ═══════════ */

const subs = new Map<string, any>();
const invoices = new Map<string, any>();
const sesiones = new Map<string, any>();
/** Llamadas a la API de Stripe (para saber qué se releyó y con qué expand). */
const llamadas: string[] = [];
/** La versión «nueva» rechaza expandir payment_intent (ya no existe en la factura). */
const sinPaymentIntent = new Set<string>();

const s = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const RUN = `ver${Date.now().toString(36)}`;
const META = (shopId: string) => ({
  dc_vertical: "barber",
  dc_kind: "barber-subscription",
  barbershopId: shopId,
  dc_plan: "PROFESIONAL",
  dc_interval: "month",
});
const PRECIO = {
  id: "price_pro_m",
  unit_amount: 74900,
  currency: "mxn",
  recurring: { interval: "month" },
  metadata: { dc_vertical: "barber", dc_plan: "PROFESIONAL", dc_interval: "month" },
};
const INICIO = s("2026-12-14T16:00:00Z");
const FIN = s("2027-01-14T16:00:00Z");

/** Suscripción forma ACACIA / 2024: current_period_end en la suscripción. */
function subAcacia(id: string, shopId: string, customer: string, status = "active") {
  return {
    id, object: "subscription", status, customer, metadata: META(shopId), cancel_at_period_end: false,
    current_period_start: INICIO, current_period_end: FIN,
    items: { data: [{ id: `si_${id}`, quantity: 1, price: PRECIO }] },
  };
}
/** Suscripción forma DAHLIA: el periodo vive en los items. */
function subDahlia(id: string, shopId: string, customer: string, status = "active") {
  return {
    id, object: "subscription", status, customer, metadata: META(shopId), cancel_at_period_end: false,
    items: { data: [{ id: `si_${id}`, quantity: 1, current_period_start: INICIO, current_period_end: FIN, price: PRECIO }] },
  };
}
/** Factura forma ACACIA / 2024. */
function facturaAcacia(id: string, sub: any, over: Record<string, any> = {}) {
  return {
    id, object: "invoice", status: "paid", customer: sub.customer,
    subscription: sub.id, subscription_details: { metadata: sub.metadata },
    amount_paid: 74900, amount_due: 74900, currency: "mxn",
    status_transitions: { paid_at: INICIO + 3600 },
    payment_intent: "pi_123",
    lines: { data: [{ amount: 74900, type: "subscription", subscription: sub.id, period: { start: INICIO, end: FIN }, price: PRECIO }] },
    ...over,
  };
}
/** Factura forma DAHLIA: sin invoice.subscription, sin line.price, sin payment_intent. */
function facturaDahlia(id: string, sub: any, over: Record<string, any> = {}) {
  return {
    id, object: "invoice", status: "paid", customer: sub.customer,
    parent: { type: "subscription_details", subscription_details: { subscription: sub.id, metadata: sub.metadata } },
    amount_paid: 74900, amount_due: 74900, currency: "mxn",
    status_transitions: { paid_at: INICIO + 3600 },
    lines: {
      data: [{
        amount: 74900,
        period: { start: INICIO, end: FIN },
        pricing: { type: "price_details", price_details: { price: PRECIO.id, product: "prod_pro" } },
        parent: { type: "subscription_item_details", subscription_item_details: { subscription: sub.id } },
      }],
    },
    ...over,
  };
}

let evSeq = 0;
async function enviar(type: string, object: any) {
  const req = new NextRequest("http://localhost/api/barber/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=prueba" },
    body: JSON.stringify({ id: `evt_${RUN}_${++evSeq}`, type, api_version: "x", data: { object } }),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

/* ═══════════ Semilla ═══════════ */

const creadas: string[] = [];
let seq = 0;
async function barberia(status = "active") {
  const n = ++seq;
  const shop = await prisma.barbershop.create({
    data: {
      name: `Versiones ${n}`, slug: `${RUN}-${n}`, plan: "PROFESIONAL" as never,
      subscriptionStatus: status, stripeCustomerId: `cus_${RUN}_${n}`,
    },
  });
  creadas.push(shop.id);
  return shop;
}
async function cobros(shopId: string) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT stripe_invoice_id, status, amount_cents, plan_id, billing_interval, period_end, failure_code
       FROM barber_subscription_payments WHERE barbershop_id = $1 ORDER BY created_at`,
    shopId,
  );
}
async function terminos(shopId: string) {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT price_cents, billing_interval, plan_id, stripe_status, current_period_end FROM barber_subscriptions WHERE barbershop_id = $1`,
    shopId,
  );
  return r[0] ?? null;
}
/**
 * ¿Quedó en las tablas de barber ALGO del dental? (factura, suscripción o
 * cliente de Stripe de la clínica). Acotado a esos ids y no a conteos
 * globales: otras suites escriben a la vez en esta misma base.
 */
async function rastroDental(): Promise<number[]> {
  const [p, t, sh] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::int AS n FROM barber_subscription_payments WHERE stripe_invoice_id LIKE '%dental%' OR stripe_subscription_id = 'sub_dental_1'`,
    ),
    prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM barber_subscriptions WHERE stripe_subscription_id = 'sub_dental_1'`),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::int AS n FROM barber_shops WHERE "stripeSubscriptionId" = 'sub_dental_1' OR "stripeCustomerId" = 'cus_clinica_dental'`,
    ),
  ]);
  return [p[0].n, t[0].n, sh[0].n];
}

before(async () => {
  if (skip) return;
  ({ prisma } = await import("@/lib/prisma"));
  ({ POST } = await import("@/app/api/barber/stripe/webhook/route"));
  const { getBarberStripe } = await import("@/lib/barber/billing");
  const stripe = getBarberStripe() as any;
  stripe.webhooks.constructEvent = (raw: string) => JSON.parse(raw);
  const falta = (que: string) => Object.assign(new Error(`No such ${que}`), { code: "resource_missing" });
  stripe.subscriptions.retrieve = async (id: string) => {
    llamadas.push(`sub ${id}`);
    if (!subs.has(id)) throw falta("subscription");
    return subs.get(id);
  };
  stripe.invoices.retrieve = async (id: string, params?: { expand?: string[] }) => {
    llamadas.push(`inv ${id} ${JSON.stringify(params?.expand ?? [])}`);
    if (params?.expand?.includes("payment_intent") && sinPaymentIntent.has(id)) {
      throw Object.assign(new Error("This property cannot be expanded (payment_intent)."), { type: "StripeInvalidRequestError" });
    }
    if (!invoices.has(id)) throw falta("invoice");
    return invoices.get(id);
  };
  stripe.checkout.sessions.retrieve = async (id: string) => {
    llamadas.push(`cs ${id}`);
    if (!sesiones.has(id)) throw falta("checkout session");
    return sesiones.get(id);
  };
});

after(async () => {
  if (skip) return;
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas } } });
  await prisma.$disconnect();
});

/* ═══════════ Pruebas ═══════════ */

for (const [version, mkSub, mkFactura] of [
  ["acacia", subAcacia, facturaAcacia],
  ["dahlia", subDahlia, facturaDahlia],
] as const) {
  test(`${version}: invoice.paid guarda importe, periodo, plan y suscripción RELEÍDOS, y activa`, { skip }, async () => {
    const shop = await barberia("past_due");
    const sub = mkSub(`sub_${RUN}_${version}`, shop.id, shop.stripeCustomerId!);
    subs.set(sub.id, sub);
    const inv = mkFactura(`in_${RUN}_${version}`, sub);
    invoices.set(inv.id, inv);
    if (version === "dahlia") sinPaymentIntent.add(inv.id);

    // El payload trae la forma de SU versión… y además miente en el importe:
    // se usa solo el id; manda lo releído.
    const r = await enviar("invoice.paid", { ...inv, amount_paid: 1, lines: { data: [] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, "invoice:paid:guardado");

    const f = await cobros(shop.id);
    assert.equal(f.length, 1);
    assert.deepEqual(
      [f[0].stripe_invoice_id, f[0].status, f[0].amount_cents, f[0].plan_id, f[0].billing_interval],
      [inv.id, "paid", 74900, "PROFESIONAL", "month"],
    );
    assert.equal(new Date(f[0].period_end).toISOString(), "2027-01-14T16:00:00.000Z");
    // Los términos (y el fin de periodo) salen de la suscripción releída, en cualquiera de las dos formas.
    const t = await terminos(shop.id);
    assert.deepEqual([t.price_cents, t.billing_interval, t.plan_id, t.stripe_status], [74900, "month", "PROFESIONAL", "active"]);
    assert.equal(new Date(t.current_period_end).toISOString(), "2027-01-14T16:00:00.000Z");
    const fila = await prisma.barbershop.findUnique({ where: { id: shop.id }, select: { subscriptionStatus: true, stripeSubscriptionId: true } });
    assert.deepEqual(fila, { subscriptionStatus: "active", stripeSubscriptionId: sub.id });
  });

  test(`${version}: invoice.payment_failed guarda el rechazo con lo que se intentó cobrar`, { skip }, async () => {
    const shop = await barberia("active");
    const sub = mkSub(`sub_${RUN}_${version}_f`, shop.id, shop.stripeCustomerId!, "past_due");
    subs.set(sub.id, sub);
    const inv = mkFactura(`in_${RUN}_${version}_f`, sub, { status: "open", amount_paid: 0, status_transitions: { paid_at: null } });
    invoices.set(inv.id, inv);
    if (version === "dahlia") sinPaymentIntent.add(inv.id);
    const r = await enviar("invoice.payment_failed", { id: inv.id, object: "invoice" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const f = await cobros(shop.id);
    assert.deepEqual([f.length, f[0].status, f[0].amount_cents], [1, "failed", 74900]);
    const fila = await prisma.barbershop.findUnique({ where: { id: shop.id }, select: { subscriptionStatus: true } });
    assert.equal(fila?.subscriptionStatus, "past_due");
  });

  test(`${version}: customer.subscription.updated y checkout.session.completed se resuelven releyendo`, { skip }, async () => {
    const shop = await barberia("pending_payment");
    const sub = mkSub(`sub_${RUN}_${version}_c`, shop.id, shop.stripeCustomerId!);
    subs.set(sub.id, sub);
    const sesion = { id: `cs_${RUN}_${version}`, object: "checkout.session", mode: "subscription", metadata: META(shop.id), subscription: sub.id };
    sesiones.set(sesion.id, sesion);
    // Payloads vacíos salvo el id: si el código leyera del payload, no sabría nada.
    const c = await enviar("checkout.session.completed", { id: sesion.id });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.action, "checkout:ok");
    const u = await enviar("customer.subscription.updated", { id: sub.id });
    assert.equal(u.body.action, "subscription:ok");
    const fila = await prisma.barbershop.findUnique({ where: { id: shop.id }, select: { subscriptionStatus: true } });
    assert.equal(fila?.subscriptionStatus, "active");
  });
}

test("dahlia: si expandir payment_intent ya no existe, relee sin expandir (no truena)", { skip }, async () => {
  const id = `in_${RUN}_dahlia`;
  const intentos = llamadas.filter((l) => l.startsWith(`inv ${id} `));
  assert.ok(intentos.some((l) => l.includes("payment_intent")), "primero intenta con expand");
  assert.ok(intentos.some((l) => l.endsWith("[]")), "luego sin expand");
});

/* ═══════════ El DENTAL vive en la misma cuenta ═══════════ */

test("una factura PAGADA de una clínica dental llega al webhook de barber → 200, no cambia nada, sin error ruidoso", { skip }, async () => {
  // La factura de una suscripción del dental, en la forma nueva (dahlia) y en la vieja.
  const dentalDahlia = {
    id: `in_${RUN}_dental_d`, object: "invoice", status: "paid", customer: "cus_clinica_dental",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_dental_1", metadata: { clinicId: "clinica-1", plan: "CLINIC" } } },
    amount_paid: 99900, amount_due: 99900, currency: "mxn", status_transitions: { paid_at: INICIO },
    lines: { data: [{ amount: 99900, period: { start: INICIO, end: FIN }, pricing: { type: "price_details", price_details: { price: "price_dental_clinic" } } }] },
  };
  const dentalAcacia = {
    id: `in_${RUN}_dental_a`, object: "invoice", status: "paid", customer: "cus_clinica_dental",
    subscription: "sub_dental_1", subscription_details: { metadata: { clinicId: "clinica-1" } },
    amount_paid: 99900, amount_due: 99900, currency: "mxn", status_transitions: { paid_at: INICIO },
    lines: { data: [{ amount: 99900, period: { start: INICIO, end: FIN }, price: { id: "price_dental_clinic", recurring: { interval: "month" }, metadata: { vertical: "dental" } } }] },
  };
  invoices.set(dentalDahlia.id, dentalDahlia);
  invoices.set(dentalAcacia.id, dentalAcacia);
  subs.set("sub_dental_1", { id: "sub_dental_1", status: "active", customer: "cus_clinica_dental", metadata: { clinicId: "clinica-1" }, items: { data: [{ price: { id: "price_dental_clinic", metadata: {} } }] } });
  sesiones.set("cs_dental_1", { id: "cs_dental_1", mode: "subscription", metadata: { clinicId: "clinica-1", plan: "CLINIC" }, subscription: "sub_dental_1" });

  const errores: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errores.push(a);
  try {
    for (const [tipo, obj] of [
      ["invoice.paid", dentalDahlia],
      ["invoice.paid", dentalAcacia],
      ["invoice.payment_failed", dentalDahlia],
      ["customer.subscription.updated", { id: "sub_dental_1" }],
      ["customer.subscription.deleted", { id: "sub_dental_1" }],
      ["checkout.session.completed", { id: "cs_dental_1" }],
    ] as const) {
      const r = await enviar(tipo, obj);
      assert.equal(r.status, 200, `${tipo}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.handled, false, tipo);
      assert.equal(r.body.action, "not-barber", tipo);
    }
  } finally {
    console.error = original;
  }
  assert.deepEqual(errores, [], "sin error ruidoso en el log");
  assert.deepEqual(await rastroDental(), [0, 0, 0], "nada del dental quedó en las tablas de barber");
});

test("un evento cuyo objeto ya no existe en Stripe se ignora con 200 (sin reintentos eternos)", { skip }, async () => {
  for (const [tipo, id, accion] of [
    ["invoice.paid", "in_no_existe", "invoice:not-found"],
    ["customer.subscription.updated", "sub_no_existe", "subscription:not-found"],
    ["checkout.session.completed", "cs_no_existe", "checkout:not-found"],
  ] as const) {
    const r = await enviar(tipo, { id });
    assert.deepEqual([r.status, r.body.action], [200, accion], tipo);
  }
});

test("si Stripe no responde al releer, 500 para que reintente (no se decide con el payload)", { skip }, async () => {
  const { getBarberStripe } = await import("@/lib/barber/billing");
  const stripe = getBarberStripe() as any;
  const real = stripe.invoices.retrieve;
  stripe.invoices.retrieve = async () => {
    throw Object.assign(new Error("connect ETIMEDOUT"), { type: "StripeConnectionError" });
  };
  const errores: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errores.push(a);
  try {
    const r = await enviar("invoice.paid", { id: `in_${RUN}_acacia`, amount_paid: 74900 });
    assert.equal(r.status, 500);
  } finally {
    console.error = original;
    stripe.invoices.retrieve = real;
  }
  assert.ok(errores.length > 0, "el fallo transitorio sí queda en el log");
});
