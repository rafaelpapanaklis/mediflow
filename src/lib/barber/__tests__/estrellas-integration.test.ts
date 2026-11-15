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

/** Pega el SQL como lo haría Rafael: sentencia por sentencia, tal cual. */
async function applyStarsSql() {
  const sql = fs.readFileSync(SQL_FILE, "utf8").replace(/^\s*--.*$/gm, "");
  for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(stmt);
  }
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

test("RONDA 2 · M2: la regla no es retroactiva — un ticket cancelado ANTES del 15-nov no le quita la estrella a nadie", { skip }, async () => {
  const viejo = await newClient(A, "Viejo");
  const a = await appt(A, viejo, "DONE", 60);
  await prisma.barberSale.create({
    data: {
      barbershopId: A.id, appointmentId: a.id, clientId: viejo, subtotal: 0, tip: 0, total: 0, paymentMethod: "CASH",
      soldByUserId: A.ctx.barberUserId,
      notes: "[CANCELADA] 2026-10-01T15:00:00.000Z · Dueña A · error · Original: Corte · subtotal 200.00 · propina 0.00 · total 200.00 (CASH)",
    },
  });
  const v = await view(A, viejo);
  assert.equal(v?.stars, 1, "contaba ayer y sigue contando hoy");
  assert.equal(v?.history.find((e) => e.id === `a-${a.id}`)?.delta, 1, "y el historial dice lo mismo");
  const hit = (await cash.lookupClients(A.ctx, `Viejo ${RUN}`))[0];
  assert.equal(hit.loyaltyCount, 1, "Caja recuenta igual");
});

// ── Piezas que se cargan solo cuando hacen falta (puntos 2–6) ───────────

const load = async () => ({
  stars: await import("@/lib/barber/stars"),
  starsRoute: await import("@/app/api/barber/clients/[id]/stars/route"),
  bonosRoute: await import("@/app/api/barber/clients/bonos/route"),
});

const isStarsError = (code: string) => (e: unknown) =>
  !!e && typeof e === "object" && (e as { code?: string }).code === code;
const forbidden = (e: unknown) => e instanceof BarberForbiddenError;

async function withStars(shop: Shop, name: string, n: number): Promise<string> {
  const id = await newClient(shop, name);
  for (let i = 0; i < n; i++) await appt(shop, id, "DONE", 40 + i);
  return id;
}

// ── 2. Enlace personal ─────────────────────────────────────────────────

test("2 · el enlace abre SOLO la tarjeta de ese cliente, no sirve en otra barbería y se revoca", { skip }, async () => {
  const { stars } = await load();
  const rita = await staffCtx(A, "RECEPTION");
  const eva = await withStars(A, "Eva María", 2);
  const otro = await withStars(A, "Otro", 1);

  const link = await stars.getClientCardLink(rita, eva);
  assert.match(link.path, new RegExp(`^/b/${A.slug}/tarjeta/`));
  const token = link.path.split("/").pop() as string;

  assert.deepEqual(await starsCore.resolveCardToken(prisma, A.id, token), { clientId: eva });
  assert.equal(await starsCore.resolveCardToken(prisma, B.id, token), null, "en otra barbería no abre");
  const otherTok = (await stars.getClientCardLink(rita, otro)).path.split("/").pop() as string;
  const mixed = `${eva}.${otherTok.split(".")[1]}.${otherTok.split(".")[2]}`;
  assert.equal(await starsCore.resolveCardToken(prisma, A.id, mixed), null, "la firma de otro cliente no sirve");

  const v = await view(A, eva);
  assert.equal(v?.firstName, "Eva", "solo el nombre de pila");
  const { phone } = await prisma.barberClient.findUniqueOrThrow({ where: { id: eva }, select: { phone: true } });
  assert.equal(JSON.stringify(v).includes(phone), false, "ni rastro del teléfono");
  assert.equal(JSON.stringify(v).includes("María"), false, "ni del apellido / segundo nombre");

  const fresh = await stars.revokeClientCard(rita, eva);
  assert.equal(await starsCore.resolveCardToken(prisma, A.id, token), null, "revocado: el enlace viejo ya no abre");
  assert.deepEqual(await starsCore.resolveCardToken(prisma, A.id, fresh.path.split("/").pop()), { clientId: eva });

  await prisma.barberClient.update({ where: { id: eva }, data: { blockedAt: new Date() } });
  assert.equal(await starsCore.resolveCardToken(prisma, A.id, fresh.path.split("/").pop()), null, "cliente bloqueado: no abre");
  await prisma.barberClient.update({ where: { id: eva }, data: { blockedAt: null } });

  const beto = await staffCtx(A, "BARBER", A.barberId);
  await assert.rejects(stars.getClientCardLink(beto, eva), forbidden, "el rol Barbero no saca enlaces");
});

// ── 3. Bonos de la barbería ────────────────────────────────────────────

test("3 · antes del SQL: el premio de siempre es el único bono y se puede renombrar; crear más pide el SQL", { skip }, async () => {
  const { stars } = await load();
  const cat = await starsCore.loadBonusCatalog(prisma, A.id);
  assert.equal(cat.tableReady, false);
  assert.equal(cat.legacy, true);
  assert.deepEqual(cat.bonuses.map((b) => [b.id, b.name, b.cost]), [["premio", "Barba gratis", 5]]);

  await assert.rejects(
    stars.saveBonusCatalog(A.ctx, [
      { id: "premio", name: "Barba gratis", cost: 5, kind: "service" },
      { name: "Cera", cost: 2, kind: "other", description: "Cera" },
    ]),
    isStarsError("SQL_PENDIENTE"),
  );
  await stars.saveBonusCatalog(A.ctx, [{ id: "premio", name: "Barba de regalo", cost: 6, kind: "service" }]);
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: A.id }, select: { loyaltyThreshold: true, loyaltyReward: true } });
  assert.deepEqual(shop, { loyaltyThreshold: 6, loyaltyReward: "Barba de regalo" });
  await stars.saveBonusCatalog(A.ctx, [{ id: "premio", name: "Barba gratis", cost: 5, kind: "service" }]);
});

test("3 · el SQL (dos veces) convierte el premio en el primer bono sin mover una sola estrella", { skip }, async () => {
  const fiel = await withStars(A, "Fiel", 4);
  const before = (await view(A, fiel))?.stars;
  await applyStarsSql();
  await applyStarsSql();
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; cost: number; kind: string }>>`
    SELECT "id", "name", "cost", "kind" FROM "barber_loyalty_rewards" WHERE "barbershopId" = ${A.id}`;
  assert.deepEqual(rows, [{ id: `premio-${A.id}`, name: "Barba gratis", cost: 5, kind: "service" }], "uno solo aunque se pegue dos veces");
  const cat = await starsCore.loadBonusCatalog(prisma, A.id);
  assert.equal(cat.tableReady, true);
  assert.equal(cat.legacy, false);
  const after = await view(A, fiel);
  assert.equal(after?.stars, before, "nadie pierde estrellas");
  assert.equal(after?.next?.bonus.name, "Barba gratis");
});

test("3 · varios bonos: servicio, pesos, %, otro; activo/inactivo; el más barato queda como «el premio»", { skip }, async () => {
  const { bonosRoute } = await load();
  const seeded = `premio-${A.id}`;
  const put = (ctx: BarberContext, bonuses: unknown) => {
    session = ctx;
    return bonosRoute.PUT(new Request("http://localhost/api/barber/clients/bonos", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bonuses }),
    }));
  };
  const list = [
    { id: seeded, name: "Corte gratis", cost: 10, kind: "service", serviceId: A.serviceId },
    { name: "Barba gratis", cost: 3, kind: "service", serviceId: A.beardId },
    { name: "$50 menos", cost: 4, kind: "amount", amount: 50 },
    { name: "15% menos", cost: 6, kind: "percent", percent: 15 },
    { name: "Cera", cost: 2, kind: "other", description: "Una cera para el cabello", active: false },
  ];

  const rita = await staffCtx(A, "RECEPTION");
  assert.equal((await put(rita, list)).status, 403, "Recepción cobra, pero no crea bonos");
  const bad = await put(A.ctx, [{ name: "x", cost: 4, kind: "service", serviceId: B.serviceId }]);
  assert.equal(bad.status, 400, "un servicio de otra barbería no se puede regalar");

  const ok = await put(A.ctx, list);
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { catalog: { bonuses: StarBonus[] } };
  assert.deepEqual(
    body.catalog.bonuses.map((b) => [b.name, b.cost, b.kind, b.active]),
    [["Corte gratis", 10, "service", true], ["Barba gratis", 3, "service", true], ["$50 menos", 4, "amount", true],
     ["15% menos", 6, "percent", true], ["Cera", 2, "other", false]],
  );
  assert.equal(body.catalog.bonuses[0].id, seeded, "el premio de siempre se editó, no se duplicó");
  assert.equal(body.catalog.bonuses[1].serviceName, "Barba");
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: A.id }, select: { loyaltyThreshold: true, loyaltyReward: true } });
  assert.deepEqual(shop, { loyaltyThreshold: 3, loyaltyReward: "Barba gratis" }, "el activo más barato, para lo que lee las columnas de siempre");

  const sinPlata = await withStars(A, "Nuevo", 1);
  const v = await view(A, sinPlata);
  assert.equal(v?.next?.bonus.name, "Barba gratis");
  assert.equal(v?.next?.remaining, 2, "«Te faltan 2 para: Barba gratis»");
  assert.equal(v?.catalog.some((b) => b.name === "Cera"), false, "el inactivo no se ofrece");
});

// ── 4. La estrella se VE ───────────────────────────────────────────────

test("4 · Caja: «+1 estrella para X: lleva N de M», y avisa cuando alcanza un bono", { skip }, async () => {
  // Lo mismo que hace POST /api/barber/sales: cobrar y luego armar el resumen.
  const juan = await withStars(A, "Juan Pérez", 2);
  const charged = await walkIn(A, juan);
  const sale = { stars: (await starsCore.saleStarsOutcome(prisma, { barbershopId: A.id, slug: A.slug, saleId: charged.id }))! };
  assert.equal(sale.stars.firstName, "Juan");
  assert.equal(sale.stars.gained, 1);
  assert.equal(sale.stars.stars, 3);
  assert.deepEqual(sale.stars.reached, ["Barba gratis"], "con la tercera alcanza «Barba gratis» (3)");
  assert.deepEqual(sale.stars.next, { name: "$50 menos", cost: 4, remaining: 1 });
  assert.match(sale.stars.cardPath, new RegExp(`^/b/${A.slug}/tarjeta/`));

  const productoSolo = await starsCore.saleStarsOutcome(prisma, { barbershopId: A.id, slug: A.slug, saleId: "no-existe" });
  assert.equal(productoSolo, null);
});

test("4 · dar y quitar estrella a mano: motivo obligatorio, quién y cuándo; nunca por debajo de 0", { skip }, async () => {
  const { stars, starsRoute } = await load();
  const rita = await staffCtx(A, "RECEPTION");
  const lu = await withStars(A, "Lu", 0);

  await assert.rejects(stars.adjustClientStars(rita, { clientId: lu, delta: 1, reason: " " }), isStarsError("REASON_REQUIRED"));
  await assert.rejects(stars.adjustClientStars(rita, { clientId: lu, delta: -1, reason: "error" }), isStarsError("NO_STARS"));
  await assert.rejects(stars.adjustClientStars(rita, { clientId: lu, delta: 5, reason: "regalo" }), isStarsError("INVALID_INPUT"));

  const v = await stars.adjustClientStars(rita, { clientId: lu, delta: 1, reason: "Trajo a un amigo" });
  assert.equal(v.stars, 1);
  assert.equal(v.history[0].kind, "manual");
  assert.equal(v.history[0].note, "Trajo a un amigo");
  assert.equal(v.history[0].by, "Rita Staff");
  const client = await view(A, lu, "client");
  assert.equal(client?.history[0].note, undefined, "el cliente no ve el motivo");
  assert.equal(client?.history[0].by, undefined, "ni quién");

  // Por la ruta, y dos «quitar» a la vez: solo uno pasa (candado).
  session = rita;
  const call = (body: unknown) => starsRoute.POST(new Request(`http://localhost/api/barber/clients/${lu}/stars`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: lu }) });
  const both = await Promise.all([
    call({ action: "adjust", delta: -1, reason: "Se sumó por error" }),
    call({ action: "adjust", delta: -1, reason: "Se sumó por error" }),
  ]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await view(A, lu))?.stars, 0);

  // La lista de clientes y la caja ven lo mismo.
  const hit = (await cash.lookupClients(rita, `Lu ${RUN}`))[0];
  assert.equal(hit.loyaltyCount, 0);

  session = await staffCtx(A, "BARBER", A.barberId);
  assert.equal((await call({ action: "adjust", delta: 1, reason: "quiero" })).status, 403, "Barbero: no cobra, no da estrellas");
});

// ── 5. La barbería aplica el bono ──────────────────────────────────────

test("5 · Caja aplica cada tipo de bono en la misma transacción; cancelar lo devuelve", { skip }, async () => {
  const cat = await starsCore.loadBonusCatalog(prisma, A.id);
  const byName = (n: string) => cat.bonuses.find((b) => b.name === n)!.id;
  const ana = await withStars(A, "Ana Bono", 20);
  const sell = (extra: Record<string, unknown>, items: Array<{ kind: "service" | "product"; id: string }> = [{ kind: "service", id: A.serviceId }]) =>
    cash.createSale(A.ctx, { barberId: A.barberId, clientId: ana, items, paymentMethod: "CASH", ...extra }, FEATURES);

  const hit = (await cash.lookupClients(A.ctx, `Ana Bono ${RUN}`))[0];
  assert.equal(hit.loyaltyCount, 20);
  assert.equal(hit.availableBonusIds.length, 4, "los 4 activos; el inactivo no");

  // Pesos: −$50 y la comisión NO baja (el premio lo paga la barbería).
  const s1 = await sell({ redeemBonusId: byName("$50 menos") });
  assert.equal(s1.total, 150);
  assert.equal(s1.items.at(-1)?.description, "Bono: $50 menos · Descuento (lealtad · 4 estrellas)");
  const c1 = await prisma.barberCommissionEntry.findFirstOrThrow({ where: { saleId: s1.id } });
  assert.equal(Number(c1.base), 200);
  assert.equal((await view(A, ana))?.stars, 20 + 1 - 4);

  // Porcentaje: 15% de $200.
  const s2 = await sell({ redeemBonusId: byName("15% menos") });
  assert.equal(s2.total, 170);
  assert.equal((await view(A, ana))?.stars, 21 - 4 + 1 - 6);

  // Servicio fijo (Barba): sin barba en el ticket no se puede; con barba, gratis solo.
  await assert.rejects(sell({ redeemBonusId: byName("Barba gratis") }), (e: unknown) => e instanceof caja.BarberCajaError && e.code === "BONUS_NEEDS_SERVICE");
  const s3 = await sell({ redeemBonusId: byName("Barba gratis") }, [{ kind: "service", id: A.serviceId }, { kind: "service", id: A.beardId }]);
  assert.equal(s3.total, 200, "el corte se cobra; la barba va gratis");
  assert.ok(s3.items.some((i) => i.description.startsWith("Barba · Gratis (lealtad")));
  const c3 = await prisma.barberCommissionEntry.findFirstOrThrow({ where: { saleId: s3.id } });
  assert.equal(Number(c3.base), 320, "la barba gratis comisiona sobre su precio normal");

  const antes = (await view(A, ana))!.stars;
  await cash.cancelSale(A.ctx, s3.id, { reason: "error" });
  const despues = await view(A, ana);
  assert.equal(despues?.stars, antes - 1 + 3, "cancelar: se va la estrella de la visita y vuelven las 3 del bono");
  assert.ok(despues?.history.some((e) => e.kind === "returned"), "y el historial dice que el bono volvió");

  // Sin estrellas suficientes: no.
  const pobre = await withStars(A, "Pobre", 1);
  await assert.rejects(
    cash.createSale(A.ctx, { clientId: pobre, items: [{ kind: "service", id: A.serviceId }], paymentMethod: "CASH", redeemBonusId: byName("$50 menos") }, FEATURES),
    (e: unknown) => e instanceof caja.BarberCajaError && e.code === "LOYALTY_NOT_ELIGIBLE",
  );
  // Inactivo: no.
  await assert.rejects(sell({ redeemBonusId: byName("Cera") }), (e: unknown) => e instanceof caja.BarberCajaError && e.code === "BONUS_NOT_FOUND");

  // RONDA 2 · M1: sin id (pestaña vieja) se canjea SOLO el premio de siempre
  // (su fila «premio-…», 10 estrellas), nunca «el más barato» de otro tipo…
  const viejo = await sell({ redeemLoyaltyItemIndex: 0 });
  assert.equal(viejo.items[0].description, `Corte${loyaltyLineSuffix(10)}`);
  assert.equal(viejo.total, 0);
  // …y si la barbería lo apagó, sin id no se canjea nada.
  const seeded = starsCore.seededBonusId(A.id);
  await prisma.$executeRaw`UPDATE "barber_loyalty_rewards" SET "active" = false WHERE "id" = ${seeded}`;
  await assert.rejects(sell({ redeemLoyaltyItemIndex: 0 }), (e: unknown) => e instanceof caja.BarberCajaError && e.code === "BONUS_REQUIRED");
  await prisma.$executeRaw`UPDATE "barber_loyalty_rewards" SET "active" = true WHERE "id" = ${seeded}`;
});

test("5 · «Marcar bono como entregado» desde la ficha descuenta y queda en el historial", { skip }, async () => {
  const { stars } = await load();
  const rita = await staffCtx(A, "RECEPTION");
  const pepe = await withStars(A, "Pepe", 5);
  const cat = await starsCore.loadBonusCatalog(prisma, A.id);
  const barba = cat.bonuses.find((b) => b.name === "Barba gratis")!;
  const v = await stars.deliverClientBonus(rita, { clientId: pepe, bonusId: barba.id, note: "Se la llevó para su papá" });
  assert.equal(v.stars, 2);
  assert.equal(v.history[0].reason, "desk");
  assert.equal(v.history[0].detail, "Barba gratis");
  assert.equal(v.usedCount, 1);
  await assert.rejects(stars.deliverClientBonus(rita, { clientId: pepe, bonusId: cat.bonuses.find((b) => b.name === "Corte gratis")!.id }), isStarsError("NOT_ENOUGH_STARS"));
  const beto = await staffCtx(A, "BARBER", A.barberId);
  await assert.rejects(stars.deliverClientBonus(beto, { clientId: pepe, bonusId: barba.id }), forbidden);
});

// ── 6. El Barbero solo ve estrellas de SUS clientes ─────────────────────

test("6 · Barbero: ve la tarjeta de sus clientes, no la de los demás", { skip }, async () => {
  const { stars } = await load();
  const beto = await staffCtx(A, "BARBER", A.barberId);
  const suyo = await newClient(A, "Suyo");
  const start = new Date(Date.now() - 3 * DAY);
  await prisma.barberAppointment.create({
    data: { barbershopId: A.id, clientId: suyo, barberId: A.barberId, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN) },
  });
  const ajeno = await withStars(A, "Ajeno", 2);
  assert.equal((await stars.getStaffStarsView(beto, suyo))?.stars, 1);
  assert.equal(await stars.getStaffStarsView(beto, ajeno), null);
  assert.equal(await stars.getStaffStarsView(B.ctx, suyo), null, "otra barbería, tampoco");
});

// ── RONDA 2 · M3: nadie pisa una estrella a mano ni un enlace revocado ──

/**
 * Deja escrita (sin confirmar) una llave reservada dentro de una transacción
 * con la fila tomada, lanza `other` mientras tanto y confirma después. Con el
 * código viejo `other` leía el JSON de antes y, al escribirlo entero, borraba
 * lo que acababa de confirmarse.
 */
async function raceAgainst(clientId: string, key: string, value: unknown, other: () => Promise<unknown>) {
  let pending: Promise<unknown> | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "barber_clients" WHERE "id" = ${clientId} FOR UPDATE`;
    await tx.$executeRaw`
      UPDATE "barber_clients"
      SET "preferences" = jsonb_set(COALESCE("preferences", '{}'::jsonb), ARRAY[${key}::text], ${JSON.stringify(value)}::jsonb, true)
      WHERE "id" = ${clientId}`;
    pending = other();
    await new Promise((r) => setTimeout(r, 400));
  });
  await pending;
}

test("RONDA 2 · M3: guardar preferencias, bloquear o anotar campañas ya no borra estrellas ni revocaciones", { skip }, async () => {
  const clients = await import("@/lib/barber/clients");
  const campaigns = await import("@/lib/barber/campaigns");
  const ines = await withStars(A, "Inés", 2);

  await raceAgainst(ines, "__stars", { net: 1, entries: [] }, () =>
    clients.saveClientPreferences(A.ctx, ines, { fade: "medio" }));
  let prefs = (await prisma.barberClient.findUniqueOrThrow({ where: { id: ines }, select: { preferences: true } })).preferences as Record<string, unknown>;
  assert.deepEqual(prefs.__stars, { net: 1, entries: [] }, "la estrella dada a mano sobrevive");
  assert.equal(prefs.fade, "medio", "y la preferencia se guardó");

  await raceAgainst(ines, "__card", { v: 3 }, () => clients.setBarberClientBlocked(A.ctx, ines, true, "no llega"));
  prefs = (await prisma.barberClient.findUniqueOrThrow({ where: { id: ines }, select: { preferences: true } })).preferences as Record<string, unknown>;
  assert.deepEqual(prefs.__card, { v: 3 }, "el enlace revocado sigue revocado");
  assert.ok(prefs.__block, "y el bloqueo quedó anotado");
  assert.equal(prefs.fade, "medio");
  await clients.setBarberClientBlocked(A.ctx, ines, false);

  await raceAgainst(ines, "__stars", { net: 2, entries: [] }, () =>
    campaigns.setBarberCampaignOptOut(A.ctx, { clientId: ines, optOut: true }));
  prefs = (await prisma.barberClient.findUniqueOrThrow({ where: { id: ines }, select: { preferences: true } })).preferences as Record<string, unknown>;
  assert.deepEqual(prefs.__stars, { net: 2, entries: [] });
  assert.ok(prefs.__optout, "la baja de campañas quedó");
  assert.equal(prefs.__block, undefined, "desbloquear quitó solo __block");
});
