// M16 de la auditoría ws6-t3: POST /api/barber/sales dejaba cobrar una cita
// «Pendiente» (o confirmada, o en silla) y la cita se quedaba en ese estado
// con un ticket cobrado encima. La pantalla nunca lo ofrece —cobrar aparece
// solo cuando la visita está Completada, y «Completar y cobrar» primero la
// completa—, así que el servidor hace valer la misma regla: una cita solo se
// cobra cuando está Completada.
//
// Con la ruta de verdad (sesión simulada, todo lo demás real):
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/cobro-cita-no-completada-integration.test.ts
//
// Sin DATABASE_URL se SALTA. JAMÁS apuntarla a producción: crea barberías.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

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
// plans.ts NO se sustituye: la ruta resuelve el plan de verdad (import()
// dinámico de cash.ts) contra la base de pruebas, que cae a la configuración
// de respaldo del plan Profesional.

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
let salesRoute: typeof import("@/app/api/barber/sales/route");
let NextRequestCtor: typeof import("next/server")["NextRequest"];

const RUN = `n${Date.now().toString(36)}`;
const MIN = 60_000;

let ctx: BarberContext;
let shopId: string;
let barberId: string;
let serviceId: string;
let slot = 0;

async function appointment(status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW") {
  // Cada una en su propio hueco de hoy: la agenda no admite empalmes.
  const start = new Date(Date.now() - (30 + slot++ * 45) * MIN);
  const a = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, barberId, clientName: "Cliente Suelto", status, startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  return a.id;
}

const statusOf = async (id: string) => (await prisma.barberAppointment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const ticketsOf = (id: string) => prisma.barberSale.count({ where: { barbershopId: shopId, appointmentId: id } });

function post(body: unknown) {
  return salesRoute.POST(
    new NextRequestCtor("http://localhost/api/barber/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  caja = await import("@/lib/barber/commissions");
  salesRoute = await import("@/app/api/barber/sales/route");
  NextRequestCtor = (await import("next/server")).NextRequest;

  const shop = await prisma.barbershop.create({
    data: { name: "Barbería M16", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "M16", role: "OWNER" },
  });
  shopId = shop.id;
  ctx = { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" };
  barberId = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  serviceId = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  await cash.openCashSession(ctx, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: shopId } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("la API no cobra una cita Pendiente, Confirmada ni En silla: 409, sin ticket y la cita queda igual", { skip }, async () => {
  session = ctx;
  for (const status of ["PENDING", "CONFIRMED", "IN_PROGRESS"] as const) {
    const id = await appointment(status);
    const res = await post({ appointmentId: id, items: [{ kind: "service", id: serviceId }], paymentMethod: "CASH" });
    assert.equal(res.status, 409, `${status}: rechazada`);
    const body = (await res.json()) as { code: string; error: string };
    assert.equal(body.code, "APPOINTMENT_NOT_DONE");
    assert.match(body.error, /completada/i);
    assert.equal(await ticketsOf(id), 0, `${status}: no se creó ticket`);
    assert.equal(await statusOf(id), status, `${status}: la cita no cambió de estado`);
  }
  assert.equal((await cash.getCashState(ctx)).open!.session.ticketCount, 0, "el corte no se movió");
});

test("cancelada o «no llegó» siguen sin poder cobrarse", { skip }, async () => {
  for (const status of ["CANCELLED", "NO_SHOW"] as const) {
    const id = await appointment(status);
    await assert.rejects(
      cash.createSale(ctx, { appointmentId: id, items: [{ kind: "service", id: serviceId }], paymentMethod: "CASH" }, FEATURES),
      (e: unknown) => e instanceof caja.BarberCajaError && e.code === "APPOINTMENT_NOT_CHARGEABLE",
    );
  }
});

test("la cita Completada se cobra normal (y es la única que la caja lista «por cobrar»)", { skip }, async () => {
  session = ctx;
  const pending = await appointment("CONFIRMED");
  const done = await appointment("DONE");

  const listed = (await cash.getCheckoutContext(ctx, FEATURES)).pendingAppointments.map((p) => p.id);
  assert.ok(listed.includes(done));
  assert.equal(listed.includes(pending), false, "la pantalla nunca ofreció cobrar una no completada");

  const res = await post({ appointmentId: done, items: [{ kind: "service", id: serviceId }], paymentMethod: "CASH" });
  assert.equal(res.status, 201);
  const sale = (await res.json()) as { total: number; appointmentId: string };
  assert.equal(sale.total, 180);
  assert.equal(sale.appointmentId, done);
  assert.equal(await statusOf(done), "DONE");
});

test("un ticket de mostrador sin cita no se ve afectado", { skip }, async () => {
  session = ctx;
  const res = await post({ barberId, items: [{ kind: "service", id: serviceId }], paymentMethod: "CARD" });
  assert.equal(res.status, 201);
});
