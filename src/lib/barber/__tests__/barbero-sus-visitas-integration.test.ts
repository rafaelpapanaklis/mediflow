// RONDA 2 (B) — decisión de Rafael, 14-nov-2026: el rol Barbero puede marcar
// «En silla» y «Completada» SOLO en sus propias visitas. Antes no podía en
// ninguna (la ruta pedía agenda.edit) y dependía de recepción para cada cita.
//
// Con la ruta de verdad (POST /api/barber/appointments/[id]/status), la
// sesión simulada y todo lo demás real:
//   · su visita Confirmada → En silla → Completada: 200;
//   · la visita de OTRO barbero, o sin barbero: 403 y no cambia;
//   · confirmar, cancelar o «no llegó», aunque sea su visita: 403;
//   · cobrar sigue pidiendo el permiso de caja;
//   · recepción y el dueño siguen pudiendo todo, como antes.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/barbero-sus-visitas-integration.test.ts
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
import { BARBER_OWN_VISIT_STATUSES, canAdvanceOwnVisit, ownVisitsBarberId } from "../own-visits";

// Solo contra una base LOCAL: ver _base-local.ts (crean y borran barberías).
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

// ═══════════════════════════════════════════════════════════════════════
// 0. La regla, pura
// ═══════════════════════════════════════════════════════════════════════

test("la regla: solo el rol Barbero, solo su visita, solo «En silla» y «Completada»", () => {
  const barbero = { role: "BARBER", barberId: "b1" };
  assert.deepEqual(BARBER_OWN_VISIT_STATUSES, ["IN_PROGRESS", "DONE"]);
  assert.equal(canAdvanceOwnVisit(barbero, { barberId: "b1" }, "IN_PROGRESS"), true);
  assert.equal(canAdvanceOwnVisit(barbero, { barberId: "b1" }, "DONE"), true);
  for (const to of ["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW"] as const) {
    assert.equal(canAdvanceOwnVisit(barbero, { barberId: "b1" }, to), false, `${to} no es suyo`);
  }
  assert.equal(canAdvanceOwnVisit(barbero, { barberId: "b2" }, "DONE"), false, "la visita de otro barbero");
  assert.equal(canAdvanceOwnVisit(barbero, { barberId: null }, "DONE"), false, "una visita sin barbero no es de nadie");
  assert.equal(canAdvanceOwnVisit({ role: "BARBER", barberId: null }, { barberId: null }, "DONE"), false, "usuario Barbero sin ficha ligada");
  assert.equal(canAdvanceOwnVisit({ role: "RECEPTION", barberId: "b1" }, { barberId: "b1" }, "DONE"), false, "esta puerta es solo del rol Barbero");
  assert.equal(ownVisitsBarberId(barbero), "b1");
  assert.equal(ownVisitsBarberId({ role: "OWNER", barberId: "b1" }), null);
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
let statusRoute: typeof import("@/app/api/barber/appointments/[id]/status/route");
let listRoute: typeof import("@/app/api/barber/appointments/route");

const RUN = `b${Date.now().toString(36)}`;
const MIN = 60_000;

let shopId: string;
let otherShopId: string;
let owner: BarberContext;
let reception: BarberContext;
let barberoUno: BarberContext; // usuario rol BARBER ligado a «Uno»
let barberoSuelto: BarberContext; // rol BARBER sin ficha de barbero
let barberoAjeno: BarberContext; // rol BARBER de OTRA barbería
let uno: string;
let dos: string;
let serviceId: string;
let slot = 0;

type Status = "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";

async function appointment(barberId: string | null, status: Status) {
  const start = new Date(Date.now() + (60 + slot++ * 45) * MIN);
  const a = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, barberId, clientName: "Cliente Prueba", status, startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  return a.id;
}

const statusOf = async (id: string) => (await prisma.barberAppointment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

async function move(who: BarberContext | null, id: string, to: Status) {
  session = who;
  const res = await statusRoute.POST(
    new Request(`http://localhost/api/barber/appointments/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, branchId: who?.barbershopId ?? null }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return res.status;
}

async function makeUser(barbershop: BarberContext["barbershop"], role: "OWNER" | "RECEPTION" | "BARBER", tag: string, barberId: string | null = null): Promise<BarberContext> {
  const user = await prisma.barberUser.create({
    data: { barbershopId: barbershop.id, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: tag, lastName: "Prueba", role, barberId },
  });
  const barber = barberId ? await prisma.barber.findUniqueOrThrow({ where: { id: barberId } }) : null;
  return { barberUserId: user.id, barbershopId: barbershop.id, barbershop, user, barber, role };
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  statusRoute = await import("@/app/api/barber/appointments/[id]/status/route");
  listRoute = await import("@/app/api/barber/appointments/route");

  const shop = await prisma.barbershop.create({
    data: { name: "Barbería Ronda 2B", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const other = await prisma.barbershop.create({
    data: { name: "Otra Barbería", slug: `${RUN}-b`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  shopId = shop.id;
  otherShopId = other.id;
  uno = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  dos = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Dos", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const ajeno = (await prisma.barber.create({ data: { barbershopId: otherShopId, name: "Ajeno", commissionType: "SALARY" } })).id;
  serviceId = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;

  owner = await makeUser(shop, "OWNER", "duena");
  reception = await makeUser(shop, "RECEPTION", "recepcion");
  barberoUno = await makeUser(shop, "BARBER", "barbero-uno", uno);
  barberoSuelto = await makeUser(shop, "BARBER", "barbero-suelto");
  barberoAjeno = await makeUser(other, "BARBER", "barbero-ajeno", ajeno);
});

after(async () => {
  if (!HAS_DB) return;
  const ids = [shopId, otherShopId];
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: { in: ids } } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("el Barbero marca «En silla» y «Completada» en SU visita", { skip }, async () => {
  const mine = await appointment(uno, "CONFIRMED");
  assert.equal(await move(barberoUno, mine, "IN_PROGRESS"), 200);
  assert.equal(await statusOf(mine), "IN_PROGRESS");
  assert.equal(await move(barberoUno, mine, "DONE"), 200);
  assert.equal(await statusOf(mine), "DONE");
});

test("NO puede en la visita de otro barbero ni en una sin barbero: 403 y la visita no cambia", { skip }, async () => {
  const theirs = await appointment(dos, "CONFIRMED");
  assert.equal(await move(barberoUno, theirs, "IN_PROGRESS"), 403);
  assert.equal(await statusOf(theirs), "CONFIRMED");

  const inChair = await appointment(dos, "IN_PROGRESS");
  assert.equal(await move(barberoUno, inChair, "DONE"), 403);
  assert.equal(await statusOf(inChair), "IN_PROGRESS");

  const nobody = await appointment(null, "CONFIRMED");
  assert.equal(await move(barberoUno, nobody, "IN_PROGRESS"), 403);
  assert.equal(await statusOf(nobody), "CONFIRMED");
});

test("en su propia visita tampoco puede confirmar, cancelar ni marcar «no llegó»", { skip }, async () => {
  const pending = await appointment(uno, "PENDING");
  assert.equal(await move(barberoUno, pending, "CONFIRMED"), 403);
  assert.equal(await move(barberoUno, pending, "CANCELLED"), 403);
  assert.equal(await move(barberoUno, pending, "NO_SHOW"), 403);
  assert.equal(await statusOf(pending), "PENDING");

  const confirmed = await appointment(uno, "CONFIRMED");
  assert.equal(await move(barberoUno, confirmed, "CANCELLED"), 403);
  assert.equal(await statusOf(confirmed), "CONFIRMED");
});

test("el flujo de estados sigue mandando: de Pendiente no salta a En silla (409), ni se salta a Completada", { skip }, async () => {
  const pending = await appointment(uno, "PENDING");
  assert.equal(await move(barberoUno, pending, "IN_PROGRESS"), 409);
  const confirmed = await appointment(uno, "CONFIRMED");
  assert.equal(await move(barberoUno, confirmed, "DONE"), 409);
  assert.equal(await statusOf(confirmed), "CONFIRMED");
});

test("un usuario Barbero sin ficha ligada, o de otra barbería, no mueve nada", { skip }, async () => {
  const mine = await appointment(uno, "CONFIRMED");
  assert.equal(await move(barberoSuelto, mine, "IN_PROGRESS"), 403);
  assert.equal(await move(barberoAjeno, mine, "IN_PROGRESS"), 404, "para otra barbería esa visita no existe");
  assert.equal(await move(null, mine, "IN_PROGRESS"), 401);
  assert.equal(await statusOf(mine), "CONFIRMED");
});

test("recepción y el dueño siguen pudiendo todo el flujo, en cualquier visita", { skip }, async () => {
  const a = await appointment(dos, "PENDING");
  assert.equal(await move(reception, a, "CONFIRMED"), 200);
  assert.equal(await move(reception, a, "IN_PROGRESS"), 200);
  assert.equal(await move(owner, a, "DONE"), 200);
  const b = await appointment(uno, "CONFIRMED");
  assert.equal(await move(reception, b, "NO_SHOW"), 200);
  const c = await appointment(null, "PENDING");
  assert.equal(await move(owner, c, "CANCELLED"), 200);
});

test("cobrar sigue pidiendo el permiso de caja: el Barbero completa su visita pero no la cobra", { skip }, async () => {
  await cash.openCashSession(owner, { openingAmount: 0 });
  const mine = await appointment(uno, "IN_PROGRESS");
  assert.equal(await move(barberoUno, mine, "DONE"), 200);
  await assert.rejects(
    cash.createSale(barberoUno, { appointmentId: mine, items: [{ kind: "service", id: serviceId }], paymentMethod: "CASH" }, FEATURES),
    (e: unknown) => e instanceof BarberForbiddenError,
  );
  assert.equal(await prisma.barberSale.count({ where: { barbershopId: shopId, appointmentId: mine } }), 0);
  // Quien sí tiene caja la cobra normal.
  const sale = await cash.createSale(reception, { appointmentId: mine, items: [{ kind: "service", id: serviceId }], paymentMethod: "CASH" }, FEATURES);
  assert.equal(sale.total, 180);
});

test("la agenda le dice a la pantalla de quién son «sus» visitas (y a nadie más)", { skip }, async () => {
  const can = async (who: BarberContext) => {
    session = who;
    const res = await listRoute.GET(new Request("http://localhost/api/barber/appointments"));
    assert.equal(res.status, 200);
    return ((await res.json()) as { can: { edit: boolean; advanceOwnBarberId: string | null; cash: boolean } }).can;
  };
  const b = await can(barberoUno);
  assert.equal(b.edit, false);
  assert.equal(b.advanceOwnBarberId, uno);
  assert.equal(b.cash, false);
  // Sin ficha ligada ya no recibe la agenda (G1 de la ronda 6: ve solo lo
  // suyo, y no tiene nada suyo): 403 con el motivo.
  session = barberoSuelto;
  const suelto = await listRoute.GET(new Request("http://localhost/api/barber/appointments"));
  assert.equal(suelto.status, 403);
  assert.equal(((await suelto.json()) as { code: string }).code, "BARBER_NOT_LINKED");
  const r = await can(reception);
  assert.equal(r.edit, true);
  assert.equal(r.advanceOwnBarberId, null, "quien edita la agenda no necesita esta puerta");
});
