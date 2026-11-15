// TIENDA DE PRODUCTOS (ws6-t1, 15-nov-2026) contra Postgres REAL.
//
//   1. La tienda pública: qué se muestra, cuánto queda para apartar y su
//      etiqueta (Disponible / Pocas / Agotado).
//   2. Apartar: precio congelado, nunca más de lo que hay, dos personas por la
//      última pieza (gana una), tope por teléfono, nada de otra barbería, y el
//      inventario real NO baja.
//   3. Vence a las 72 h y libera; lo pagado en línea no vence.
//   4. Entregar y cobrar = createSale de Caja: precio congelado, una sola vez,
//      piezas exactas; pagado en línea → «Pago en línea» (fuera del efectivo
//      del turno), tal cual, sin cobrar dos veces. Cancelar el ticket reabre.
//   5. Panel: listo, cancelar (pagado ⇒ confirmar reembolso), permisos de
//      Recepción y Barbero, aislamiento entre barberías.
//
// Necesita sql/barber_caja.sql y sql/barber_tienda.sql cargados:
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/tienda-integration.test.ts
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

let portalCookie: string | null = null;
const DOUBLES = new Map<string, unknown>([
  [
    abs("src/lib/barber-auth.ts"),
    {
      __esModule: true,
      getBarberContext: async () => null,
      assertBarberPermission: (ctx: Pick<BarberContext, "role" | "user">, key: Parameters<typeof hasBarberPermission>[1]) => {
        if (!hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, key)) {
          throw new BarberForbiddenError(key);
        }
      },
      hasBarberPermission: (u: Parameters<typeof hasBarberPermission>[0], k: Parameters<typeof hasBarberPermission>[1]) => hasBarberPermission(u, k),
      getAccessibleBranchIds: async (ctx: BarberContext) => [ctx.barbershopId],
      BarberForbiddenError,
    },
  ],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  // La cookie de «mi cuenta»: la ruta pública la lee con next/headers.
  if (request === "next/headers") {
    return {
      cookies: async () => ({ get: (n: string) => (n === "dcb_portal" && portalCookie ? { value: portalCookie } : undefined) }),
      headers: async () => new Headers(),
    };
  }
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
let tienda: typeof import("@/lib/barber/tienda");
let core: typeof import("@/lib/barber/tienda-core");
let caja: typeof import("@/lib/barber/commissions");

const RUN = `ti${Date.now().toString(36)}`;
let seq = 0;

interface Shop {
  id: string;
  slug: string;
  ctx: BarberContext;
  serviceId: string;
  cera: string; // se muestra y se aparta · stock 3 · mínimo 1
  shampoo: string; // se muestra, NO se aparta
  oculto: string; // no se muestra
  aceite: string; // se muestra y se aparta · stock 20
}
let A: Shop;
let B: Shop;

async function setExtras(id: string, showOnWeb: boolean, onlineOrder: boolean, extra: { photoUrl?: string; category?: string } = {}) {
  await prisma.$executeRaw`
    UPDATE "barber_products" SET "showOnWeb" = ${showOnWeb}, "onlineOrder" = ${onlineOrder},
      "photoUrl" = ${extra.photoUrl ?? null}, "category" = ${extra.category ?? null}
    WHERE "id" = ${id}`;
}

async function makeShop(tag: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: { name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${tag}-owner`, email: `${RUN}-${tag}@test.local`, firstName: "Dueña", lastName: tag, role: "OWNER" },
  });
  const service = await prisma.barberService.create({ data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) } });
  const mk = (name: string, price: number, stock: number, minStock: number | null = null) =>
    prisma.barberProduct.create({ data: { barbershopId: shop.id, name, price: new Prisma.Decimal(price), stock, minStock } });
  const cera = await mk("Cera", 150, 3, 1);
  const shampoo = await mk("Shampoo", 200, 5);
  const oculto = await mk("Oculto", 99, 5);
  const aceite = await mk("Aceite", 120.5, 20);
  await setExtras(cera.id, true, true, { photoUrl: "https://ejemplo.test/cera.webp", category: "Peinado" });
  await setExtras(shampoo.id, true, false, { category: "Cabello" });
  await setExtras(oculto.id, false, true);
  await setExtras(aceite.id, true, true, { category: "Barba" });
  return {
    id: shop.id,
    slug: shop.slug,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    serviceId: service.id,
    cera: cera.id,
    shampoo: shampoo.id,
    oculto: oculto.id,
    aceite: aceite.id,
  };
}

async function staff(shop: Shop, role: "RECEPTION" | "BARBER"): Promise<BarberContext> {
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id, supabaseId: `${RUN}-${role}-${seq++}`, email: `${RUN}-${role}-${seq}@test.local`,
      firstName: role === "RECEPTION" ? "Rita" : "Beto", lastName: "Staff", role,
    },
  });
  return { barberUserId: user.id, barbershopId: shop.id, barbershop: shop.ctx.barbershop, user, barber: null, role };
}

let phoneSeq = 0;
const newPhone = () => `55${(Date.now() % 1e6).toString().padStart(6, "0")}${(phoneSeq++ % 100).toString().padStart(2, "0")}`;

async function gateOf(shop: Shop) {
  const g = await tienda.resolveTienda(shop.slug);
  assert.ok(tienda.isTiendaGateOk(g), "la tienda existe");
  return g as import("@/lib/barber/tienda").TiendaGateOk;
}

const order = async (shop: Shop, lines: Array<{ productId: string; qty: number }>, phone = newPhone()) =>
  tienda.createTiendaOrder({ gate: await gateOf(shop), lines, name: "Ana López", phone, portalClient: null });

const stockOf = async (id: string) => (await prisma.barberProduct.findUniqueOrThrow({ where: { id } })).stock;
const statusOf = async (id: string) =>
  (await prisma.$queryRaw<Array<{ status: string; sale_id: string | null }>>`SELECT "status", "sale_id" FROM "barber_product_orders" WHERE "id" = ${id}`)[0];

/** Lo que haría el webhook de ws6-t5: pagado en línea, una vez. */
async function payOnline(orderId: string) {
  await prisma.$executeRaw`
    UPDATE "barber_product_orders" SET "status" = 'PAID_ONLINE', "paid_at" = now(), "mp_payment_id" = ${`mp-${orderId}`}
    WHERE "id" = ${orderId}`;
}

const isErr = (code: string) => (e: unknown) => (e as { code?: string })?.code === code;

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  tienda = await import("@/lib/barber/tienda");
  core = await import("@/lib/barber/tienda-core");
  caja = await import("@/lib/barber/commissions");
  A = await makeShop("A");
  B = await makeShop("B");
  await cash.openCashSession(A.ctx, { openingAmount: 500 });
  await cash.openCashSession(B.ctx, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  await prisma.$executeRawUnsafe(`DELETE FROM "barber_product_orders" WHERE "barbershop_id" = ANY($1::text[])`, ids);
  await prisma.barberStockMovement.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ── 1. Tienda pública ──────────────────────────────────────────────────

test("1 · la tienda enseña solo lo marcado «en mi página», con lo que queda y su etiqueta", { skip }, async () => {
  const g = await gateOf(A);
  assert.equal(g.ordersReady, true);
  const items = await tienda.loadTienda(g);
  const names = items.map((p) => p.name).sort();
  assert.deepEqual(names, ["Aceite", "Cera", "Shampoo"], "Oculto no sale; nada de B");
  const cera = items.find((p) => p.name === "Cera")!;
  assert.equal(cera.available, 3);
  assert.equal(cera.tag, "available");
  assert.equal(cera.orderable, true);
  assert.equal(cera.photoUrl, "https://ejemplo.test/cera.webp");
  assert.equal(items.find((p) => p.name === "Shampoo")!.orderable, false, "se muestra pero no se aparta");
  assert.equal(items[0].name, "Cera", "con foto primero");
  // Nada de costo ni SKU en lo que sale.
  assert.equal("cost" in cera, false);
  assert.equal("sku" in cera, false);
  // Un producto de otra barbería no se ve por esta liga.
  assert.equal(await tienda.loadTiendaProduct(g, B.cera), null);
  assert.equal(await tienda.loadTiendaProduct(g, A.oculto), null);
  assert.equal((await tienda.loadTiendaProduct(g, A.cera))!.name, "Cera");
  // Los destacados de la página de la barbería.
  const dest = await tienda.loadFeaturedProducts({ id: A.id, plan: "PROFESIONAL" });
  assert.ok(dest.length > 0 && dest.length <= core.TIENDA_FEATURED_MAX);
  assert.equal((await tienda.loadFeaturedProducts({ id: A.id, plan: "BASICO" })).length, 0, "sin productos en el plan, no hay sección");
});

test("1b · etiqueta: Disponible / Pocas (en o bajo el mínimo) / Agotado", () => {
  return (async () => {
    const { stockTag } = await import("@/lib/barber/tienda-core");
    assert.equal(stockTag(5, 1), "available");
    assert.equal(stockTag(1, 1), "low");
    assert.equal(stockTag(2, null), "available", "sin mínimo nunca es «Pocas»");
    assert.equal(stockTag(0, 3), "out");
    assert.equal(stockTag(-2, null), "out");
  })();
});

// ── 2. Apartar ─────────────────────────────────────────────────────────

test("2 · apartar congela el precio, resta de la tienda y NO baja el inventario", { skip }, async () => {
  const o = await order(A, [{ productId: A.cera, qty: 2 }]);
  assert.match(o.folio, /^[A-Z0-9]{5}$/);
  assert.equal(o.total, 300);
  assert.equal(o.branch.id, A.id);
  assert.equal(await stockOf(A.cera), 3, "el inventario real no se toca al apartar");
  const cera = (await tienda.loadTiendaProduct(await gateOf(A), A.cera))!;
  assert.equal(cera.available, 1);
  assert.equal(cera.tag, "low", "queda 1 con mínimo 1");

  // Más de lo que queda: no.
  await assert.rejects(order(A, [{ productId: A.cera, qty: 2 }]), (e: unknown) => isErr("OUT_OF_STOCK")(e) && (e as { details?: { available?: number } }).details?.available === 1);

  // Sube el precio después: el pedido conserva el suyo.
  await prisma.barberProduct.update({ where: { id: A.cera }, data: { price: new Prisma.Decimal(199) } });
  const row = await tienda.getProductOrder(A.ctx, o.id);
  assert.equal(row.items[0].unitPrice, 150);
  assert.equal(row.total, 300);
  await prisma.barberProduct.update({ where: { id: A.cera }, data: { price: new Prisma.Decimal(150) } });
  await tienda.cancelProductOrder(A.ctx, o.id);
  assert.equal((await tienda.loadTiendaProduct(await gateOf(A), A.cera))!.available, 3, "cancelar libera");
});

test("2b · dos personas por la última pieza a la vez: gana UNA", { skip }, async () => {
  const p = await prisma.barberProduct.create({ data: { barbershopId: A.id, name: `Última ${RUN}`, price: new Prisma.Decimal(80), stock: 1 } });
  await setExtras(p.id, true, true);
  const g = await gateOf(A);
  // Una carrera de milisegundos no se da sola: otra transacción toma la
  // tabla de pedidos en SHARE (deja leer, frena escribir) 700 ms mientras
  // llegan las seis. Sin el FOR UPDATE de los productos, las seis leen «0
  // apartados» a la vez y apartan la misma pieza (contraprueba hecha).
  let soltar: () => void = () => undefined;
  const tomado = new Promise<void>((ok) => {
    soltar = ok;
  });
  const candado = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE "barber_product_orders" IN SHARE MODE`);
    soltar();
    await new Promise((r) => setTimeout(r, 700));
  }, { timeout: 10000 });
  await tomado;
  const res = await Promise.allSettled(
    Array.from({ length: 6 }, () => tienda.createTiendaOrder({ gate: g, lines: [{ productId: p.id, qty: 1 }], name: "Ana López", phone: newPhone(), portalClient: null })),
  );
  await candado;
  const ok = res.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, `apartaron ${ok.length}`);
  for (const r of res) if (r.status === "rejected") assert.ok(isErr("OUT_OF_STOCK")(r.reason), String(r.reason));
});

test("2c · no se aparta lo que no se ofrece, ni de otra barbería, ni de dos sucursales, ni sin tope por teléfono", { skip }, async () => {
  await assert.rejects(order(A, [{ productId: A.shampoo, qty: 1 }]), isErr("NOT_ORDERABLE"));
  await assert.rejects(order(A, [{ productId: A.oculto, qty: 1 }]), isErr("NOT_ORDERABLE"));
  await assert.rejects(order(A, [{ productId: B.aceite, qty: 1 }]), isErr("NOT_ORDERABLE"), "por la liga de A no se aparta lo de B");
  const tel = newPhone();
  for (let i = 0; i < core.TIENDA_MAX_OPEN_PER_PHONE; i++) await order(A, [{ productId: A.aceite, qty: 1 }], tel);
  await assert.rejects(order(A, [{ productId: A.aceite, qty: 1 }], tel), isErr("TOO_MANY_OPEN"));
  // Forma: cantidades y líneas.
  assert.throws(() => core.normalizeOrderLines([]), isErr("EMPTY_ORDER"));
  assert.throws(() => core.normalizeOrderLines([{ productId: "x", qty: core.TIENDA_MAX_QTY_PER_LINE + 1 }]), isErr("BAD_QTY"));
  assert.throws(() => core.normalizeOrderLines([{ productId: "x", qty: 0 }]), isErr("BAD_QTY"));
  assert.deepEqual(core.normalizeOrderLines([{ productId: "x", qty: 2 }, { productId: "x", qty: 3 }]), [{ productId: "x", qty: 5 }], "se juntan");
});

// ── 3. Vencimiento ─────────────────────────────────────────────────────

test("3 · a las 72 h sin recoger vence y libera; lo pagado en línea no vence", { skip }, async () => {
  const viejo = await order(A, [{ productId: A.cera, qty: 1 }]);
  const pagado = await order(A, [{ productId: A.cera, qty: 1 }]);
  await payOnline(pagado.id);
  await prisma.$executeRaw`UPDATE "barber_product_orders" SET "created_at" = now() - interval '73 hours' WHERE "id" IN (${viejo.id}, ${pagado.id})`;
  const cera = (await tienda.loadTiendaProduct(await gateOf(A), A.cera))!;
  assert.equal(cera.available, 2, "el vencido libera su pieza; el pagado la sigue apartando");
  assert.equal((await statusOf(viejo.id)).status, "EXPIRED");
  assert.equal((await statusOf(pagado.id)).status, "PAID_ONLINE");
  // Un vencido no se entrega por Caja.
  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: viejo.id, items: [{ kind: "product", id: A.cera, qty: 1 }], paymentMethod: "CASH" }, FEATURES),
    isErr("ORDER_NOT_OPEN"),
  );
  await tienda.cancelProductOrder(A.ctx, pagado.id, { refundConfirmed: true });
});

// ── 4. Entregar y cobrar ───────────────────────────────────────────────

test("4 · entregar y cobrar en la barbería: precio congelado, otras líneas sí, una sola vez", { skip }, async () => {
  const o = await order(A, [{ productId: A.cera, qty: 2 }]);
  await prisma.barberProduct.update({ where: { id: A.cera }, data: { price: new Prisma.Decimal(175) } });
  const before = await cash.getCashState(A.ctx);

  // Piezas que no coinciden, o «en línea» sin haberse pagado: no.
  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.cera, qty: 1 }], paymentMethod: "CASH" }, FEATURES),
    isErr("ORDER_LINES_MISMATCH"),
  );
  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.cera, qty: 2 }], paymentMethod: "STRIPE" }, FEATURES),
    isErr("ORDER_PAYMENT_MISMATCH"),
  );

  const sale = await cash.createSale(
    A.ctx,
    { productOrderId: o.id, items: [{ kind: "product", id: A.cera, qty: 2 }, { kind: "service", id: A.serviceId }], paymentMethod: "CASH" },
    FEATURES,
  );
  const ceraLine = sale.items.find((it) => it.productId === A.cera)!;
  assert.equal(ceraLine.unitPrice, 150, "precio del pedido, no el de hoy (175)");
  assert.equal(sale.total, 500);
  assert.deepEqual(await statusOf(o.id), { status: "PICKED_UP", sale_id: sale.id });
  assert.equal(await stockOf(A.cera), 1, "ahora sí baja el inventario");
  const afterS = await cash.getCashState(A.ctx);
  assert.equal(afterS.open!.expectedCash - before.open!.expectedCash, 500, "entra al efectivo del turno");

  // Dos veces: no.
  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.cera, qty: 2 }], paymentMethod: "CASH" }, FEATURES),
    isErr("ORDER_NOT_OPEN"),
  );

  // Cancelar el ticket: vuelve a «Listo para recoger» y las piezas regresan.
  await cash.cancelSale(A.ctx, sale.id, { reason: "prueba" });
  assert.deepEqual(await statusOf(o.id), { status: "READY", sale_id: null });
  assert.equal(await stockOf(A.cera), 3);
  await prisma.barberProduct.update({ where: { id: A.cera }, data: { price: new Prisma.Decimal(150) } });
  await tienda.cancelProductOrder(A.ctx, o.id);
});

test("4b · pagado en línea: se registra como «Pago en línea», tal cual, fuera del efectivo y sin cobrar dos veces", { skip }, async () => {
  const o = await order(A, [{ productId: A.aceite, qty: 2 }]);
  assert.equal(o.total, 241, "120.50 × 2");
  await payOnline(o.id);
  const before = await cash.getCashState(A.ctx);

  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.aceite, qty: 2 }], paymentMethod: "CASH" }, FEATURES),
    isErr("ORDER_PAYMENT_MISMATCH"),
    "ya pagado: no se vuelve a cobrar en efectivo",
  );
  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.aceite, qty: 2 }, { kind: "service", id: A.serviceId }], paymentMethod: "STRIPE" }, FEATURES),
    isErr("ORDER_LINES_MISMATCH"),
  );
  await assert.rejects(
    cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.aceite, qty: 2 }], paymentMethod: "STRIPE", discount: 10 }, FEATURES),
    isErr("ORDER_PAID_AS_IS"),
  );
  // «Pago en línea» fuera de un pedido: no existe.
  await assert.rejects(
    cash.createSale(A.ctx, { items: [{ kind: "product", id: A.aceite, qty: 1 }], paymentMethod: "STRIPE" }, FEATURES),
    isErr("INVALID_PAYMENT_METHOD"),
  );

  const sale = await cash.createSale(A.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.aceite, qty: 2 }], paymentMethod: "STRIPE" }, FEATURES);
  assert.equal(sale.paymentMethod, "STRIPE");
  assert.equal(sale.total, 241);
  const afterS = await cash.getCashState(A.ctx);
  assert.equal(afterS.open!.expectedCash, before.open!.expectedCash, "no entra al efectivo del turno");
  assert.equal(afterS.open!.byMethod.STRIPE.total - before.open!.byMethod.STRIPE.total, 241, "sí aparece en el desglose");
  assert.equal(await stockOf(A.aceite), 18);
  assert.equal((await statusOf(o.id)).status, "PICKED_UP");

  // Cancelar ese ticket: vuelve a «Pagado en línea» (el dinero sigue cobrado).
  await cash.cancelSale(A.ctx, sale.id, { reason: "prueba" });
  assert.equal((await statusOf(o.id)).status, "PAID_ONLINE");
  assert.equal(await stockOf(A.aceite), 20);
  await tienda.cancelProductOrder(A.ctx, o.id, { refundConfirmed: true });
});

// ── 5. Panel ───────────────────────────────────────────────────────────

test("5 · lista, contador, «Listo», cancelar un pagado exige confirmar el reembolso", { skip }, async () => {
  const o1 = await order(A, [{ productId: A.aceite, qty: 1 }]);
  const o2 = await order(A, [{ productId: A.aceite, qty: 1 }]);
  await payOnline(o2.id);
  const list = await tienda.listProductOrders(A.ctx);
  assert.equal(list.ready, true);
  const r1 = list.orders.find((x) => x.id === o1.id)!;
  const r2 = list.orders.find((x) => x.id === o2.id)!;
  assert.equal(r1.paidOnline, false);
  assert.ok(r1.expiresAt, "lo sin pagar dice cuándo vence");
  assert.equal(r2.paidOnline, true);
  assert.equal(r2.expiresAt, null);
  assert.ok(list.newCount >= 2);
  assert.equal(await tienda.countNewProductOrders(A.id), list.newCount);

  const ready = await tienda.markProductOrderReady(A.ctx, o2.id);
  assert.equal(ready.status, "READY");
  assert.equal(ready.paidOnline, true, "listo sigue pagado");
  await assert.rejects(tienda.cancelProductOrder(A.ctx, o2.id), isErr("PAID_ONLINE_REFUND"));
  assert.equal((await statusOf(o2.id)).status, "READY", "sin confirmar no cambia nada");
  assert.equal((await tienda.cancelProductOrder(A.ctx, o2.id, { refundConfirmed: true })).status, "CANCELLED");
  await assert.rejects(tienda.markProductOrderReady(A.ctx, o2.id), isErr("ORDER_NOT_OPEN"));
  await tienda.cancelProductOrder(A.ctx, o1.id);
});

test("5b · Recepción ve, marca y entrega; Barbero no; otra barbería no ve nada", { skip }, async () => {
  const o = await order(A, [{ productId: A.aceite, qty: 1 }]);
  const rita = await staff(A, "RECEPTION");
  const beto = await staff(A, "BARBER");
  assert.equal(tienda.canHandleOrders(rita), true);
  assert.equal(tienda.canHandleOrders(beto), false);
  assert.ok((await tienda.listProductOrders(rita)).orders.some((x) => x.id === o.id));
  await assert.rejects(tienda.listProductOrders(beto), BarberForbiddenError);
  await assert.rejects(tienda.markProductOrderReady(beto, o.id), BarberForbiddenError);
  await tienda.markProductOrderReady(rita, o.id);
  const sale = await cash.createSale(rita, { productOrderId: o.id, items: [{ kind: "product", id: A.aceite, qty: 1 }], paymentMethod: "CARD" }, FEATURES);
  assert.equal((await statusOf(o.id)).status, "PICKED_UP");
  await cash.cancelSale(A.ctx, sale.id, { reason: "prueba" });
  await tienda.cancelProductOrder(A.ctx, o.id);

  // Aislamiento: B no lo ve, no lo toca, no lo cobra.
  assert.equal((await tienda.listProductOrders(B.ctx)).orders.some((x) => x.id === o.id), false);
  await assert.rejects(tienda.markProductOrderReady(B.ctx, o.id), isErr("ORDER_NOT_FOUND"));
  await assert.rejects(tienda.getProductOrder(B.ctx, o.id), isErr("ORDER_NOT_FOUND"));
  await assert.rejects(
    cash.createSale(B.ctx, { productOrderId: o.id, items: [{ kind: "product", id: A.aceite, qty: 1 }], paymentMethod: "CASH" }, FEATURES),
    (e: unknown) => isErr("ORDER_NOT_FOUND")(e) || isErr("PRODUCT_NOT_FOUND")(e),
  );
});

test("5c · extras del producto: solo quien administra el catálogo; textos con tope", { skip }, async () => {
  const rita = await staff(A, "RECEPTION");
  await assert.rejects(tienda.saveProductExtras(rita, A.shampoo, { showOnWeb: false }), BarberForbiddenError);
  const saved = await tienda.saveProductExtras(A.ctx, A.shampoo, { category: "  Cabello   corto ", description: "Para todo tipo de cabello.", onlineOrder: true });
  assert.equal(saved.category, "Cabello corto");
  assert.equal(saved.showOnWeb, true, "lo que no llega se queda como estaba");
  assert.equal(saved.onlineOrder, true);
  await assert.rejects(tienda.saveProductExtras(A.ctx, A.shampoo, { description: "x".repeat(core.PRODUCT_DESCRIPTION_MAX + 1) }), isErr("INVALID_INPUT"));
  await assert.rejects(tienda.saveProductExtras(B.ctx, A.shampoo, { showOnWeb: false }), isErr("PRODUCT_NOT_FOUND"));
  const load = await tienda.loadProductExtras(A.id);
  assert.equal(load.ready, true);
  assert.equal(load.extras[A.shampoo].description, "Para todo tipo de cabello.");
  await tienda.saveProductExtras(A.ctx, A.shampoo, { onlineOrder: false });
});

test("5d · dinero: total en centavos sin errores de coma flotante", () => {
  return (async () => {
    const { orderTotalCents } = await import("@/lib/barber/tienda-core");
    assert.equal(orderTotalCents([{ unitPrice: 0.1, qty: 3 }, { unitPrice: 0.2, qty: 1 }]), 50);
    assert.equal(orderTotalCents([{ unitPrice: 120.5, qty: 2 }, { unitPrice: 19.99, qty: 3 }]), 30097);
  })();
});

// ── 6. La ruta pública ─────────────────────────────────────────────────

test("6 · POST /api/barber/public/tienda/[slug]/pedidos: valida, liga «mi cuenta» de su sede y no deja apartar de más", { skip }, async () => {
  const { POST } = await import("@/app/api/barber/public/tienda/[slug]/pedidos/route");
  const { NextRequest } = await import("next/server");
  const { packPortalSession } = await import("@/lib/barber/portal-core");
  let ip = 10;
  const call = (slug: string, body: unknown) =>
    POST(
      new NextRequest(`http://localhost/api/barber/public/tienda/${slug}/pedidos`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${seq}.${ip++}` },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug }) },
    );
  const lines = [{ productId: A.aceite, qty: 1 }];
  assert.equal((await call(A.slug, { lines, name: "4n4", phone: "5512345678" })).status, 400, "nombre con números");
  assert.equal((await call(A.slug, { lines, name: "Ana López", phone: "123" })).status, 400, "teléfono corto");
  assert.equal((await call(`no-existe-${RUN}`, { lines, name: "Ana López", phone: "5512345678" })).status, 404);
  const trampa = await call(A.slug, { lines, name: "Ana López", phone: "5512345678", website: "spam.com" });
  assert.equal(trampa.status, 200);
  assert.equal(((await trampa.json()) as { folio: string }).folio, "-----", "el bot ve éxito y no se crea nada");

  // «mi cuenta» de A: el pedido queda ligado a su ficha.
  const cli = await prisma.barberClient.create({ data: { barbershopId: A.id, name: "Cliente Portal", phone: newPhone() } });
  portalCookie = packPortalSession(cli.id, A.id).value;
  const r = await call(A.slug, { lines, name: "Cliente Portal", phone: "55 1234 5678", payOnline: true });
  const body = (await r.json()) as { id: string; folio: string; folioUrl: string };
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.folioUrl, `/b/${A.slug}/tienda/pedido/${body.id}`, "la ruta del folio que espera ws6-t5");
  const row = (await prisma.$queryRaw<Array<{ client_id: string | null; client_phone: string; pay_method: string }>>`
    SELECT "client_id", "client_phone", "pay_method" FROM "barber_product_orders" WHERE "id" = ${body.id}`)[0];
  assert.deepEqual(row, { client_id: cli.id, client_phone: "5512345678", pay_method: "MERCADOPAGO" });
  // La misma cookie NO liga un pedido de otra barbería.
  const rb = await call(B.slug, { lines: [{ productId: B.aceite, qty: 1 }], name: "Cliente Portal", phone: "5512345678" });
  const bb = (await rb.json()) as { id: string };
  assert.equal(rb.status, 200, JSON.stringify(bb));
  const rowB = (await prisma.$queryRaw<Array<{ client_id: string | null }>>`SELECT "client_id" FROM "barber_product_orders" WHERE "id" = ${bb.id}`)[0];
  assert.equal(rowB.client_id, null);
  portalCookie = null;
  // Forma: más de 10 piezas → 400. Más de lo que hay → 409 con lo que queda.
  assert.equal((await call(A.slug, { lines: [{ productId: A.cera, qty: 11 }], name: "Ana López", phone: "5512345678" })).status, 400);
  const r2 = await call(A.slug, { lines: [{ productId: A.cera, qty: 4 }], name: "Ana López", phone: newPhone() });
  assert.equal(r2.status, 409);
  const b2 = (await r2.json()) as { code: string; available: number };
  assert.equal(b2.code, "OUT_OF_STOCK");
  assert.equal(b2.available, 3);
  await tienda.cancelProductOrder(A.ctx, body.id);
  await tienda.cancelProductOrder(B.ctx, bb.id);
});
