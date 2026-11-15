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
]);
// plans.ts NO se sustituye: las rutas de Caja resuelven el plan con un import()
// dinámico que no ve el doble; contra la base de pruebas cae al respaldo del
// plan Profesional (igual que cobro-cita-no-completada-integration).

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
  assert.equal(last.cancelledTotal, 200, "el total que tenía, leído de la marca");
  assert.equal(last.total, 0);
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


// ── 2. Nuevo cobro desde la ficha = el mismo createSale ─────────────────

const cajaError = (code: string) => (e: unknown) => e instanceof caja.BarberCajaError && e.code === code;

test("2 · descuento en %: se convierte a pesos en el servidor, en la misma línea «Descuento» y con el mismo tope", { skip }, async () => {
  const pepe = await newClient(A, "Pepe");
  const diez = await charge(A, pepe, { discountPct: "10" });
  assert.equal(diez.total, 180, "10% de $200");
  assert.deepEqual(diez.items.map((i) => [i.description, i.unitPrice]), [["Corte", 200], ["Descuento", -20]]);

  // Sobre servicio + producto, con decimales: 12.5% de $350 = $43.75.
  const mixto = await charge(A, pepe, { items: [{ kind: "service", id: A.serviceId }, { kind: "product", id: A.productId }], discountPct: 12.5 });
  assert.equal(mixto.total, 306.25);

  // 100% deja el ticket en $0, nunca negativo; la propina se cobra aparte.
  const todo = await charge(A, pepe, { discountPct: "100", tip: 20 });
  assert.equal(todo.subtotal, 0);
  assert.equal(todo.total, 20);

  await assert.rejects(charge(A, pepe, { discountPct: "10", discount: 5 }), cajaError("DISCOUNT_BOTH"));
  await assert.rejects(charge(A, pepe, { discountPct: "0" }), cajaError("INVALID_INPUT"));
  await assert.rejects(charge(A, pepe, { discountPct: "100.01" }), cajaError("INVALID_INPUT"));
  await assert.rejects(charge(A, pepe, { discountPct: "diez" }), cajaError("INVALID_INPUT"));
  await assert.rejects(charge(A, pepe, { discountPct: "10.555" }), cajaError("INVALID_INPUT"));
});

test("2 · el cobro de la ficha es un ticket de Caja: entra al turno abierto y a los cobros del cliente", { skip }, async () => {
  const luz = await newClient(A, "Luz");
  const hit = await cash.getClientLookup(A.ctx, luz);
  assert.equal(hit?.id, luz, "la ficha pide al cliente por id, ya listo para el ticket");
  const sale = await charge(A, luz, { clientId: hit!.id, paymentMethod: "SPEI" });
  const state = await cash.getCashState(A.ctx);
  assert.ok(state.open?.sales.some((x) => x.id === sale.id), "está en el corte del turno abierto");
  assert.equal(state.open?.byMethod.SPEI.total, sale.total);
  const page = await sales.listClientSales(A.ctx, luz);
  assert.equal(page.rows[0].id, sale.id, "y en el historial del cliente");
  const commission = await prisma.barberCommissionEntry.findFirst({ where: { saleId: sale.id } });
  assert.ok(commission, "y en comisiones");
});

test("2 · cliente para el cobro: de esta barbería, no bloqueado, y el Barbero solo uno suyo", { skip }, async () => {
  const moi = await newClient(A, "Moi");
  assert.equal(await cash.getClientLookup(B.ctx, moi), null, "otra barbería: no");
  await prisma.barberClient.update({ where: { id: moi }, data: { blockedAt: new Date() } });
  assert.equal(await cash.getClientLookup(A.ctx, moi), null, "bloqueado: no se le cobra");
  await prisma.barberClient.update({ where: { id: moi }, data: { blockedAt: null } });

  const beto = await staff(A, "BARBER", { barberId: A.barberId });
  await assert.rejects(cash.getClientLookup(beto, moi), (e: unknown) => e instanceof BarberForbiddenError, "sin caja, no");
  const betoCaja = await staff(A, "BARBER", { barberId: A.barberId, override: ["clients.view", "cash.view", "cash.manage"] });
  assert.equal(await cash.getClientLookup(betoCaja, moi), null, "con caja por permiso personal: solo sus clientes");
  await charge(A, moi);
  assert.equal((await cash.getClientLookup(betoCaja, moi))?.id, moi, "ya lo atendió: ahora sí");
});

// ── 3. «Por cobrar» ────────────────────────────────────────────────────

const DRAFTS_SQL = path.join(ROOT, "sql/barber_por_cobrar.sql");
async function applyDraftsSql() {
  const fs = await import("node:fs");
  const sql = fs.readFileSync(DRAFTS_SQL, "utf8").replace(/^\s*--.*$/gm, "");
  for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
}
const draftStatus = async (id: string) =>
  (await prisma.$queryRaw<Array<{ status: string; saleId: string | null }>>`SELECT "status", "saleId" FROM "barber_sale_drafts" WHERE "id" = ${id}`)[0];

test("3 · antes del SQL: no hay notas por cobrar y guardar lo dice; Caja lo sabe (draftsReady)", { skip }, async () => {
  const drafts = await import("@/lib/barber/sale-drafts");
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "barber_sale_drafts"`);
  const zoe = await newClient(A, "Zoe");
  assert.deepEqual(await drafts.listSaleDrafts(A.ctx), { ready: false, drafts: [] });
  await assert.rejects(
    drafts.saveSaleDraft(A.ctx, { clientId: zoe, payload: { items: [{ kind: "service", id: A.serviceId }] } }),
    cajaError("DRAFTS_SQL_PENDING"),
  );
  assert.equal((await cash.getCheckoutContext(A.ctx, FEATURES)).draftsReady, false);
  await applyDraftsSql();
  await applyDraftsSql(); // idempotente
  assert.equal((await cash.getCheckoutContext(A.ctx, FEATURES)).draftsReady, true);
});

test("3 · guardar sin cobrar NO toca corte, ingresos, comisiones ni estrellas; cobrarla la vuelve un ticket, UNA vez", { skip }, async () => {
  const drafts = await import("@/lib/barber/sale-drafts");
  const starsCore = await import("@/lib/barber/stars-core");
  const rita = await staff(A, "RECEPTION");
  const tom = await newClient(A, "Tom");
  const before = await cash.getCashState(A.ctx);
  const commissionsBefore = await prisma.barberCommissionEntry.count({ where: { barbershopId: A.id } });

  const { id } = await drafts.saveSaleDraft(rita, {
    clientId: tom,
    payload: { items: [{ kind: "service", id: A.serviceId }, { kind: "product", id: A.productId, qty: 2 }], barberId: A.barberId, discountPct: "10", notes: "Paga al rato" },
  });
  const list = await drafts.listSaleDrafts(A.ctx, { clientId: tom });
  assert.equal(list.drafts.length, 1);
  assert.equal(list.drafts[0].estimate, 450, "200 + 2×150 − 10%");
  assert.equal(list.drafts[0].clientName, `Tom ${RUN}`);
  assert.equal(list.drafts[0].createdByName, "Rita Staff");

  const after = await cash.getCashState(A.ctx);
  assert.equal(after.open?.sales.length, before.open?.sales.length, "el corte no ve la nota");
  assert.equal(after.open?.expectedCash, before.open?.expectedCash);
  assert.equal(await prisma.barberCommissionEntry.count({ where: { barbershopId: A.id } }), commissionsBefore, "sin comisión");
  assert.equal((await starsCore.loadStarsView(prisma, { barbershopId: A.id, clientId: tom, audience: "client" }))?.stars, 0, "sin estrella");
  assert.equal((await sales.listClientSales(A.ctx, tom)).summary.spent, 0, "sin ingreso");

  // Editarla mientras siga abierta.
  await drafts.saveSaleDraft(rita, { id, clientId: tom, payload: { items: [{ kind: "service", id: A.serviceId }], barberId: A.barberId, notes: "Solo el corte" } });
  assert.equal((await drafts.listSaleDrafts(A.ctx, { clientId: tom })).drafts[0].estimate, 200);

  // Cobrarla: el MISMO createSale, con draftId.
  const sale = await charge(A, tom, { draftId: id }, rita);
  assert.deepEqual(await draftStatus(id), { status: "CHARGED", saleId: sale.id });
  assert.equal((await drafts.listSaleDrafts(A.ctx, { clientId: tom })).drafts.length, 0, "ya no está por cobrar");
  assert.equal((await sales.listClientSales(A.ctx, tom)).summary.spent, 200, "ahora sí es ingreso");

  // Una segunda vez no: ni ticket nuevo.
  const count = await prisma.barberSale.count({ where: { clientId: tom } });
  await assert.rejects(charge(A, tom, { draftId: id }, rita), cajaError("DRAFT_NOT_OPEN"));
  assert.equal(await prisma.barberSale.count({ where: { clientId: tom } }), count, "el intento repetido no dejó ticket");
  await assert.rejects(drafts.saveSaleDraft(rita, { id, clientId: tom, payload: { items: [{ kind: "service", id: A.serviceId }] } }), cajaError("DRAFT_NOT_OPEN"));
});

test("3 · dos cobros A LA VEZ de la misma nota: entra uno; el otro se deshace entero", { skip }, async () => {
  const drafts = await import("@/lib/barber/sale-drafts");
  const uri = await newClient(A, "Uri");
  const { id } = await drafts.saveSaleDraft(A.ctx, { clientId: uri, payload: { items: [{ kind: "service", id: A.serviceId }] } });
  const results = await Promise.allSettled([charge(A, uri, { draftId: id }), charge(A, uri, { draftId: id }), charge(A, uri, { draftId: id })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => cajaError("DRAFT_NOT_OPEN")((r as PromiseRejectedResult).reason)));
  assert.equal(await prisma.barberSale.count({ where: { clientId: uri } }), 1, "un solo ticket");
  assert.equal(await prisma.barberCommissionEntry.count({ where: { sale: { clientId: uri } } }), 1, "una sola comisión");
});

test("3 · descartar no borra; otra sede no la toca; otro cliente no la salda; permisos", { skip }, async () => {
  const drafts = await import("@/lib/barber/sale-drafts");
  const val = await newClient(A, "Val");
  const otro = await newClient(A, "OtroCli");
  const { id } = await drafts.saveSaleDraft(A.ctx, { clientId: val, payload: { items: [{ kind: "service", id: A.serviceId }] } });

  await assert.rejects(charge(A, otro, { draftId: id }), cajaError("DRAFT_NOT_OPEN"), "la nota de Val no la salda un ticket de otro cliente");
  await assert.rejects(drafts.discardSaleDraft(B.ctx, id), cajaError("DRAFT_NOT_OPEN"), "otra barbería no la ve");
  assert.equal((await drafts.listSaleDrafts(B.ctx)).drafts.some((d) => d.id === id), false);

  const beto = await staff(A, "BARBER", { barberId: A.barberId });
  await assert.rejects(drafts.saveSaleDraft(beto, { clientId: val, payload: { items: [{ kind: "service", id: A.serviceId }] } }), (e: unknown) => e instanceof BarberForbiddenError);
  await assert.rejects(drafts.listSaleDrafts(beto), (e: unknown) => e instanceof BarberForbiddenError);

  await assert.rejects(
    drafts.saveSaleDraft(A.ctx, { clientId: val, payload: { items: [{ kind: "product", id: B.productId }] } }),
    cajaError("ITEM_NOT_FOUND"),
    "un producto de otra barbería no entra",
  );
  await assert.rejects(drafts.saveSaleDraft(A.ctx, { clientId: val, payload: { items: [] } }), cajaError("INVALID_INPUT"));
  await assert.rejects(
    drafts.saveSaleDraft(A.ctx, { clientId: val, payload: { items: [{ kind: "service", id: A.serviceId }], discount: "5", discountPct: "5" } }),
    cajaError("INVALID_INPUT"),
  );

  await drafts.discardSaleDraft(A.ctx, id);
  assert.equal((await draftStatus(id)).status, "DISCARDED", "descartada, no borrada");
  await assert.rejects(charge(A, val, { draftId: id }), cajaError("DRAFT_NOT_OPEN"));
});

// ── 4. Permisos por las RUTAS (lo que llama la pantalla) ───────────────

test("4 · rutas: Recepción cobra y guarda notas; el Barbero solo ve sus cobros y no toca notas; otra sede, 404/403", { skip }, async () => {
  const salesRoute = await import("@/app/api/barber/clients/[id]/sales/route");
  const draftsRoute = await import("@/app/api/barber/sales/drafts/route");
  const discardRoute = await import("@/app/api/barber/sales/drafts/[id]/route");
  const ctxRoute = await import("@/app/api/barber/sales/checkout-context/route");
  const ivo = await newClient(A, "Ivo");
  await charge(A, ivo); // con Beto
  await charge(A, ivo, { barberId: A.otherBarberId });

  const getSales = (id: string) =>
    salesRoute.GET(new Request(`http://localhost/api/barber/clients/${id}/sales`), { params: Promise.resolve({ id }) });
  const postDraft = (body: unknown) =>
    draftsRoute.POST(new Request("http://localhost/api/barber/sales/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  session = await staff(A, "RECEPTION");
  const r1 = await getSales(ivo);
  assert.equal(r1.status, 200);
  assert.equal(((await r1.json()) as { count: number }).count, 2);
  const created = await postDraft({ clientId: ivo, payload: { items: [{ kind: "service", id: A.serviceId }] } });
  assert.equal(created.status, 201, "Recepción guarda la nota");
  const { id: draftId } = (await created.json()) as { id: string };
  const ctxRes = await ctxRoute.GET(new Request(`http://localhost/api/barber/sales/checkout-context?clientId=${ivo}`));
  assert.equal(((await ctxRes.json()) as { client: { id: string } }).client.id, ivo, "y abre el cobro con el cliente puesto");

  session = await staff(A, "BARBER", { barberId: A.barberId });
  const r2 = await getSales(ivo);
  assert.equal(r2.status, 200);
  assert.equal(((await r2.json()) as { count: number; scope: string }).count, 1, "el Barbero: solo el suyo");
  assert.equal((await postDraft({ clientId: ivo, payload: { items: [{ kind: "service", id: A.serviceId }] } })).status, 403);
  assert.equal(
    (await discardRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: draftId }) })).status,
    403,
  );

  session = B.ctx;
  assert.equal((await getSales(ivo)).status, 403, "otra barbería: nada");
  assert.equal(
    (await discardRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: draftId }) })).status,
    409,
    "ni descartarla",
  );
  session = null;
});

// ── RONDA 2 · M1: cancelar el ticket de una nota la reabre ─────────────

test("RONDA 2 · M1: cancelar el ticket que salió de una nota la devuelve a «Por cobrar» (misma transacción) y se puede cobrar otra vez", { skip }, async () => {
  const drafts = await import("@/lib/barber/sale-drafts");
  const rita = await staff(A, "RECEPTION");
  const ana = await newClient(A, "AnaNota");
  const { id } = await drafts.saveSaleDraft(rita, { clientId: ana, payload: { items: [{ kind: "service", id: A.serviceId }], barberId: A.barberId } });

  const first = await charge(A, ana, { draftId: id }, rita);
  assert.deepEqual(await draftStatus(id), { status: "CHARGED", saleId: first.id });

  await cash.cancelSale(rita, first.id, { reason: "se cobró al cliente equivocado" });
  assert.deepEqual(await draftStatus(id), { status: "OPEN", saleId: null }, "vuelve a estar pendiente, sin ticket");
  const open = await drafts.listSaleDrafts(A.ctx, { clientId: ana });
  assert.deepEqual(open.drafts.map((d) => d.id), [id], "y sale otra vez en «Por cobrar»");
  assert.equal((await sales.listClientSales(A.ctx, ana)).summary.spent, 0, "el ticket cancelado no es ingreso");

  // Se cobra de nuevo, una sola vez, con otro ticket.
  const second = await charge(A, ana, { draftId: id }, rita);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(await draftStatus(id), { status: "CHARGED", saleId: second.id });

  // Cancelar un ticket que NO salió de una nota no toca ninguna nota.
  const other = await newClient(A, "SinNota");
  const { id: idle } = await drafts.saveSaleDraft(rita, { clientId: other, payload: { items: [{ kind: "service", id: A.serviceId }] } });
  const plain = await charge(A, other);
  await cash.cancelSale(rita, plain.id, { reason: "error" });
  assert.deepEqual(await draftStatus(idle), { status: "OPEN", saleId: null });
  assert.deepEqual(await draftStatus(id), { status: "CHARGED", saleId: second.id }, "la nota cobrada de Ana sigue cobrada");

  // O se descarta, ya reabierta.
  await cash.cancelSale(rita, second.id, { reason: "otra vez" });
  await drafts.discardSaleDraft(rita, id);
  assert.deepEqual(await draftStatus(id), { status: "DISCARDED", saleId: null });
});
