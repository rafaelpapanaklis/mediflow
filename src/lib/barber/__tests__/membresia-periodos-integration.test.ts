// D1 de Rafael (15-nov-2026): «tiene 2 meses de membresía, tendría enero y
// febrero, 4 cortes y 4 cortes».
//
// Antes: renovar ANTES de que venciera movía las fechas de la MISMA fila y
// ponía el cupo en 0 para toda la ventana: quien pagaba 2 × $500 tenía 60
// días con 4 cortes (no 8) y perdía los que no había usado.
//
// Ahora cada periodo pagado es una fila con sus fechas y su cupo:
//   · venta + renovación anticipada = 2 periodos × 4 = 8 cortes;
//   · los cortes se gastan del periodo VIGENTE; los del siguiente no se
//     adelantan (el 5.º corte dentro del primer mes se cobra normal);
//   · al empezar el segundo periodo, sus 4 están disponibles: usar 5 = 4 del
//     primero + 1 del segundo;
//   · si el primero vence con cortes sin usar, ésos se pierden (como en un mes
//     normal) y el segundo arranca con sus 4;
//   · una fila de LEGADO (renovada antes del cambio, con inicio en el futuro)
//     sigue cubriendo desde ya con su contador: nadie pierde cortes;
//   · cancelar el ticket de la renovación anticipada cancela SOLO ese periodo;
//   · la lista y las cifras de Membresías cuentan una membresía por cliente,
//     con su «próximo periodo», y quien ya renovó no está «por vencer».
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/membresia-periodos-integration.test.ts
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { pickCurrentPeriod, upcomingPeriods } from "../memberships-core";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const PRO = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const DAY = 86_400_000;
// SIN dígitos (pase 11): los buscadores también comparan los dígitos del
// texto contra el teléfono, y un sufijo como «…5…» hacía que «Ana <RUN>»
// encontrara a todos los clientes (teléfonos 55…). Era la prueba inestable.
const RUN = `mper${Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;

// ═══════════════════════════════════════════════════════════════════════
// 0. La regla, pura
// ═══════════════════════════════════════════════════════════════════════

test("periodo vigente: el que ya empezó; el siguiente es «próximo»; legado sin predecesor cubre desde ya", () => {
  const t0 = new Date("2027-01-01T12:00:00Z");
  const p1 = { id: "p1", status: "ACTIVE", startAt: t0, endAt: new Date(t0.getTime() + 30 * DAY), cutsUsed: 0, membershipId: "m" };
  const p2 = { id: "p2", status: "ACTIVE", startAt: p1.endAt, endAt: new Date(t0.getTime() + 60 * DAY), cutsUsed: 0, membershipId: "m" };
  const now = new Date(t0.getTime() + DAY);
  assert.equal(pickCurrentPeriod([p2, p1], now)?.id, "p1");
  assert.deepEqual(upcomingPeriods([p1, p2], now).map((p) => p.id), ["p2"]);
  const later = new Date(t0.getTime() + 31 * DAY);
  assert.equal(pickCurrentPeriod([{ ...p1, status: "EXPIRED" }, p2], later)?.id, "p2");
  // Legado: una sola fila que empieza en 10 días (renovada antes del cambio).
  const legacy = { id: "L", status: "ACTIVE", startAt: new Date(now.getTime() + 10 * DAY), endAt: new Date(now.getTime() + 40 * DAY), cutsUsed: 1, membershipId: "m" };
  assert.equal(pickCurrentPeriod([legacy], now)?.id, "L");
  // Pausada: no hay periodo vigente (y el siguiente tampoco se adelanta).
  assert.equal(pickCurrentPeriod([{ ...p1, status: "PAUSED" }, p2], now), null);
});

// ═══════════════════════════════════════════════════════════════════════
// Integración
// ═══════════════════════════════════════════════════════════════════════

let prisma: typeof import("@/lib/prisma")["prisma"];
let mem: typeof import("@/lib/barber/memberships");
let cash: typeof import("@/lib/barber/cash");
let shopId: string;
let owner: BarberContext;
let planId: string;
let serviceId: string;
const clients: Record<string, string> = {};

async function cliente(tag: string) {
  const c = await prisma.barberClient.create({ data: { barbershopId: shopId, name: `${tag} ${RUN}`, phone: `55${Math.floor(10_000_000 + Math.random() * 89_999_999)}` } });
  clients[tag] = c.id;
  return c.id;
}
const vender = (clientId: string, now: Date) =>
  mem.sellMembership({ barbershopId: shopId, clientId, membershipId: planId, paymentMethod: "CASH", soldByUserId: owner.barberUserId, now });
const renovar = (cmId: string, now: Date) =>
  mem.renewClientMembership({ barbershopId: shopId, clientMembershipId: cmId, paymentMethod: "CASH", soldByUserId: owner.barberUserId, now });
const filas = (clientId: string) =>
  prisma.barberClientMembership.findMany({ where: { clientId }, orderBy: { startAt: "asc" } });
const corte = (clientId: string, now: Date) =>
  cash.createSale(owner, { clientId, items: [{ kind: "service", id: serviceId }], paymentMethod: "CASH", membershipItemIndex: 0 }, PRO, now);
async function lookup(tag: string, now: Date) {
  const hits = await cash.lookupClients(owner, `${tag} ${RUN}`, now);
  assert.equal(hits.length, 1, tag);
  return hits[0];
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  mem = await import("@/lib/barber/memberships");
  cash = await import("@/lib/barber/cash");
  const shop = await prisma.barbershop.create({ data: { name: "Barbería Periodos", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" } });
  shopId = shop.id;
  const user = await prisma.barberUser.create({ data: { barbershopId: shopId, supabaseId: `${RUN}-o`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "Prueba", role: "OWNER" } });
  owner = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber: null, role: "OWNER" };
  planId = (await prisma.barberMembership.create({ data: { barbershopId: shopId, name: "Mensual 4", price: new Prisma.Decimal(500), includedCuts: 4, periodDays: 30 } })).id;
  serviceId = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  await cash.openCashSession(owner, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: shopId } }).catch(() => {});
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberClientMembership.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberMembership.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberClient.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberService.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("🔴 venta + renovación anticipada = 2 periodos × 4 cortes (8), cada uno con sus fechas", { skip }, async () => {
  const id = await cliente("Ana");
  const t0 = new Date();
  const venta = await vender(id, t0);
  await renovar(venta.id, t0);
  const rows = await filas(id);
  assert.equal(rows.length, 2, "un periodo por fila");
  assert.equal(rows[0].endAt.getTime(), rows[1].startAt.getTime(), "el segundo empieza donde termina el primero");
  assert.deepEqual(rows.map((r) => r.cutsUsed), [0, 0]);
  assert.equal(rows.length * 4, 8);
  // La pantalla de Caja: 4 en este periodo y «próximo periodo» aparte.
  const l = await lookup("Ana", new Date(t0.getTime() + DAY));
  assert.equal(l.activeMembership?.id, rows[0].id);
  assert.equal(l.activeMembership?.cutsLeft, 4);
  assert.equal(l.nextMembershipPeriod?.startAt, rows[1].startAt.toISOString());
  assert.equal(l.nextMembershipPeriod?.includedCuts, 4);
  // Una tercera renovación encadena otro mes.
  await renovar(venta.id, t0);
  const tres = await filas(id);
  assert.equal(tres.length, 3);
  assert.equal(tres[1].endAt.getTime(), tres[2].startAt.getTime());
});

test("🔴 usar 5: 4 del primero; el 5.º dentro del primer mes se cobra normal; ya en el segundo, sale de los suyos", { skip }, async () => {
  const id = await cliente("Beto");
  const t0 = new Date();
  const v = await vender(id, t0);
  await renovar(v.id, t0);
  const [p1, p2] = await filas(id);
  for (let i = 1; i <= 4; i++) {
    const sale = await corte(id, new Date(t0.getTime() + i * 60_000));
    assert.equal(Number(sale.total), 0, `corte ${i} cubierto`);
  }
  // 5.º en el primer mes: el primer periodo está lleno y el segundo no ha empezado.
  await assert.rejects(corte(id, new Date(t0.getTime() + 2 * DAY)), (e: Error & { code?: string }) => e.code === "MEMBERSHIP_NOT_ACTIVE");
  const l = await lookup("Beto", new Date(t0.getTime() + 2 * DAY));
  assert.equal(l.activeMembership, null, "sin cupo en el periodo vigente");
  assert.ok(l.nextMembershipPeriod, "pero se ve el próximo periodo");
  // Ya en el segundo periodo:
  const enSegundo = new Date(p2.startAt.getTime() + DAY);
  const s5 = await corte(id, enSegundo);
  assert.equal(Number(s5.total), 0);
  const after = await prisma.barberClientMembership.findMany({ where: { id: { in: [p1.id, p2.id] } }, orderBy: { startAt: "asc" } });
  assert.deepEqual(after.map((r) => r.cutsUsed), [4, 1], "4 del primero y 1 del segundo");
});

test("si el primer periodo vence con cortes sin usar, se pierden; el segundo arranca con sus 4", { skip }, async () => {
  const id = await cliente("Ceci");
  const t0 = new Date();
  const v = await vender(id, t0);
  await renovar(v.id, t0);
  await corte(id, new Date(t0.getTime() + 60_000));
  await corte(id, new Date(t0.getTime() + 120_000));
  const [, p2] = await filas(id);
  const l = await lookup("Ceci", new Date(p2.startAt.getTime() + DAY));
  assert.equal(l.activeMembership?.id, p2.id);
  assert.equal(l.activeMembership?.cutsLeft, 4, "los 2 que sobraron del primero no pasan al segundo");
});

test("🔴 LEGADO: una membresía renovada antes del cambio (inicio en el futuro) sigue cubriendo HOY con su contador", { skip }, async () => {
  const id = await cliente("Dora");
  const now = new Date();
  await prisma.barberClientMembership.create({
    data: { barbershopId: shopId, clientId: id, membershipId: planId, status: "ACTIVE", startAt: new Date(now.getTime() + 10 * DAY), endAt: new Date(now.getTime() + 40 * DAY), cutsUsed: 1, paymentMethod: "CASH" },
  });
  const l = await lookup("Dora", now);
  assert.ok(l.activeMembership, "no pierde la cobertura");
  assert.equal(l.activeMembership?.cutsLeft, 3);
  const sale = await corte(id, now);
  assert.equal(Number(sale.total), 0);
});

test("cancelar el ticket de la renovación anticipada cancela SOLO ese periodo; el vigente queda igual", { skip }, async () => {
  const id = await cliente("Eva");
  const t0 = new Date();
  const v = await vender(id, t0);
  await corte(id, new Date(t0.getTime() + 60_000));
  const ren = await renovar(v.id, t0);
  await cash.cancelSale(owner, ren.saleId, { reason: "QA: se cobró de más" });
  const rows = await filas(id);
  assert.deepEqual(rows.map((r) => [r.status, r.cutsUsed]), [["ACTIVE", 1], ["CANCELLED", 0]]);
});

test("Membresías: una entrada por cliente con su «próximo periodo»; quien ya renovó no está «por vencer»", { skip }, async () => {
  const list = await mem.listClientMemberships(shopId, { filter: "all", q: `Ana ${RUN}` });
  assert.equal(list.length, 1, "los periodos futuros viajan dentro del vigente");
  assert.equal(list[0].nextPeriods?.length, 2);
  // Un dígito suelto no es un teléfono: «Ana 5» no trae a todos los que tienen un 5.
  assert.equal((await mem.listClientMemberships(shopId, { filter: "all", q: "Ana 5" })).length, 0, "un dígito no busca por teléfono");
  const soon = await mem.listClientMemberships(shopId, { filter: "soon", q: `Ana ${RUN}` });
  assert.equal(soon.length, 0);
  const stats = await mem.getMembershipStats(shopId);
  const vivas = new Set((await prisma.barberClientMembership.findMany({ where: { barbershopId: shopId, status: "ACTIVE", endAt: { gt: new Date() } }, select: { clientId: true } })).map((r) => r.clientId));
  assert.equal(stats.activeCount, vivas.size, "una membresía por cliente, no una por periodo");
  assert.equal(stats.committedRevenue, vivas.size * 500);
});
