// REACTIVAR = PAGAR EL MISMO PLAN (o uno mayor): el SERVIDOR lo exige en
// checkout y en el cambio de plan, con las rutas REALES y Postgres local.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local (_base-local.ts).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/reactivar-integration.test.ts
//
// Dobles: la sesión de Supabase (por Module._load, antes de cargar las rutas)
// y Stripe (métodos del cliente propio de barber). Nada sale a la red.
import "./_sin-server-only";
import Module from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { skip } from "./_base-local";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_de_prueba_no_sale_a_la_red";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

/* ═══════════════ Sesión simulada ═══════════════ */

let sesion: string | null = null;
const SRC = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>([
  [
    path.join(SRC, "lib/supabase/server.ts"),
    {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: sesion ? { id: sesion, app_metadata: {} } : null } }) },
      }),
    },
  ],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  try {
    const resuelto = M._resolveFilename(request, parent, isMain);
    if (dobles.has(resuelto)) return dobles.get(resuelto);
  } catch {
    /* que lo resuelva el cargador normal */
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

/* ═══════════════ Stripe simulado ═══════════════ */

const subs = new Map<string, any>();
const checkouts: any[] = [];
const updates: any[] = [];

function precioPorLookup(key: string) {
  // dcbarber_<plan>_<interval>_<cents>
  const [, plan, interval, cents] = key.split("_");
  return {
    id: `price_${plan}_${interval}_${cents}`,
    active: true,
    currency: "mxn",
    unit_amount: Number(cents),
    recurring: { interval },
    metadata: { dc_vertical: "barber", dc_plan: plan, dc_interval: interval },
  };
}

/* ═══════════════ Rutas ═══════════════ */

let prisma: typeof import("@/lib/prisma")["prisma"];
let checkoutPOST: typeof import("@/app/api/barber/billing/checkout/route")["POST"];
let changePOST: typeof import("@/app/api/barber/billing/change-plan/route")["POST"];
let previewPOST: typeof import("@/app/api/barber/billing/change-plan/preview/route")["POST"];

const creadas: string[] = [];
const RUN = `rea${Date.now().toString(36)}`;
let seq = 0;

/** Barbería PROFESIONAL con dueño logueado, en el estado pedido. */
async function barberia(status: string, opts: { cobroVencido?: boolean; sinStripe?: boolean } = {}) {
  const n = ++seq;
  const subId = opts.sinStripe ? null : `sub_${RUN}_${n}`;
  const shop = await prisma.barbershop.create({
    data: {
      name: `Reactivar ${n}`,
      slug: `${RUN}-${n}`,
      plan: "PROFESIONAL" as never,
      subscriptionStatus: status,
      stripeCustomerId: `cus_${RUN}_${n}`,
      stripeSubscriptionId: subId,
    },
  });
  creadas.push(shop.id);
  const supabaseId = `sb-${RUN}-${n}`;
  await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId, email: `d${n}@${RUN}.local`, firstName: "Dueño", lastName: "Prueba", role: "OWNER" },
  });
  if (opts.cobroVencido) {
    const fin = new Date(Date.now() - 3 * 86400_000);
    await prisma.$executeRawUnsafe(
      `INSERT INTO barber_subscription_payments (id, barbershop_id, stripe_invoice_id, status, amount_cents, period_start, period_end, paid_at)
       VALUES ($1, $2, $3, 'paid', 74900, $4, $5, $4)`,
      randomUUID(), shop.id, `in_${randomUUID()}`, new Date(fin.getTime() - 30 * 86400_000), fin,
    );
  }
  if (subId) {
    subs.set(subId, {
      id: subId,
      status: status === "active" ? "active" : status === "past_due" ? "past_due" : "canceled",
      customer: shop.stripeCustomerId,
      metadata: { dc_vertical: "barber", dc_kind: "barber-subscription", barbershopId: shop.id, dc_plan: "PROFESIONAL" },
      items: {
        data: [{ id: `si_${n}`, quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 86400, price: precioPorLookup(`dcbarber_PROFESIONAL_month_74900`) }],
      },
    });
  }
  sesion = supabaseId;
  return shop;
}

const pedir = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

before(async () => {
  if (skip) return;
  ({ prisma } = await import("@/lib/prisma"));
  ({ POST: checkoutPOST } = await import("@/app/api/barber/billing/checkout/route"));
  ({ POST: changePOST } = await import("@/app/api/barber/billing/change-plan/route"));
  ({ POST: previewPOST } = await import("@/app/api/barber/billing/change-plan/preview/route"));
  const { getBarberStripe } = await import("@/lib/barber/billing");
  const stripe = getBarberStripe() as any;
  stripe.subscriptions.retrieve = async (id: string) => {
    const sub = subs.get(id);
    if (!sub) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    return sub;
  };
  stripe.subscriptions.update = async (id: string, params: any) => {
    updates.push({ id, params });
    const sub = subs.get(id);
    const price = precioPorLookup(params.items[0].price.replace(/^price_/, "dcbarber_"));
    return { ...sub, metadata: params.metadata, items: { data: [{ ...sub.items.data[0], price }] } };
  };
  stripe.prices.retrieve = async () => {
    throw new Error("sin id guardado");
  };
  stripe.prices.list = async ({ lookup_keys }: any) => ({ data: [precioPorLookup(lookup_keys[0])] });
  stripe.checkout.sessions.create = async (params: any) => {
    checkouts.push(params);
    return { id: `cs_${checkouts.length}`, url: `https://checkout.stripe.test/${checkouts.length}` };
  };
});

after(async () => {
  if (skip) return;
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas } } });
  await prisma.$disconnect();
});

test("suspendida (canceló): contratar un plan MENOR → 409 REACTIVATE_SAME_PLAN, sin tocar Stripe", { skip }, async () => {
  await barberia("canceled");
  const antes = checkouts.length;
  const res = await checkoutPOST(pedir("/api/barber/billing/checkout", { plan: "BASICO", interval: "month" }));
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, "REACTIVATE_SAME_PLAN");
  assert.equal(body.requiredPlan, "PROFESIONAL");
  assert.match(body.error, /suspendida/);
  assert.equal(checkouts.length, antes, "no se abrió ningún checkout");
});

test("suspendida: SU plan (o uno mayor) sí abre el checkout", { skip }, async () => {
  await barberia("canceled", { cobroVencido: true });
  const res = await checkoutPOST(pedir("/api/barber/billing/checkout", { plan: "PROFESIONAL", interval: "month" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.url, /^https:\/\/checkout\.stripe\.test\//);
  const last = checkouts[checkouts.length - 1];
  assert.match(last.line_items[0].price, /^price_PROFESIONAL_month_\d+$/);
  // Una reactivación no es «primera contratación»: sin cupón del primer mes.
  assert.equal(last.discounts, undefined);
});

test("vencida por fecha (Stripe aún «active» en la fila): bajar de plan → 409, en el cambio y en la simulación", { skip }, async () => {
  // El corte por fecha todavía no la tocó (nadie entró ni pasó el cron):
  // el servidor igual la ve vencida por su registro de cobros.
  await barberia("active", { cobroVencido: true });
  for (const [ruta, fn] of [
    ["/api/barber/billing/change-plan", changePOST],
    ["/api/barber/billing/change-plan/preview", previewPOST],
  ] as const) {
    const res = await fn(pedir(ruta, { plan: "AVANZADO" }));
    const body = await res.json();
    assert.equal(res.status, 409, ruta);
    assert.equal(body.code, "REACTIVATE_SAME_PLAN", ruta);
  }
  assert.equal(updates.length, 0, "Stripe no recibió ningún cambio");
});

test("past_due: bajar de plan → 409; la misma barbería al corriente baja como hoy", { skip }, async () => {
  const shop = await barberia("past_due", { cobroVencido: true });
  const bloqueado = await changePOST(pedir("/api/barber/billing/change-plan", { plan: "BASICO" }));
  assert.equal(bloqueado.status, 409);
  assert.equal((await bloqueado.json()).code, "REACTIVATE_SAME_PLAN");

  // Al corriente (pagó: su periodo nuevo ya está registrado) → el downgrade pasa.
  await prisma.barbershop.update({ where: { id: shop.id }, data: { subscriptionStatus: "active" } });
  subs.get(shop.stripeSubscriptionId!)!.status = "active";
  await prisma.$executeRawUnsafe(
    `INSERT INTO barber_subscription_payments (id, barbershop_id, stripe_invoice_id, status, amount_cents, period_end, paid_at)
     VALUES ($1, $2, $3, 'paid', 74900, $4, now())`,
    randomUUID(), shop.id, `in_${randomUUID()}`, new Date(Date.now() + 20 * 86400_000),
  );
  const ok = await changePOST(pedir("/api/barber/billing/change-plan", { plan: "BASICO" }));
  const body = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(body));
  assert.equal(body.direction, "downgrade");
  assert.equal(updates.at(-1)?.params.proration_behavior, "create_prorations");
});

test("alta nueva que nunca pagó: elige el plan que quiera", { skip }, async () => {
  await barberia("pending_payment", { sinStripe: true });
  const res = await checkoutPOST(pedir("/api/barber/billing/checkout", { plan: "BASICO", interval: "month" }));
  assert.equal(res.status, 200);
});
