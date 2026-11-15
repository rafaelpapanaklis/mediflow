// SIN DÍAS DE GRACIA, de punta a punta contra Postgres local con
// sql/barber_cobros.sql: el candado del panel al entrar, el corte del cron de
// barber (/api/barber/whatsapp/dispatch), la reserva pública apagada, el
// webhook que no reabre y el pago que sí reabre. Nada se borra.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local (_base-local.ts).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/suspension-integration.test.ts
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { skip } from "./_base-local";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_de_prueba_no_sale_a_la_red";
process.env.BARBER_STRIPE_WEBHOOK_SECRET = "whsec_de_prueba";
process.env.CRON_SECRET = "cron-de-prueba";

let prisma: typeof import("@/lib/prisma")["prisma"];
let hasBarberPaidAccess: typeof import("@/lib/barber/paid-access")["hasBarberPaidAccess"];
let resolveBookingGate: typeof import("@/lib/barber/booking")["resolveBookingGate"];
let cronGET: typeof import("@/app/api/barber/whatsapp/dispatch/route")["GET"];
let webhookPOST: typeof import("@/app/api/barber/stripe/webhook/route")["POST"];
let marcarReactivacionManualBarber: typeof import("@/lib/barber/cobros")["marcarReactivacionManualBarber"];

const subs = new Map<string, any>();
const DIA = 24 * 3600 * 1000;

const creadas: string[] = [];
const RUN = `sus${Date.now().toString(36)}`;
let seq = 0;

async function familia(status = "active") {
  const n = ++seq;
  const matriz = await prisma.barbershop.create({
    data: {
      name: `Corte ${n}`,
      slug: `${RUN}-${n}`,
      plan: "PROFESIONAL" as never,
      subscriptionStatus: status,
      stripeCustomerId: `cus_${RUN}_${n}`,
      stripeSubscriptionId: `sub_${RUN}_${n}`,
    },
  });
  const sede = await prisma.barbershop.create({
    data: {
      name: `Corte ${n} Norte`,
      slug: `${RUN}-${n}-norte`,
      plan: "PROFESIONAL" as never,
      subscriptionStatus: status,
      parentId: matriz.id,
    },
  });
  creadas.push(sede.id, matriz.id);
  return { matriz, sede };
}

/** Un cobro pagado cuyo periodo termina en `periodEnd`. */
async function cobro(shopId: string, periodEnd: Date, paidAt = new Date(periodEnd.getTime() - 30 * DIA)) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO barber_subscription_payments
       (id, barbershop_id, stripe_invoice_id, status, amount_cents, currency, period_start, period_end, paid_at)
     VALUES ($1, $2, $3, 'paid', 74900, 'mxn', $4, $5, $6)`,
    randomUUID(),
    shopId,
    `in_${randomUUID()}`,
    new Date(periodEnd.getTime() - 30 * DIA),
    periodEnd,
    paidAt,
  );
}

async function estados(...ids: string[]) {
  const rows = await prisma.barbershop.findMany({ where: { id: { in: ids } }, select: { id: true, subscriptionStatus: true } });
  return ids.map((id) => rows.find((r) => r.id === id)?.subscriptionStatus);
}

function ctxDe(shop: { id: string; parentId: string | null; subscriptionStatus: string }) {
  return {
    barbershopId: shop.id,
    barbershop: { ...shop, isActive: true },
  } as any;
}

/** El periodo pagado terminó AYER (México) → hoy ya no es su día. */
const ayer = () => new Date(Date.now() - 1.5 * DIA);
/** Termina dentro de una semana. */
const proxima = () => new Date(Date.now() + 7 * DIA);

before(async () => {
  if (skip) return;
  ({ prisma } = await import("@/lib/prisma"));
  ({ hasBarberPaidAccess } = await import("@/lib/barber/paid-access"));
  ({ resolveBookingGate } = await import("@/lib/barber/booking"));
  ({ GET: cronGET } = await import("@/app/api/barber/whatsapp/dispatch/route"));
  ({ POST: webhookPOST } = await import("@/app/api/barber/stripe/webhook/route"));
  ({ marcarReactivacionManualBarber } = await import("@/lib/barber/cobros"));
  const { getBarberStripe } = await import("@/lib/barber/billing");
  const stripe = getBarberStripe() as any;
  stripe.webhooks.constructEvent = (raw: string) => JSON.parse(raw);
  stripe.subscriptions.retrieve = async (id: string) => subs.get(id);
  stripe.invoices.retrieve = async () => {
    throw new Error("sin factura viva: se usa el payload");
  };
});

after(async () => {
  if (skip) return;
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas }, parentId: { not: null } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas } } });
  await prisma.$disconnect();
});

test("al entrar: periodo pagado vencido → panel cerrado y la familia queda past_due (lo público también)", { skip }, async () => {
  const { matriz, sede } = await familia();
  await cobro(matriz.id, ayer());

  // Entra alguien de la SUCURSAL: el candado mira la matriz.
  assert.equal(await hasBarberPaidAccess(ctxDe(sede)), false);
  assert.deepEqual(await estados(matriz.id, sede.id), ["past_due", "past_due"]);
  // La reserva pública ya la ve cerrada, sin esperar al cron.
  const gate = await resolveBookingGate(matriz.slug);
  assert.deepEqual(gate, { ok: false, reason: "inactive" });
  // Nada se borró.
  assert.equal(await prisma.barbershop.count({ where: { id: { in: [matriz.id, sede.id] } } }), 2);
});

test("al entrar: dentro del periodo pagado (o su último día) sigue abierta", { skip }, async () => {
  const { matriz, sede } = await familia();
  await cobro(matriz.id, proxima());
  assert.equal(await hasBarberPaidAccess(ctxDe(matriz)), true);
  // Termina HOY (hace un minuto): hoy todavía es su día.
  const { matriz: m2 } = await familia();
  await cobro(m2.id, new Date(Date.now() - 60 * 1000));
  const hoyMx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const haceUnMinMx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.now() - 60 * 1000));
  if (hoyMx === haceUnMinMx) assert.equal(await hasBarberPaidAccess(ctxDe(m2)), true);
  assert.deepEqual(await estados(matriz.id, sede.id, m2.id), ["active", "active", "active"]);
});

test("cortesía (sin cobros) y reactivada a mano: el corte no las toca", { skip }, async () => {
  const { matriz: cortesia } = await familia();
  assert.equal(await hasBarberPaidAccess(ctxDe(cortesia)), true);

  const { matriz: manual } = await familia();
  await cobro(manual.id, ayer());
  await marcarReactivacionManualBarber(manual.id);
  assert.equal(await hasBarberPaidAccess(ctxDe(manual)), true);
  assert.deepEqual(await estados(cortesia.id, manual.id), ["active", "active"]);
});

test("el cron de barber corta TODAS las vencidas (y solo esas) antes de despachar", { skip }, async () => {
  const vencida = await familia();
  await cobro(vencida.matriz.id, ayer());
  const vigente = await familia();
  await cobro(vigente.matriz.id, proxima());
  const yaCancelada = await familia("canceled");
  await cobro(yaCancelada.matriz.id, ayer());

  const sinPermiso = await cronGET(new Request("http://localhost/api/barber/whatsapp/dispatch"));
  assert.equal(sinPermiso.status, 401);
  assert.deepEqual(await estados(vencida.matriz.id), ["active"]);

  const res = await cronGET(
    new Request("http://localhost/api/barber/whatsapp/dispatch", { headers: { authorization: "Bearer cron-de-prueba" } }),
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.suspendidas >= 1);
  assert.deepEqual(await estados(vencida.matriz.id, vencida.sede.id), ["past_due", "past_due"]);
  assert.deepEqual(await estados(vigente.matriz.id, vigente.sede.id), ["active", "active"]);
  assert.deepEqual(await estados(yaCancelada.matriz.id), ["canceled"]);

  // Idempotente: la segunda pasada no cambia nada más.
  const otra = await cronGET(
    new Request("http://localhost/api/barber/whatsapp/dispatch", { headers: { authorization: "Bearer cron-de-prueba" } }),
  );
  assert.equal((await otra.json()).suspendidas, 0);
});

async function evento(type: string, object: any) {
  const res = await webhookPOST(
    new NextRequest("http://localhost/api/barber/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=x" },
      body: JSON.stringify({ id: `evt_${randomUUID()}`, type, data: { object } }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

test("Stripe todavía dice «active» con el periodo vencido: no reabre; el PAGO sí", { skip }, async () => {
  const { matriz, sede } = await familia();
  await cobro(matriz.id, ayer());
  const sub = {
    id: matriz.stripeSubscriptionId,
    status: "active",
    customer: matriz.stripeCustomerId,
    metadata: { dc_vertical: "barber", dc_kind: "barber-subscription", barbershopId: matriz.id },
    items: { data: [{ id: "si_1", price: { unit_amount: 74900, currency: "mxn", recurring: { interval: "month" }, metadata: { dc_vertical: "barber", dc_plan: "PROFESIONAL" } } }] },
  };
  subs.set(sub.id!, sub);

  await evento("customer.subscription.updated", sub);
  assert.deepEqual(await estados(matriz.id, sede.id), ["past_due", "past_due"]);

  // Paga la factura del periodo nuevo (la misma suscripción, el mismo plan).
  const ahora = Math.floor(Date.now() / 1000);
  const r = await evento("invoice.paid", {
    id: `in_${randomUUID()}`,
    status: "paid",
    customer: matriz.stripeCustomerId,
    subscription: sub.id,
    subscription_details: { metadata: sub.metadata },
    amount_paid: 74900,
    currency: "mxn",
    status_transitions: { paid_at: ahora },
    lines: { data: [{ amount: 74900, period: { start: ahora - 3600, end: ahora + 30 * 86400 }, price: sub.items.data[0].price }] },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await estados(matriz.id, sede.id), ["active", "active"]);
  assert.equal(await hasBarberPaidAccess(ctxDe({ ...matriz, subscriptionStatus: "active" })), true);
});
