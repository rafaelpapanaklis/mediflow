// Lo que la barbería le paga a DaleControl (ws6-t1, ficha de /admin/barberias)
// contra Postgres LOCAL: lectura de cobros de la MATRIZ (también desde una
// sucursal), sin fugas entre barberías, y el recibo de Stripe solo para
// admins y solo de cobros de esa barbería. Stripe va doblado: ninguna
// llamada sale de la máquina.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/admin-pagos-integration.test.ts
//
// Necesita sql/barber_cobros.sql pegado en esa base local.
import { sesion } from "./_permisos-arnes";
import { skip } from "./_base-local";
import Module from "node:module";
import { createHash } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Cookie de admin encima del doble de next/headers del arnés, y Stripe doblado.
const admin: { token: string | null } = { token: null };
const pedidasAStripe: string[] = [];
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const cargaPrevia = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  const mod = cargaPrevia.call(this, request, parent, isMain);
  if (request === "@/lib/barber/billing" || request.endsWith("/lib/barber/billing")) {
    return {
      __esModule: true,
      ...(mod as object),
      getBarberStripe: () => ({
        invoices: {
          retrieve: async (id: string) => {
            pedidasAStripe.push(id);
            return { id, hosted_invoice_url: `https://pay.stripe.test/${id}`, invoice_pdf: null };
          },
        },
      }),
    };
  }
  if (request !== "next/headers") return mod;
  const base = mod as { cookies: () => Promise<{ get: (n: string) => unknown }> };
  return {
    ...base,
    cookies: async () => {
      const c = await base.cookies();
      return { ...c, get: (n: string) => (n === "admin_token" && admin.token ? { name: n, value: admin.token } : c.get(n)) };
    },
  };
};

const RUN = `apag${Date.now().toString(36)}`;
type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let lib: typeof import("@/lib/barber/admin-pagos");
let recibo: typeof import("@/app/api/admin/barberias/[id]/recibo/route");
const ids = { a: "", a2: "", b: "", adminUser: "" };
const TOKEN = `${RUN}-token-admin`;

async function pago(shop: string, inv: string, status: "paid" | "failed", cents: number, paidAt: string | null, periodEnd: string, failure: string | null = null) {
  await prisma.$executeRaw`
    INSERT INTO barber_subscription_payments
      (barbershop_id, stripe_invoice_id, status, amount_cents, currency, plan_id, billing_interval, period_start, period_end, paid_at, failure_code, created_at)
    VALUES (${shop}, ${inv}, ${status}, ${cents}, 'mxn', 'AVANZADO', 'month',
            ${new Date(new Date(periodEnd).getTime() - 30 * 86400000)}, ${new Date(periodEnd)},
            ${paidAt ? new Date(paidAt) : null}, ${failure}, ${paidAt ? new Date(paidAt) : new Date("2026-11-15T12:00:00Z")})`;
}

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  lib = await import("@/lib/barber/admin-pagos");
  recibo = await import("@/app/api/admin/barberias/[id]/recibo/route");

  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `Pagos ${slug}`, slug: `${RUN}-${slug}`, plan: "AVANZADO", subscriptionStatus: "active", timezone: "America/Merida", ...extra },
    });
  const a = await shop("a");
  const a2 = await shop("a2", { parentId: a.id, isMainBranch: false, branchName: "Norte" });
  const b = await shop("b");
  const au = await prisma.adminUser.create({ data: { email: `${RUN}@admin.test`, passwordHash: "x" } });
  await prisma.adminSession.create({
    data: { adminUserId: au.id, tokenHash: createHash("sha256").update(TOKEN).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  Object.assign(ids, { a: a.id, a2: a2.id, b: b.id, adminUser: au.id });

  // Matriz A: 2 pagados de $749, 1 rechazado; términos de Stripe vigentes.
  await pago(a.id, `in_${RUN}a1`, "paid", 74900, "2026-09-14T00:05:00Z", "2026-10-14T00:00:00Z");
  await pago(a.id, `in_${RUN}a2`, "paid", 74900, "2026-10-14T00:05:00Z", "2026-11-14T00:00:00Z");
  await pago(a.id, `in_${RUN}a3`, "failed", 74900, null, "2026-12-14T00:00:00Z", "card_declined");
  await prisma.$executeRaw`
    INSERT INTO barber_subscriptions (barbershop_id, stripe_subscription_id, stripe_status, price_cents, currency, billing_interval, plan_id, current_period_end)
    VALUES (${a.id}, ${`sub_${RUN}`}, 'past_due', 74900, 'mxn', 'month', 'AVANZADO', ${new Date("2026-12-14T00:00:00Z")})`;
  // Otra barbería: nada suyo puede aparecer en A.
  await pago(b.id, `in_${RUN}b1`, "paid", 199900, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
});

after(async () => {
  if (skip) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const sid = shops.map((s) => s.id);
  await prisma.$executeRaw`DELETE FROM barber_subscription_payments WHERE barbershop_id = ANY(${sid}::text[])`;
  await prisma.$executeRaw`DELETE FROM barber_subscriptions WHERE barbershop_id = ANY(${sid}::text[])`;
  await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  if (ids.adminUser) await prisma.adminUser.deleteMany({ where: { id: ids.adminUser } });
  await prisma.$disconnect();
});

async function getRecibo(id: string, factura: string) {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(`http://localhost/api/admin/barberias/${id}/recibo?factura=${encodeURIComponent(factura)}`);
  const res = await recibo.GET(req, { params: Promise.resolve({ id }) });
  return { status: res.status, location: res.headers.get("location") };
}

test("la matriz: total, pagados, rechazados, último pago, renovación y la lista (lo más reciente primero)", { skip }, async () => {
  const r = (await lib.cargarPagosBarberia(ids.a))!;
  assert.equal(r.disponible, true);
  assert.equal(r.esSucursal, false);
  assert.equal(r.pagaId, ids.a);
  assert.equal(r.totalCobrado, "1498.00");
  assert.equal(r.pagados, 2);
  assert.equal(r.fallidos, 1);
  assert.deepEqual(r.ultimoPago, { fecha: "2026-10-14T00:05:00.000Z", monto: "749.00" });
  assert.equal(r.proximaRenovacion, "2026-12-14T00:00:00.000Z");
  assert.equal(r.terminos?.estadoStripe, "past_due");
  assert.equal(r.terminos?.mensual, "749.00");
  assert.deepEqual(r.pagos.map((p) => [p.invoiceId, p.estado]), [
    [`in_${RUN}a3`, "failed"],
    [`in_${RUN}a2`, "paid"],
    [`in_${RUN}a1`, "paid"],
  ]);
  assert.equal(r.pagos[0].motivo, "card_declined");
  assert.ok(!JSON.stringify(r).includes(`in_${RUN}b1`), "nada de otra barbería");
});

test("desde la sucursal se ven los cobros de SU matriz (una sucursal no paga aparte)", { skip }, async () => {
  const r = (await lib.cargarPagosBarberia(ids.a2))!;
  assert.equal(r.esSucursal, true);
  assert.equal(r.pagaId, ids.a);
  assert.equal(r.pagados, 2);
  assert.equal(r.totalCobrado, "1498.00");
});

test("barbería sin cobros: $0 medido; barbería que no existe: null", { skip }, async () => {
  const sinCobros = await prisma.barbershop.create({
    data: { name: "Pagos c", slug: `${RUN}-c`, plan: "BASICO", subscriptionStatus: "active", timezone: "America/Merida" },
  });
  const r = (await lib.cargarPagosBarberia(sinCobros.id))!;
  assert.equal(r.disponible, true);
  assert.equal(r.totalCobrado, "0.00");
  assert.equal(r.pagados, 0);
  assert.equal(r.ultimoPago, null);
  assert.equal(r.terminos, null);
  assert.equal(r.proximaRenovacion, null);
  assert.equal(await lib.cargarPagosBarberia(`${RUN}-no-existe`), null);
});

test("recibo: sin sesión de admin → 401 (también con sesión de barbería) y no se le pregunta a Stripe", { skip }, async () => {
  admin.token = null;
  sesion.supabaseId = `${RUN}-dueno-cualquiera`;
  const r = await getRecibo(ids.a, `in_${RUN}a1`);
  assert.equal(r.status, 401);
  assert.deepEqual(pedidasAStripe, []);
  sesion.supabaseId = null;
});

test("recibo con admin: el de la barbería → redirige al de Stripe; el de OTRA → 404 sin llamar a Stripe", { skip }, async () => {
  admin.token = TOKEN;
  const ok = await getRecibo(ids.a, `in_${RUN}a2`);
  assert.equal(ok.status, 302);
  assert.equal(ok.location, `https://pay.stripe.test/in_${RUN}a2`);
  // Desde la sucursal, los de su matriz también.
  const deSucursal = await getRecibo(ids.a2, `in_${RUN}a1`);
  assert.equal(deSucursal.status, 302);
  const ajeno = await getRecibo(ids.a, `in_${RUN}b1`);
  assert.equal(ajeno.status, 404);
  const basura = await getRecibo(ids.a, "in_x' OR 1=1 --");
  assert.equal(basura.status, 404);
  assert.deepEqual(pedidasAStripe, [`in_${RUN}a2`, `in_${RUN}a1`]);
  admin.token = null;
});
