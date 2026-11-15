// COBROS de la suscripción de barber, de punta a punta: el webhook REAL
// (/api/barber/stripe/webhook) contra Postgres local con sql/barber_cobros.sql.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local (_base-local.ts).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/cobros-integration.test.ts
//
// Qué es real y qué no:
//   · REAL → la ruta del webhook, billing.ts, cobros.ts, el SQL y la base.
//   · DOBLE → Stripe: la firma (constructEvent devuelve el JSON tal cual) y
//     las lecturas de la suscripción y la factura «vivas». Nada sale a la red.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { skip } from "./_base-local";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_de_prueba_no_sale_a_la_red";
process.env.BARBER_STRIPE_WEBHOOK_SECRET = "whsec_de_prueba";

let prisma: typeof import("@/lib/prisma")["prisma"];
let POST: typeof import("@/app/api/barber/stripe/webhook/route")["POST"];
let cargarCobrosAdmin: typeof import("@/lib/barber/cobros")["cargarCobrosAdmin"];
let leerRegistroBarber: typeof import("@/lib/barber/cobros")["leerRegistroBarber"];
let guardarCobroBarber: typeof import("@/lib/barber/cobros")["guardarCobroBarber"];

/* ═══════════════ Stripe simulado ═══════════════ */

const subs = new Map<string, any>();
const invoices = new Map<string, any>();
const s = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function precio(cents: number, interval: "month" | "year", plan = "PROFESIONAL") {
  return {
    id: `price_${plan}_${interval}_${cents}`,
    unit_amount: cents,
    currency: "mxn",
    recurring: { interval },
    metadata: { dc_vertical: "barber", dc_plan: plan, dc_interval: interval },
  };
}

function suscripcion(id: string, shopId: string, customer: string, over: Record<string, any> = {}) {
  const sub = {
    id,
    status: "active",
    customer,
    cancel_at_period_end: false,
    metadata: { dc_vertical: "barber", dc_kind: "barber-subscription", barbershopId: shopId, dc_plan: "PROFESIONAL" },
    items: { data: [{ id: `si_${id}`, quantity: 1, current_period_end: s("2026-12-14T16:00:00Z"), price: precio(74900, "month") }] },
    ...over,
  };
  subs.set(id, sub);
  return sub;
}

function factura(id: string, sub: any, over: Record<string, any> = {}) {
  const inv = {
    id,
    status: "paid",
    customer: sub.customer,
    subscription: sub.id,
    subscription_details: { metadata: sub.metadata },
    amount_paid: 74900,
    amount_due: 74900,
    currency: "mxn",
    created: s("2026-11-14T16:00:00Z"),
    status_transitions: { paid_at: s("2026-11-14T16:01:00Z") },
    lines: {
      data: [
        {
          amount: 74900,
          period: { start: s("2026-11-14T16:00:00Z"), end: s("2026-12-14T16:00:00Z") },
          price: sub.items.data[0].price,
        },
      ],
    },
    ...over,
  };
  invoices.set(id, inv);
  return inv;
}

let evSeq = 0;
async function enviar(type: string, object: any): Promise<{ status: number; body: any }> {
  const req = new NextRequest("http://localhost/api/barber/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=prueba", "content-type": "application/json" },
    body: JSON.stringify({ id: `evt_${++evSeq}`, type, data: { object } }),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

/* ═══════════════ Semilla ═══════════════ */

const creadas: string[] = [];
const RUN = `cob${Date.now().toString(36)}`;
let seq = 0;

async function barberia(opts: { status?: string; parentId?: string | null } = {}) {
  const n = ++seq;
  const shop = await prisma.barbershop.create({
    data: {
      name: `Cobros ${n}`,
      slug: `${RUN}-${n}`,
      plan: "PROFESIONAL" as never,
      subscriptionStatus: opts.status ?? "pending_payment",
      stripeCustomerId: opts.parentId ? null : `cus_${RUN}_${n}`,
      parentId: opts.parentId ?? null,
    },
  });
  creadas.push(shop.id);
  return shop;
}

async function filas(shopId: string) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT stripe_invoice_id, status, amount_cents, period_end, paid_at, plan_id, billing_interval
       FROM barber_subscription_payments WHERE barbershop_id = $1 ORDER BY created_at`,
    shopId,
  );
}

async function terminos(shopId: string) {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT price_cents, billing_interval, plan_id, stripe_status FROM barber_subscriptions WHERE barbershop_id = $1`,
    shopId,
  );
  return r[0] ?? null;
}

before(async () => {
  if (skip) return;
  ({ prisma } = await import("@/lib/prisma"));
  ({ POST } = await import("@/app/api/barber/stripe/webhook/route"));
  ({ cargarCobrosAdmin, leerRegistroBarber, guardarCobroBarber } = await import("@/lib/barber/cobros"));
  const { getBarberStripe } = await import("@/lib/barber/billing");
  const stripe = getBarberStripe() as any;
  stripe.webhooks.constructEvent = (raw: string) => JSON.parse(raw);
  stripe.subscriptions.retrieve = async (id: string) => {
    const sub = subs.get(id);
    if (!sub) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    return sub;
  };
  stripe.invoices.retrieve = async (id: string) => {
    const inv = invoices.get(id);
    if (!inv) throw Object.assign(new Error("No such invoice"), { code: "resource_missing" });
    return inv;
  };
  stripe.checkout.sessions.retrieve = async (id: string) => {
    throw Object.assign(new Error(`No such checkout session: ${id}`), { code: "resource_missing" });
  };
});

after(async () => {
  if (skip) return;
  // Hijas primero (la FK de parentId es SET NULL, pero así no quedan sueltas).
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas }, parentId: { not: null } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas } } });
  await prisma.$disconnect();
});

/* ═══════════════ Pruebas ═══════════════ */

test("alta: invoice.paid guarda el cobro UNA vez aunque Stripe repita el evento", { skip }, async () => {
  const shop = await barberia();
  const sub = suscripcion(`sub_${RUN}_alta`, shop.id, shop.stripeCustomerId!);
  const inv = factura(`in_${RUN}_alta`, sub);

  const r1 = await enviar("invoice.paid", inv);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.handled, true);
  assert.match(r1.body.action, /^invoice:paid:guardado$/);
  await enviar("invoice.paid", inv);
  await enviar("invoice.payment_succeeded", inv);

  const f = await filas(shop.id);
  assert.equal(f.length, 1);
  assert.deepEqual(
    [f[0].stripe_invoice_id, f[0].status, f[0].amount_cents, f[0].plan_id, f[0].billing_interval],
    [inv.id, "paid", 74900, "PROFESIONAL", "month"],
  );
  assert.equal(new Date(f[0].period_end).toISOString(), "2026-12-14T16:00:00.000Z");

  // El mismo evento activó la barbería (relee la suscripción) y guardó lo que Stripe cobra.
  const fresh = await prisma.barbershop.findUnique({ where: { id: shop.id }, select: { subscriptionStatus: true, stripeSubscriptionId: true } });
  assert.deepEqual(fresh, { subscriptionStatus: "active", stripeSubscriptionId: sub.id });
  assert.deepEqual(await terminos(shop.id), { price_cents: 74900, billing_interval: "month", plan_id: "PROFESIONAL", stripe_status: "active" });
});

test("rechazo y luego pago de la MISMA factura: una fila que pasa de 'failed' a 'paid'", { skip }, async () => {
  const shop = await barberia({ status: "active" });
  const sub = suscripcion(`sub_${RUN}_rech`, shop.id, shop.stripeCustomerId!);
  const inv = factura(`in_${RUN}_rech`, sub, { status: "open", amount_paid: 0, status_transitions: { paid_at: null } });

  await enviar("invoice.payment_failed", inv);
  let f = await filas(shop.id);
  assert.deepEqual([f.length, f[0].status, f[0].amount_cents, f[0].paid_at], [1, "failed", 74900, null]);

  // La tarjeta pasó en el reintento: misma factura, ahora pagada.
  factura(inv.id, sub);
  await enviar("invoice.paid", invoices.get(inv.id));
  f = await filas(shop.id);
  assert.deepEqual([f.length, f[0].status, f[0].amount_cents], [1, "paid", 74900]);
});

test("un rechazo que llega DESPUÉS del pago no deshace el cobro", { skip }, async () => {
  const shop = await barberia({ status: "active" });
  const sub = suscripcion(`sub_${RUN}_orden`, shop.id, shop.stripeCustomerId!);
  const pagada = factura(`in_${RUN}_orden`, sub);
  await enviar("invoice.paid", pagada);
  // Stripe no garantiza el orden: el payment_failed viejo llega al final. Del
  // evento solo se toma el id: la factura RELEÍDA ya está pagada.
  await enviar("invoice.payment_failed", { ...pagada, status: "open" });
  invoices.delete(pagada.id); // ya no existe en Stripe: se ignora con 200, la fila no baja
  const r = await enviar("invoice.payment_failed", { ...pagada, status: "open", amount_paid: 0 });
  assert.deepEqual([r.status, r.body.action], [200, "invoice:not-found"]);
  const f = await filas(shop.id);
  assert.deepEqual([f.length, f[0].status, f[0].amount_cents], [1, "paid", 74900]);
});

test("las facturas del dental no se registran (misma cuenta de Stripe)", { skip }, async () => {
  // La factura del dental, como la devuelve Stripe al releerla.
  invoices.set(`in_${RUN}_dental`, {
    id: `in_${RUN}_dental`,
    status: "paid",
    customer: "cus_dental",
    subscription: "sub_dental",
    subscription_details: { metadata: { clinicId: "clinica-1" } },
    amount_paid: 59900,
    lines: { data: [{ amount: 59900, price: { id: "price_dental", recurring: { interval: "month" }, metadata: {} } }] },
  });
  const r = await enviar("invoice.paid", { id: `in_${RUN}_dental`, object: "invoice" });
  assert.equal(r.status, 200);
  assert.equal(r.body.handled, false);
  assert.equal(r.body.action, "not-barber");
  // Acotado a SU factura: otras suites escriben a la vez en esta misma base.
  const rastro = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*)::int AS n FROM barber_subscription_payments WHERE stripe_invoice_id = $1`,
    `in_${RUN}_dental`,
  );
  assert.equal(rastro[0].n, 0);
});

test("factura de barber que no encuentra su barbería → 500 (Stripe reintenta) y, cuando aparece, se registra", { skip }, async () => {
  const shop = await barberia();
  // La barbería todavía no tiene guardado su customer (ni la metadata cuadra): no se encuentra.
  const customer = shop.stripeCustomerId!;
  await prisma.barbershop.update({ where: { id: shop.id }, data: { stripeCustomerId: null } });
  const sub = suscripcion(`sub_${RUN}_huerfana`, "otra-barberia-inexistente", customer);
  const inv = factura(`in_${RUN}_huerfana`, sub);

  const errores: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errores.push(a);
  let r: { status: number; body: any };
  try {
    r = await enviar("invoice.paid", inv);
  } finally {
    console.error = original;
  }
  assert.equal(r.status, 500, "no puede contestar 200 en silencio");
  assert.match(JSON.stringify(errores), new RegExp(`in_${RUN}_huerfana`), "queda en el log con el id de la factura");
  assert.equal((await filas(shop.id)).length, 0);

  // Reintento de Stripe con la barbería ya encontrable: el cobro entra.
  await prisma.barbershop.update({ where: { id: shop.id }, data: { stripeCustomerId: customer } });
  const r2 = await enviar("invoice.paid", inv);
  assert.equal(r2.status, 200);
  assert.equal((await filas(shop.id)).length, 1);
});

test("suscripción ANUAL: se guarda el importe y el ciclo reales y el admin suma ÷ 12", { skip }, async () => {
  const shop = await barberia();
  const sub = suscripcion(`sub_${RUN}_anual`, shop.id, shop.stripeCustomerId!, {
    items: { data: [{ id: "si_a", quantity: 1, current_period_end: s("2027-11-14T16:00:00Z"), price: precio(749000, "year") }] },
  });
  await enviar("customer.subscription.created", sub);
  assert.deepEqual(await terminos(shop.id), { price_cents: 749000, billing_interval: "year", plan_id: "PROFESIONAL", stripe_status: "active" });

  const now = new Date();
  factura(`in_${RUN}_anual`, sub, {
    amount_paid: 749000,
    status_transitions: { paid_at: Math.floor(now.getTime() / 1000) - 60 },
    lines: {
      data: [{ amount: 749000, period: { start: Math.floor(now.getTime() / 1000) - 60, end: s("2099-01-01T00:00:00Z") }, price: precio(749000, "year") }],
    },
  });
  await enviar("invoice.paid", invoices.get(`in_${RUN}_anual`));

  const admin = await cargarCobrosAdmin(now);
  const r = admin!.porBarberia.get(shop.id)!;
  assert.equal(r.vigente, true);
  assert.equal(r.mensual?.toFixed(2), "624.17");
  assert.equal(r.interval, "year");
  assert.equal(r.cobradoMes.toFixed(2), "7490.00");
  assert.ok(Number(admin!.cobradoMes) >= 7490);
});

test("las sucursales heredan el estado; el cobro se guarda solo en la matriz", { skip }, async () => {
  const matriz = await barberia();
  const sede = await barberia({ parentId: matriz.id });
  const sub = suscripcion(`sub_${RUN}_fam`, matriz.id, matriz.stripeCustomerId!);
  await enviar("invoice.paid", factura(`in_${RUN}_fam`, sub));
  assert.equal((await filas(matriz.id)).length, 1);
  assert.equal((await filas(sede.id)).length, 0);
  const s2 = await prisma.barbershop.findUnique({ where: { id: sede.id }, select: { subscriptionStatus: true } });
  assert.equal(s2?.subscriptionStatus, "active");
});

test("sin sql/barber_cobros.sql pegado: nada truena, el cobro no se guarda y el registro es null", { skip }, async () => {
  const shop = await barberia();
  const sub = suscripcion(`sub_${RUN}_sintabla`, shop.id, shop.stripeCustomerId!);
  // El error REAL que da Postgres cuando la tabla no existe (42P01), sin
  // renombrar las tablas de verdad: otras suites corren a la vez contra esta
  // misma base y las verían desaparecer.
  const faltaTabla = await prisma.$queryRawUnsafe("SELECT 1 FROM barber_tabla_que_no_existe").catch((e: unknown) => e);
  assert.ok(faltaTabla instanceof Error);
  const raw = prisma as unknown as { $queryRaw: unknown; $executeRaw: unknown };
  const [q, x] = [raw.$queryRaw, raw.$executeRaw];
  const tocaCobros = (args: unknown[]) => /barber_subscription(_payments|s)\b/.test(JSON.stringify(args));
  raw.$queryRaw = (...args: unknown[]) => (tocaCobros(args) ? Promise.reject(faltaTabla) : (q as Function).apply(prisma, args));
  raw.$executeRaw = (...args: unknown[]) => (tocaCobros(args) ? Promise.reject(faltaTabla) : (x as Function).apply(prisma, args));
  try {
    const r = await enviar("invoice.paid", factura(`in_${RUN}_sintabla`, sub));
    assert.equal(r.status, 200);
    assert.match(r.body.action, /invoice:paid:sin-tabla/);
    // La activación sigue funcionando como hasta hoy.
    const fresh = await prisma.barbershop.findUnique({ where: { id: shop.id }, select: { subscriptionStatus: true } });
    assert.equal(fresh?.subscriptionStatus, "active");
    assert.equal(await leerRegistroBarber(shop.id), null);
    assert.equal(await cargarCobrosAdmin(), null);
    assert.equal(
      await guardarCobroBarber(shop.id, {
        invoiceId: randomUUID(), subscriptionId: null, status: "paid", amountCents: 1, currency: "mxn",
        planId: null, interval: null, periodStart: null, periodEnd: null, paidAt: null, failureCode: null,
      }),
      "sin-tabla",
    );
  } finally {
    raw.$queryRaw = q;
    raw.$executeRaw = x;
  }
  // Y de verdad no se guardó nada.
  assert.equal((await filas(shop.id)).length, 0);
});
