// Cobros del cliente desde su ficha (ws6-t5, 15-nov-2026).
//
//   1. Historial de cobros: los tickets de Caja del cliente, con total pagado
//      y visitas cobradas; el Barbero solo ve lo que cobró él; sin cash.view
//      no hay importes.
//   2. Nuevo cobro desde la ficha = createSale (mismo motor); descuento en %
//      además de en $, con la misma validación.
//   3. «Por cobrar»: la nota se guarda sin tocar corte, ingresos, comisiones
//      ni estrellas; al cobrarla se vuelve un ticket normal, una sola vez.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/cobros-cliente-integration.test.ts
//
// La integración corre solo contra una base LOCAL (crea y borra barberías).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
let session: BarberContext | null = null;

const DOUBLES = new Map<string, unknown>([
  [
    abs("src/lib/barber-auth.ts"),
    {
      __esModule: true,
      getBarberContext: async () => session,
      assertBarberPermission: (ctx: Pick<BarberContext, "role" | "user">, key: Parameters<typeof hasBarberPermission>[1]) => {
        if (!hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, key)) {
          throw new BarberForbiddenError(key);
        }
      },
      getAccessibleBranchIds: async (ctx: BarberContext) => [ctx.barbershopId],
      BarberForbiddenError,
      hasBarberPermission,
    },
  ],
  [abs("src/lib/barber/plans.ts"), { __esModule: true, getBarberPlan: async () => ({ id: "PROFESIONAL", name: "Profesional", features: FEATURES }) }],
]);

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  try {
    const resolved = M._resolveFilename(request, parent);
    if (DOUBLES.has(resolved)) return DOUBLES.get(resolved);
  } catch {
    /* que lo resuelva el cargador original */
  }
  return originalLoad.call(this, request, parent, isMain);
};

let prisma: typeof import("@/lib/prisma")["prisma"];
let cash: typeof import("@/lib/barber/cash");
let caja: typeof import("@/lib/barber/commissions");
let sales: typeof import("@/lib/barber/client-sales");

const RUN = `c${Date.now().toString(36)}`;
let seq = 0;

interface Shop {
  id: string;
  slug: string;
  ctx: BarberContext;
  barberId: string;
  otherBarberId: string;
  serviceId: string;
  productId: string;
}
let A: Shop;
let B: Shop;

async function makeShop(tag: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: { name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${tag}-owner`, email: `${RUN}-${tag}@test.local`, firstName: "Dueña", lastName: tag, role: "OWNER" },
  });
  const barber = await prisma.barber.create({
    data: { barbershopId: shop.id, name: `Beto ${tag}`, commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) },
  });
  const other = await prisma.barber.create({
    data: { barbershopId: shop.id, name: `Otro ${tag}`, commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) },
  });
  const service = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) },
  });
  const product = await prisma.barberProduct.create({
    data: { barbershopId: shop.id, name: "Cera", price: new Prisma.Decimal(150), stock: 20 },
  });
  return {
    id: shop.id,
    slug: shop.slug,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    barberId: barber.id,
    otherBarberId: other.id,
    serviceId: service.id,
    productId: product.id,
  };
}

async function staff(shop: Shop, role: "RECEPTION" | "BARBER", opts: { barberId?: string; override?: string[] } = {}): Promise<BarberContext> {
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id, supabaseId: `${RUN}-${role}-${seq++}`, email: `${RUN}-${role}-${seq}@test.local`,
      firstName: role === "RECEPTION" ? "Rita" : "Beto", lastName: "Staff", role, barberId: opts.barberId ?? null,
      permissionsOverride: opts.override ?? [],
    },
  });
  const barber = opts.barberId ? await prisma.barber.findUnique({ where: { id: opts.barberId } }) : null;
  return { barberUserId: user.id, barbershopId: shop.id, barbershop: shop.ctx.barbershop, user, barber, role };
}

async function newClient(shop: Shop, name: string): Promise<string> {
  const phone = `56${(Date.now() % 1e6).toString().padStart(6, "0")}${(seq++ % 100).toString().padStart(2, "0")}`;
  return (await prisma.barberClient.create({ data: { barbershopId: shop.id, name: `${name} ${RUN}`, phone } })).id;
}

const charge = (shop: Shop, clientId: string, extra: Record<string, unknown> = {}, ctx: BarberContext = shop.ctx) =>
  cash.createSale(ctx, { barberId: shop.barberId, clientId, items: [{ kind: "service", id: shop.serviceId }], paymentMethod: "CASH", ...extra }, FEATURES);

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  caja = await import("@/lib/barber/commissions");
  sales = await import("@/lib/barber/client-sales");
  A = await makeShop("A");
  B = await makeShop("B");
  await cash.openCashSession(A.ctx, { openingAmount: 0 });
  await cash.openCashSession(B.ctx, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "barber_sale_drafts" WHERE "barbershopId" = ANY($1::text[])`, ids);
  } catch {
    /* sin la tabla de notas por cobrar */
  }
  await prisma.barberStockMovement.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: { in: ids } } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ── 1. Historial de cobros ─────────────────────────────────────────────

test("1 · los cobros del cliente: cada ticket, total pagado, visitas cobradas y el cancelado con lo que llevaba", { skip }, async () => {
  const ana = await newClient(A, "Ana");
  await charge(A, ana, { tip: 30 }); // 200 + 30
  await charge(A, ana, { items: [{ kind: "service", id: A.serviceId }, { kind: "product", id: A.productId, qty: 2 }], discount: 50, paymentMethod: "CARD" }); // 200+300-50 = 450
  await charge(A, ana, { items: [{ kind: "product", id: A.productId }] }); // 150, sin servicio
  const anulado = await charge(A, ana);
  await cash.cancelSale(A.ctx, anulado.id, { reason: "se equivocó" });
  await charge(B, await newClient(B, "Ana")); // otra barbería: no cuenta

  const page = await sales.listClientSales(A.ctx, ana);
  assert.equal(page.allowed, true);
  assert.equal(page.count, 4);
  assert.equal(page.summary.spent, 230 + 450 + 150, "solo pagados, con propina");
  assert.equal(page.summary.chargedVisits, 2, "dos tickets con servicio (el de solo producto no es visita)");
  assert.equal(page.summary.paidTickets, 3);

  const [last, , mixto] = page.rows;
  assert.equal(last.status, "cancelled");
  assert.equal(last.cancelledSummary, "Corte");
  assert.equal(mixto.discount, 50);
  assert.equal(mixto.paymentMethod, "CARD");
  assert.deepEqual(mixto.lines.map((l) => [l.kind, l.qty]), [["service", 1], ["product", 2], ["discount", 1]]);
  assert.equal(mixto.barberName, "Beto A");
  assert.equal(mixto.soldByName, "Dueña A");

  // Otra barbería no ve nada de Ana.
  assert.equal((await sales.listClientSales(B.ctx, ana)).allowed, false);
});

test("1 · paginado de 20 en 20", { skip }, async () => {
  const leo = await newClient(A, "Leo");
  for (let i = 0; i < 23; i++) await charge(A, leo);
  const p1 = await sales.listClientSales(A.ctx, leo);
  const p2 = await sales.listClientSales(A.ctx, leo, { page: 2 });
  assert.equal(p1.rows.length, 20);
  assert.equal(p2.rows.length, 3);
  assert.equal(p1.summary.paidTickets, 23, "el resumen es de todo, no de la página");
  assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size, 23);
});

test("4 · permisos de los cobros: Recepción ve; el Barbero solo lo que cobró él; sin cash.view, nada", { skip }, async () => {
  const eva = await newClient(A, "Eva");
  await charge(A, eva); // con Beto
  await charge(A, eva, { barberId: A.otherBarberId }); // con Otro
  const rita = await staff(A, "RECEPTION");
  assert.equal((await sales.listClientSales(rita, eva)).count, 2);

  const beto = await staff(A, "BARBER", { barberId: A.barberId });
  const suya = await sales.listClientSales(beto, eva);
  assert.equal(suya.allowed, true);
  assert.equal(suya.scope, "own");
  assert.equal(suya.count, 1, "solo el ticket que cobró él");
  assert.equal(suya.summary.spent, 200);

  const ajeno = await newClient(A, "Ajeno");
  await charge(A, ajeno, { barberId: A.otherBarberId });
  assert.equal((await sales.listClientSales(beto, ajeno)).allowed, false, "un cliente que no es suyo: nada");

  const soloClientes = await staff(A, "RECEPTION", { override: ["clients.view"] });
  assert.equal((await sales.listClientSales(soloClientes, eva)).allowed, false, "ver clientes no basta para ver importes");
});

test("1 · la clasificación de líneas: servicio gratis por bono, bono, anticipo, descuento", () => {
  // Pura: no necesita base, pero el módulo es server-only; se carga con el doble.
  return (async () => {
    const mod = await import("@/lib/barber/client-sales");
    assert.deepEqual(mod.classifySaleLine({ description: "Corte · Gratis (lealtad)", unitPrice: 0, serviceId: "s", productId: null }), { kind: "service", free: true });
    assert.deepEqual(mod.classifySaleLine({ description: "Bono: $50 · Descuento (lealtad · 4 estrellas)", unitPrice: -50, serviceId: null, productId: null }), { kind: "bonus", free: false });
    assert.deepEqual(mod.classifySaleLine({ description: "Descuento", unitPrice: -20, serviceId: null, productId: null }), { kind: "discount", free: false });
    assert.deepEqual(mod.classifySaleLine({ description: "Cera", unitPrice: 150, serviceId: null, productId: "p" }), { kind: "product", free: false });
  })();
});

