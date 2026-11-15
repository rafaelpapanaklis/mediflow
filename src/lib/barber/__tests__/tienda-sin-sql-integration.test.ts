// TIENDA ANTES DE PEGAR sql/barber_tienda.sql (ws6-t1): la pantalla sigue
// como hoy. Corre contra una base local SIN ese SQL; si la base ya lo tiene,
// se salta (la otra suite, tienda-integration, cubre el «después»).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/<base sin el SQL> DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/tienda-sin-sql-integration.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BASE_LOCAL as HAS_DB } from "./_base-local";

const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

let prisma: typeof import("@/lib/prisma")["prisma"];
let tienda: typeof import("@/lib/barber/tienda");
let cash: typeof import("@/lib/barber/cash");
let sinSql = false;
const RUN = `ts${Date.now().toString(36)}`;
let ctx: BarberContext;
let slug = "";
let productId = "";

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  tienda = await import("@/lib/barber/tienda");
  cash = await import("@/lib/barber/cash");
  const core = await import("@/lib/barber/tienda-core");
  const ready = await core.tiendaReady(prisma);
  sinSql = !ready.columns && !ready.orders;
  if (!sinSql) return;
  const shop = await prisma.barbershop.create({
    data: { name: "Sin SQL", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  slug = shop.slug;
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "D", lastName: "A", role: "OWNER" },
  });
  ctx = { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" };
  productId = (await prisma.barberProduct.create({ data: { barbershopId: shop.id, name: "Cera", price: new Prisma.Decimal(150), stock: 4 } })).id;
});

after(async () => {
  if (!HAS_DB || !sinSql) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  await prisma.barberStockMovement.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("sin el SQL: Productos y Caja siguen igual, la tienda no aparece y nada truena", async (t) => {
  if (!HAS_DB) return t.skip("sin base local");
  if (!sinSql) return t.skip("esta base ya tiene sql/barber_tienda.sql");
  const load = await tienda.loadProductExtras(ctx.barbershopId);
  assert.deepEqual(load, { ready: false, ordersReady: false, extras: {}, reserved: {} });
  assert.equal(tienda.isTiendaGateOk(await tienda.resolveTienda(slug)), false, "sin columnas no hay tienda pública");
  assert.deepEqual(await tienda.loadFeaturedProducts({ id: ctx.barbershopId, plan: "PROFESIONAL" }), [], "sin sección en la página");
  assert.deepEqual(await tienda.listProductOrders(ctx), { ready: false, orders: [], newCount: 0 });
  assert.equal(await tienda.countNewProductOrders(ctx.barbershopId), 0);
  await assert.rejects(tienda.saveProductExtras(ctx, productId, { showOnWeb: true }), (e: unknown) => (e as { code?: string }).code === "TIENDA_SQL_PENDING");

  // Caja: vender y cancelar un producto como siempre.
  const features = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
  await cash.openCashSession(ctx, { openingAmount: 0 });
  const sale = await cash.createSale(ctx, { items: [{ kind: "product", id: productId, qty: 1 }], paymentMethod: "CASH" }, features);
  await cash.cancelSale(ctx, sale.id, { reason: "prueba" });
  await assert.rejects(
    cash.createSale(ctx, { productOrderId: "x", items: [{ kind: "product", id: productId, qty: 1 }], paymentMethod: "CASH" }, features),
    (e: unknown) => (e as { code?: string }).code === "ORDERS_SQL_PENDING",
  );
});
