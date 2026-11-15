// Estrellas y bonos (ws6-t5, decisión de Rafael del 15-nov-2026).
//
// Lo que se prueba, por punto del encargo:
//   1. «Mis estrellas» en mi cuenta: número fresco, siguiente bono y cuál,
//      disponibles, historial con el porqué de cada visita sin estrella.
//   2. Enlace personal firmado: no se adivina, no sirve para otro cliente ni
//      otra barbería, se revoca.
//   3. Bonos de la barbería: el premio de siempre es el primer bono (antes y
//      después del SQL), varios bonos, validación, nada acumulado se pierde.
//   4. Caja dice «+1 estrella»; dar/quitar a mano con motivo; cancelar el
//      ticket quita su estrella.
//   5. Caja aplica el bono (servicio, pesos, %, otro) en la misma transacción;
//      cancelar lo devuelve; «Marcar como entregado» desde la ficha.
//   6. Permisos: bonos = settings.edit; estrellas a mano y bono = cash.manage
//      (Recepción sí, Barbero no); el Barbero solo ve a SUS clientes.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/estrellas-integration.test.ts
//
// La parte pura corre siempre; la integración solo contra una base LOCAL
// (crea y borra barberías, y crea/borra la tabla barber_loyalty_rewards para
// probar el «antes del SQL»).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  LOYALTY_SUFFIX,
  isLoyaltyFreeLine,
  isLoyaltyLine,
  liveStars,
  loyaltyBonusLineDescription,
  loyaltyLineSuffix,
  loyaltyStampsOfLine,
  parseLoyaltyLine,
} from "../loyalty-core";
import {
  LEGACY_BONUS_ID,
  availableBonuses,
  cardSignatureOk,
  cardSlots,
  legacyBonus,
  nextBonus,
  normalizeBonusInput,
  parseCardToken,
  signCardToken,
  type StarBonus,
} from "../stars-core";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

// ═══════════════════════════════════════════════════════════════════════
// 0. Puro
// ═══════════════════════════════════════════════════════════════════════

const bonus = (id: string, cost: number, extra: Partial<StarBonus> = {}): StarBonus => ({
  id, name: id, cost, kind: "service", serviceId: null, serviceName: null, amount: null, percent: null,
  description: null, active: true, sortOrder: 0, ...extra,
});

test("marcas de canje: las de siempre siguen valiendo y las nuevas dicen qué bono y cuántas estrellas", () => {
  assert.equal(loyaltyStampsOfLine(`Corte${LOYALTY_SUFFIX}`), 10);
  assert.equal(loyaltyStampsOfLine(`Corte${loyaltyLineSuffix(5)}`), 5);
  const d = loyaltyBonusLineDescription("discount", "20% en tu corte", 8);
  assert.equal(d, "Bono: 20% en tu corte · Descuento (lealtad · 8 estrellas)");
  assert.deepEqual(parseLoyaltyLine(d), { kind: "discount", stars: 8, bonusName: "20% en tu corte", head: "Bono: 20% en tu corte" });
  const g = loyaltyBonusLineDescription("gift", "Gorra", 1);
  assert.equal(g, "Bono: Gorra · Regalo (lealtad · 1 estrella)");
  assert.equal(loyaltyStampsOfLine(g), 1);
  assert.equal(isLoyaltyLine(g), true);
  assert.equal(isLoyaltyFreeLine(g), false, "un regalo no es un corte cubierto (comisiones)");
  assert.equal(isLoyaltyFreeLine(`Corte${LOYALTY_SUFFIX}`), true);
  assert.equal(parseLoyaltyLine("Descuento"), null);
  assert.equal(parseLoyaltyLine("Bono: x · Descuento (lealtad · 3 estrellas) y más"), null, "solo como sufijo");
});

test("la fórmula única: visitas + a mano − canjes, nunca negativa", () => {
  const prefs = { __stars: { net: 2, entries: [] }, __loyalty: { redeemedVisits: 5 } };
  assert.equal(liveStars({ visits: 7, preferences: prefs, cashRedeemedStamps: 1 }), 3);
  assert.equal(liveStars({ visits: 0, preferences: { __stars: { net: -3 } }, cashRedeemedStamps: 0 }), 0);
  assert.equal(liveStars({ visits: 4, preferences: null, cashRedeemedStamps: 0 }), 4);
});

test("siguiente bono, disponibles y estrellas dibujadas", () => {
  const list = [bonus("b10", 10), bonus("b5", 5), bonus("off", 3, { active: false })];
  assert.deepEqual(nextBonus(3, list)?.bonus.id, "b5");
  assert.equal(nextBonus(3, list)?.remaining, 2);
  assert.equal(nextBonus(7, list)?.bonus.id, "b10");
  assert.equal(nextBonus(12, list), null);
  assert.deepEqual(availableBonuses(7, list).map((b) => b.id), ["b5"], "el inactivo no cuenta");
  assert.equal(cardSlots(3, list), 5, "se dibuja hasta el siguiente");
  assert.equal(cardSlots(7, list), 10);
  assert.equal(cardSlots(14, list), 14, "con todo alcanzado: hasta sus estrellas");
  const legacy = legacyBonus({ enabled: true, threshold: 7, reward: "Barba gratis" });
  assert.equal(legacy.id, LEGACY_BONUS_ID);
  assert.equal(legacy.cost, 7);
  assert.equal(legacy.kind, "service");
  assert.equal(legacy.serviceId, null, "el premio de siempre: el servicio que se elija en caja");
});

test("validación de un bono: nombre, 1–100 estrellas, qué da y servicio de la MISMA barbería", () => {
  const mine = new Set(["s1"]);
  assert.deepEqual(normalizeBonusInput({ name: " Corte  gratis ", cost: 10, kind: "service", serviceId: "s1" }, 0, mine), {
    id: null, name: "Corte gratis", cost: 10, kind: "service", serviceId: "s1", amount: null, percent: null, description: null, active: true,
  });
  assert.equal(normalizeBonusInput({ name: "x", cost: 4, kind: "amount", amount: "50.555" }, 0, mine).amount, 50.56);
  assert.equal(normalizeBonusInput({ name: "x", cost: 4, kind: "percent", percent: 15 }, 0, mine).percent, 15);
  assert.equal(normalizeBonusInput({ name: "x", cost: 4, kind: "other", description: "Gorra" }, 0, mine).description, "Gorra");
  assert.throws(() => normalizeBonusInput({ name: "", cost: 4, kind: "other", description: "a" }, 0, mine), /nombre/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 0, kind: "service" }, 0, mine), /1 a 100/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 101, kind: "service" }, 0, mine), /1 a 100/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 5, kind: "service", serviceId: "ajeno" }, 0, mine), /no es de tu barbería/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 5, kind: "amount", amount: 0 }, 0, mine), /descuento/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 5, kind: "percent", percent: 150 }, 0, mine), /porcentaje/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 5, kind: "other", description: " " }, 0, mine), /qué se lleva/);
  assert.throws(() => normalizeBonusInput({ name: "x", cost: 5, kind: "regalo" }, 0, mine), /qué da/);
});

test("enlace de la tarjeta: firmado por barbería y cliente, no se adivina ni se presta", () => {
  const tok = signCardToken("shopA", "clienteAna123", 0);
  const parsed = parseCardToken(tok);
  assert.ok(parsed);
  assert.equal(parsed.clientId, "clienteAna123");
  assert.equal(cardSignatureOk(parsed, "shopA"), true);
  assert.equal(cardSignatureOk(parsed, "shopB"), false, "de otra barbería no cuadra");
  const forged = parseCardToken(tok.replace("clienteAna123", "clienteBeto99"));
  assert.ok(forged);
  assert.equal(cardSignatureOk(forged, "shopA"), false, "cambiar el cliente rompe la firma");
  const v1 = parseCardToken(signCardToken("shopA", "clienteAna123", 1));
  assert.notEqual(v1?.mac, parsed.mac, "otra versión = otra firma (revocar sirve)");
  assert.equal(parseCardToken("basura"), null);
  assert.equal(parseCardToken(`${"a".repeat(10)}.0.${"b".repeat(31)}`), null);
});

// ═══════════════════════════════════════════════════════════════════════
// Integración
// ═══════════════════════════════════════════════════════════════════════

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
let portal: typeof import("@/lib/barber/client-portal");
let starsCore: typeof import("../stars-core");

const RUN = `e${Date.now().toString(36)}`;
const DAY = 86_400_000;
const MIN = 60_000;

interface Shop {
  id: string;
  slug: string;
  ctx: BarberContext;
  barberId: string;
  serviceId: string;
  beardId: string;
}
let A: Shop; // premio de siempre: 5 estrellas, «Barba gratis»
let B: Shop; // otra barbería
let phoneSeq = 0;

async function makeShop(tag: string, loyalty: { threshold?: number; reward?: string } = {}): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "PROFESIONAL", subscriptionStatus: "active",
      timezone: "America/Mexico_City",
      ...(loyalty.threshold ? { loyaltyThreshold: loyalty.threshold } : {}),
      ...(loyalty.reward ? { loyaltyReward: loyalty.reward } : {}),
    },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${tag}-owner`, email: `${RUN}-${tag}@test.local`, firstName: "Dueña", lastName: tag, role: "OWNER" },
  });
  const barber = await prisma.barber.create({
    data: { barbershopId: shop.id, name: `Barbero ${tag}`, commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) },
  });
  const service = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) },
  });
  const beard = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Barba", durationMin: 20, price: new Prisma.Decimal(120) },
  });
  return {
    id: shop.id,
    slug: shop.slug,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    barberId: barber.id,
    serviceId: service.id,
    beardId: beard.id,
  };
}

async function staffCtx(shop: Shop, role: "RECEPTION" | "BARBER" | "MANAGER", barberId: string | null = null): Promise<BarberContext> {
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id, supabaseId: `${RUN}-${shop.slug}-${role}-${phoneSeq++}`, email: `${RUN}-${role}-${phoneSeq}@test.local`,
      firstName: role === "RECEPTION" ? "Rita" : role === "BARBER" ? "Beto" : "Mara", lastName: "Staff", role, barberId,
    },
  });
  const barber = barberId ? await prisma.barber.findUnique({ where: { id: barberId } }) : null;
  return { barberUserId: user.id, barbershopId: shop.id, barbershop: A.ctx.barbershop.id === shop.id ? A.ctx.barbershop : B.ctx.barbershop, user, barber, role };
}

async function newClient(shop: Shop, name: string, portalEnabled = true): Promise<string> {
  const phone = `55${(Date.now() % 1e6).toString().padStart(6, "0")}${(phoneSeq++ % 100).toString().padStart(2, "0")}`;
  return (await prisma.barberClient.create({ data: { barbershopId: shop.id, name: `${name} ${RUN}`, phone, portalEnabled } })).id;
}

async function appt(shop: Shop, clientId: string, status: "DONE" | "CANCELLED" | "NO_SHOW", daysAgo: number, serviceId = shop.serviceId) {
  const start = new Date(Date.now() - daysAgo * DAY);
  return prisma.barberAppointment.create({
    data: {
      barbershopId: shop.id, clientId, status, startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId, priceAtBooking: new Prisma.Decimal(200) }] },
    },
  });
}

const walkIn = (shop: Shop, clientId: string, extra: Record<string, unknown> = {}, ctx: BarberContext = shop.ctx) =>
  cash.createSale(ctx, { barberId: shop.barberId, clientId, items: [{ kind: "service", id: shop.serviceId }], paymentMethod: "CASH", ...extra }, FEATURES);

const view = (shop: Shop, clientId: string, audience: "client" | "staff" = "client") =>
  starsCore.loadStarsView(prisma, { barbershopId: shop.id, clientId, audience });

const SQL_FILE = path.join(ROOT, "sql/barber_estrellas.sql");

async function applyStarsSql() {
  await prisma.$executeRawUnsafe(fs.readFileSync(SQL_FILE, "utf8").replace(/^\s*--.*$/gm, ""));
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  caja = await import("@/lib/barber/commissions");
  portal = await import("@/lib/barber/client-portal");
  starsCore = await import("../stars-core");

  // Empieza SIN la tabla de bonos: así está producción antes de pegar el SQL.
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "barber_loyalty_rewards"`);

  A = await makeShop("A", { threshold: 5, reward: "Barba gratis" });
  B = await makeShop("B");
  await cash.openCashSession(A.ctx, { openingAmount: 0 });
  await cash.openCashSession(B.ctx, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: { in: ids } } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ── 1. Mis estrellas ───────────────────────────────────────────────────

test("1 · la tarjeta: estrellas frescas, siguiente bono y cuál, y el porqué de cada visita sin estrella", { skip }, async () => {
  const ana = await newClient(A, "Ana");
  await appt(A, ana, "DONE", 30);
  await appt(A, ana, "DONE", 25);
  await appt(A, ana, "CANCELLED", 20);
  await appt(A, ana, "NO_SHOW", 15);
  await walkIn(A, ana);
  const anulada = await walkIn(A, ana);
  await cash.cancelSale(A.ctx, anulada.id, { reason: "error" });

  const v = await view(A, ana);
  assert.ok(v);
  assert.equal(v.enabled, true);
  assert.equal(v.firstName, "Ana");
  assert.equal(v.stars, 3, "2 citas completadas + 1 cobrada en caja");
  assert.equal(v.next?.bonus.name, "Barba gratis", "el premio de siempre es el primer bono");
  assert.equal(v.next?.remaining, 2, "«Te faltan 2 para: Barba gratis»");
  assert.equal(v.slots, 5);
  assert.deepEqual(v.available, []);

  const reasons = v.history.map((e) => `${e.reason}:${e.delta}`).sort();
  assert.deepEqual(reasons, [
    "appointment:1", "appointment:1", "cancelled:0", "no_show:0", "ticket_cancelled:0", "walkin:1",
  ]);
  assert.equal(v.history.reduce((s, e) => s + e.delta, 0), v.stars, "el historial suma lo que dice la tarjeta");
  assert.ok(v.history.every((e) => e.note === undefined && e.by === undefined), "al cliente no le llegan motivos ni nombres del personal");

  // «Mi cuenta» trae la misma tarjeta.
  const payload = await portal.loadPortalData({ barbershopId: A.id, clientId: ana });
  assert.equal(payload?.stars?.stars, 3);
  assert.equal(payload?.stars?.next?.remaining, 2);

  // Otra barbería no la ve.
  assert.equal(await view(B, ana), null);
});

test("1 · cobrar la cita y cancelar su ticket le quita la estrella (y volver a cobrar la devuelve)", { skip }, async () => {
  const leo = await newClient(A, "Leo");
  const a = await appt(A, leo, "DONE", 1);
  assert.equal((await view(A, leo))?.stars, 1, "cita completada sin cobrar: cuenta (barberías sin caja)");
  const sale = await cash.createSale(A.ctx, { appointmentId: a.id, items: [{ kind: "service", id: A.serviceId }], paymentMethod: "CASH" }, FEATURES);
  assert.equal((await view(A, leo))?.stars, 1);
  await cash.cancelSale(A.ctx, sale.id, { reason: "error" });
  const v = await view(A, leo);
  assert.equal(v?.stars, 0, "ticket cancelado → sin estrella");
  assert.equal(v?.history[0].reason, "ticket_cancelled");
  await cash.createSale(A.ctx, { appointmentId: a.id, items: [{ kind: "service", id: A.serviceId }], paymentMethod: "CASH" }, FEATURES);
  assert.equal((await view(A, leo))?.stars, 1, "cobrada otra vez: la estrella vuelve");
});
