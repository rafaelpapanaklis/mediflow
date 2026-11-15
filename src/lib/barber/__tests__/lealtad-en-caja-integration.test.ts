// Lealtad: sellos al día y con la regla de la barbería (G5 de la auditoría
// ws6-t3).
//
// Antes: nadie llamaba al gancho de lealtad. Los sellos solo se refrescaban
// al abrir Clientes, así que la caja y «mi cuenta» leían un contador viejo
// («0 de 10» veinte segundos después de completar y cobrar), y la caja usaba
// 10 sellos fijos aunque la barbería hubiera puesto otro número.
//
// Aquí, contra Postgres REAL y con la ruta de verdad:
//   · POST …/appointments/[id]/status → DONE sube el sello en el acto;
//   · cobrar y cancelar un ticket lo actualizan en la misma transacción;
//   · la caja y «mi cuenta» leen el dato recontado, no la caché;
//   · umbral, premio y encendido son los que configuró la barbería.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/lealtad-en-caja-integration.test.ts
//
// La primera parte es pura; la integración se SALTA sin DATABASE_URL. JAMÁS
// apuntarla a producción: crea barberías.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  LOYALTY_SUFFIX,
  clampLoyaltyThreshold,
  isLoyaltyLine,
  ledgerRedeemedVisits,
  loyaltyLineSuffix,
  loyaltyStampsOfLine,
  toLoyaltyRule,
} from "../loyalty-core";

// Solo contra una base LOCAL: ver _base-local.ts (crean y borran barberías).
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

// ═══════════════════════════════════════════════════════════════════════
// 0. Puro: la regla y la marca del canje
// ═══════════════════════════════════════════════════════════════════════

test("la línea canjeada guarda cuántos sellos costó; la histórica vale 10", () => {
  assert.equal(loyaltyLineSuffix(10), LOYALTY_SUFFIX, "con 10 sellos el ticket se ve igual que siempre");
  assert.equal(loyaltyLineSuffix(5), " · Gratis (lealtad · 5 sellos)");
  assert.equal(loyaltyLineSuffix(1), " · Gratis (lealtad · 1 sello)");
  assert.equal(loyaltyStampsOfLine("Corte · Gratis (lealtad)"), 10);
  assert.equal(loyaltyStampsOfLine(`Corte${loyaltyLineSuffix(5)}`), 5);
  assert.equal(loyaltyStampsOfLine(`Corte${loyaltyLineSuffix(1)}`), 1);
  assert.equal(loyaltyStampsOfLine("Corte"), null);
  assert.equal(loyaltyStampsOfLine("Corte · Gratis (lealtad) y algo más"), null, "solo cuenta como sufijo");
  assert.equal(isLoyaltyLine("Corte · Membresía"), false);
});

test("la regla sale de la barbería: umbral recortado a 1–100, premio nunca vacío, apagado se respeta", () => {
  assert.deepEqual(toLoyaltyRule({ loyaltyEnabled: true, loyaltyThreshold: 5, loyaltyReward: " Barba gratis " }), {
    enabled: true, threshold: 5, reward: "Barba gratis",
  });
  assert.deepEqual(toLoyaltyRule({ loyaltyEnabled: false, loyaltyThreshold: 500, loyaltyReward: "" }), {
    enabled: false, threshold: 100, reward: "Corte gratis",
  });
  assert.deepEqual(toLoyaltyRule(null), { enabled: true, threshold: 10, reward: "Corte gratis" });
  assert.equal(clampLoyaltyThreshold(0), 1);
  assert.equal(clampLoyaltyThreshold("x"), 10);
  assert.equal(ledgerRedeemedVisits({ __loyalty: { redeemedVisits: 7 } }), 7);
  assert.equal(ledgerRedeemedVisits({ fade: "medio" }), 0);
});

// ═══════════════════════════════════════════════════════════════════════
// Integración — con la sesión simulada y TODO lo demás real
// ═══════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;

/** La «sesión» de la ruta: quien esté aquí es quien llama. */
let session: BarberContext | null = null;

const DOUBLES = new Map<string, unknown>([
  [
    abs("src/lib/barber-auth.ts"),
    {
      __esModule: true,
      getBarberContext: async () => session,
      // El MISMO assert que el real (permissions.ts), sin Supabase detrás.
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
  // __esModule: cash.ts lo carga con import() dinámico y desestructura el export.
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
    /* que lo resuelva (o falle) el cargador original */
  }
  return originalLoad.call(this, request, parent, isMain);
};

let prisma: typeof import("@/lib/prisma")["prisma"];
let cash: typeof import("@/lib/barber/cash");
let caja: typeof import("@/lib/barber/commissions");
let portal: typeof import("@/lib/barber/client-portal");
let core: typeof import("../loyalty-core");
let statusRoute: typeof import("@/app/api/barber/appointments/[id]/status/route");

const RUN = `l${Date.now().toString(36)}`;
const DAY = 86_400_000;
const MIN = 60_000;

interface Shop {
  id: string;
  ctx: BarberContext;
  barberId: string;
  serviceId: string;
}
let A: Shop; // umbral 5, premio «Barba gratis»
let B: Shop; // por defecto: 10 sellos
let ana: string; // cliente de A
let beto: string; // cliente de B

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
    data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) },
  });
  return {
    id: shop.id,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    barberId: barber.id,
    serviceId: service.id,
  };
}

/** `n` visitas ya completadas hace semanas (sin barbero: no estorban a la agenda). */
async function pastVisits(shop: Shop, clientId: string, n: number, offsetDays = 20) {
  for (let i = 0; i < n; i++) {
    const start = new Date(Date.now() - (offsetDays + i) * DAY);
    await prisma.barberAppointment.create({
      data: { barbershopId: shop.id, clientId, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN) },
    });
  }
}

const column = async (clientId: string) =>
  (await prisma.barberClient.findUniqueOrThrow({ where: { id: clientId }, select: { loyaltyCount: true, totalVisits: true } }));

const codeIs = (code: string) => (e: unknown) => e instanceof caja.BarberCajaError && e.code === code;

const walkIn = (shop: Shop, clientId: string, extra: Record<string, unknown> = {}) =>
  cash.createSale(shop.ctx, { barberId: shop.barberId, clientId, items: [{ kind: "service", id: shop.serviceId }], paymentMethod: "CASH", ...extra }, FEATURES);

async function lookup(shop: Shop, name: string) {
  const hits = await cash.lookupClients(shop.ctx, name);
  assert.equal(hits.length, 1, `un cliente llamado ${name}`);
  return hits[0];
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  caja = await import("@/lib/barber/commissions");
  portal = await import("@/lib/barber/client-portal");
  core = await import("../loyalty-core");
  statusRoute = await import("@/app/api/barber/appointments/[id]/status/route");

  A = await makeShop("A", { threshold: 5, reward: "Barba gratis" });
  B = await makeShop("B");
  ana = (await prisma.barberClient.create({ data: { barbershopId: A.id, name: `Ana ${RUN}`, phone: `551${Date.now().toString().slice(-7)}`, portalEnabled: true } })).id;
  beto = (await prisma.barberClient.create({ data: { barbershopId: B.id, name: `Beto ${RUN}`, phone: `552${Date.now().toString().slice(-7)}` } })).id;
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

// ── La caja lee el dato fresco y la regla de la barbería ───────────────

test("la caja recuenta los sellos al leer (no usa la caché) y muestra el umbral y el premio de la barbería", { skip }, async () => {
  await pastVisits(A, ana, 3);
  // La caché está vieja: nadie ha abierto Clientes.
  assert.equal((await column(ana)).loyaltyCount, 0);

  const hit = await lookup(A, `Ana ${RUN}`);
  assert.equal(hit.loyaltyCount, 3, "3 visitas reales → 3 sellos, aunque la columna dijera 0");
  assert.equal(hit.loyaltyEligible, false, "3 de 5");
  assert.equal((await column(ana)).loyaltyCount, 3, "y de paso la caché queda al día");

  const checkout = await cash.getCheckoutContext(A.ctx, FEATURES);
  assert.equal(checkout.loyaltyTarget, 5, "el umbral de ESTA barbería, no 10");
  assert.equal(checkout.loyaltyReward, "Barba gratis");
  assert.equal(checkout.loyaltyEnabled, true);

  const checkoutB = await cash.getCheckoutContext(B.ctx, FEATURES);
  assert.equal(checkoutB.loyaltyTarget, 10, "la barbería que no tocó nada sigue con 10");
  assert.equal(checkoutB.loyaltyReward, "Corte gratis");
});

// ── El gancho al completar la visita (la ruta real) ────────────────────

test("POST …/status → Completada: el sello sube en el acto, sin abrir Clientes", { skip }, async () => {
  const start = new Date(Date.now() - 50 * MIN);
  const appt = await prisma.barberAppointment.create({
    data: {
      barbershopId: A.id, clientId: ana, barberId: A.barberId, status: "IN_PROGRESS", startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId: A.serviceId, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  assert.equal((await column(ana)).loyaltyCount, 3);

  session = A.ctx;
  const res = await statusRoute.POST(
    new Request(`http://localhost/api/barber/appointments/${appt.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "DONE", branchId: A.id }),
    }),
    { params: Promise.resolve({ id: appt.id }) },
  );
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { appointment: { status: string } }).appointment.status, "DONE");

  const after = await column(ana);
  assert.equal(after.loyaltyCount, 4, "la columna ya dice 4 nada más completar");
  assert.equal(after.totalVisits, 4);

  // Y cobrar esa visita no suma un sello de más (la visita es la cita, no el ticket).
  await cash.createSale(A.ctx, { appointmentId: appt.id, items: [{ kind: "service", id: A.serviceId }], paymentMethod: "CASH" }, FEATURES);
  assert.equal((await column(ana)).loyaltyCount, 4);
});

test("sin sesión la ruta responde 401 y no toca nada", { skip }, async () => {
  session = null;
  const res = await statusRoute.POST(
    new Request("http://localhost/api/barber/appointments/x/status", { method: "POST", body: JSON.stringify({ to: "DONE" }) }),
    { params: Promise.resolve({ id: "x" }) },
  );
  assert.equal(res.status, 401);
});

// ── Cobrar y cancelar ──────────────────────────────────────────────────

let fifth: string;

test("cobrar a un cliente sin cita (mostrador) suma su sello en la misma transacción; cancelar lo quita", { skip }, async () => {
  const sale = await walkIn(A, ana);
  fifth = sale.id;
  assert.equal((await column(ana)).loyaltyCount, 5, "4 + la visita de mostrador");
  assert.equal((await lookup(A, `Ana ${RUN}`)).loyaltyEligible, true, "5 de 5: premio listo");

  await cash.cancelSale(A.ctx, sale.id, { reason: "se cobró mal" });
  assert.equal((await column(ana)).loyaltyCount, 4, "el ticket cancelado deja de contar");
  assert.equal((await lookup(A, `Ana ${RUN}`)).loyaltyEligible, false);

  fifth = (await walkIn(A, ana)).id;
  assert.equal((await column(ana)).loyaltyCount, 5);
});

test("canje con el umbral de la barbería (5): servicio en $0, la línea dice 5 sellos; cancelar los devuelve", { skip }, async () => {
  const sale = await walkIn(A, ana, { redeemLoyaltyItemIndex: 0 });
  assert.equal(sale.total, 0);
  assert.equal(sale.items[0].description, `Corte${loyaltyLineSuffix(5)}`);
  // 6 visitas (5 + esta) − 5 canjeados = 1.
  assert.equal((await column(ana)).loyaltyCount, 1);
  assert.equal((await lookup(A, `Ana ${RUN}`)).loyaltyEligible, false);

  // Con 1 sello no hay segundo premio, y el mensaje habla de 5, no de 10.
  await assert.rejects(walkIn(A, ana, { redeemLoyaltyItemIndex: 0 }), (e: unknown) => {
    assert.ok(codeIs("LOYALTY_NOT_ELIGIBLE")(e));
    // ws6-t5: la caja ya habla de ESTRELLAS y nombra el bono.
    assert.match((e as Error).message, /1 de 5 estrellas/);
    return true;
  });

  await cash.cancelSale(A.ctx, sale.id, { reason: "se equivocó de cliente" });
  assert.equal((await column(ana)).loyaltyCount, 5, "vuelven los 5 sellos y deja de contar esa visita");
});

test("dos canjes SIMULTÁNEOS del mismo premio: uno entra, el otro «no le alcanzan los sellos»", { skip }, async () => {
  const results = await Promise.allSettled([
    walkIn(A, ana, { redeemLoyaltyItemIndex: 0 }),
    walkIn(A, ana, { redeemLoyaltyItemIndex: 0 }),
    walkIn(A, ana, { redeemLoyaltyItemIndex: 0 }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof walkIn>>>[];
  assert.equal(ok.length, 1, "un solo premio por cada 5 sellos");
  assert.ok((results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).every((r) => codeIs("LOYALTY_NOT_ELIGIBLE")(r.reason)));
  assert.equal((await column(ana)).loyaltyCount, 1);
});

test("si la barbería sube el umbral, los canjes viejos siguen costando lo que costaron", { skip }, async () => {
  // Ana: 6 visitas, 5 canjeados (a umbral 5). La barbería pasa a 8 sellos.
  await prisma.barbershop.update({ where: { id: A.id }, data: { loyaltyThreshold: 8 } });
  const hit = await lookup(A, `Ana ${RUN}`);
  assert.equal(hit.loyaltyCount, 1, "no se le restan 8 por un canje que costó 5");
  assert.equal((await cash.getCheckoutContext(A.ctx, FEATURES)).loyaltyTarget, 8);
  await prisma.barbershop.update({ where: { id: A.id }, data: { loyaltyThreshold: 5 } });
});

test("con la lealtad apagada la caja no ofrece ni acepta el canje", { skip }, async () => {
  await pastVisits(A, ana, 4, 60); // 10 visitas − 5 = 5 sellos
  assert.equal((await lookup(A, `Ana ${RUN}`)).loyaltyEligible, true);

  await prisma.barbershop.update({ where: { id: A.id }, data: { loyaltyEnabled: false } });
  const hit = await lookup(A, `Ana ${RUN}`);
  assert.equal(hit.loyaltyEligible, false);
  assert.equal((await cash.getCheckoutContext(A.ctx, FEATURES)).loyaltyEnabled, false);
  await assert.rejects(walkIn(A, ana, { redeemLoyaltyItemIndex: 0 }), codeIs("LOYALTY_DISABLED"));

  await prisma.barbershop.update({ where: { id: A.id }, data: { loyaltyEnabled: true } });
});

test("la barbería con el umbral por defecto sigue en 10: con 7 no hay premio, con 10 sí (y el ticket se ve como siempre)", { skip }, async () => {
  await pastVisits(B, beto, 7);
  const seven = await lookup(B, `Beto ${RUN}`);
  assert.equal(seven.loyaltyCount, 7);
  assert.equal(seven.loyaltyEligible, false);
  await assert.rejects(walkIn(B, beto, { redeemLoyaltyItemIndex: 0 }), (e: unknown) => /7 de 10 estrellas/.test((e as Error).message));

  await pastVisits(B, beto, 3, 40);
  const sale = await walkIn(B, beto, { redeemLoyaltyItemIndex: 0 });
  assert.equal(sale.items[0].description, `Corte${LOYALTY_SUFFIX}`);
  assert.equal((await column(beto)).loyaltyCount, 1, "11 visitas − 10 canjeados");
});

// ── «Mi cuenta» del cliente ────────────────────────────────────────────

test("«mi cuenta» lee los sellos frescos y la meta de la barbería (antes: caché vieja y 10 fijos)", { skip }, async () => {
  // Se envejece la caché a propósito, como si nadie hubiera abierto el panel.
  const real = (await core.refreshLoyalty(prisma, A.id, [ana])).get(ana)!;
  await prisma.barberClient.update({ where: { id: ana }, data: { loyaltyCount: 0, totalVisits: 0, lastVisitAt: null } });

  const data = await portal.loadPortalData({ barbershopId: A.id, clientId: ana });
  assert.ok(data, "el portal de Ana está activo");
  assert.equal(data!.client.loyaltyCount, real.count);
  assert.equal(data!.client.totalVisits, real.visits);
  assert.equal(data!.client.loyaltyGoal, 5, "la meta que configuró la barbería");
  assert.equal(data!.client.freeCutReady, real.count >= 5);
  assert.equal((await column(ana)).loyaltyCount, real.count, "y la caché quedó corregida");

  // Otra barbería no puede leer a Ana.
  assert.equal(await portal.loadPortalData({ barbershopId: B.id, clientId: ana }), null);
});
