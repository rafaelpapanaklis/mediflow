// La cita «B» (ws6-t5, 15-nov-2026): el servidor nuevo de la cita abierta.
//
//   1. Cancelar con motivo (cancelReason; sin el SQL cancela igual).
//   2. «Ya llegó» (arrivedAt; solo pendientes/confirmadas del día).
//   3. Recordatorio ahora (mismo motor: plantilla, ventana, cupo, sin duplicar).
//   4. Productos al cobro desde la cita (nota «Por cobrar» ligada a la cita).
//   5. Anticipo desde la cita (mismo registro que Membresías → Anticipos).
//   6. DTO de la cita: arrivedAt, cancelReason, deposit, client {totalVisits, stars}.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/cita-b-integration.test.ts
//
// Solo contra una base LOCAL (crea y borra barberías, y quita/pone las
// columnas de sql/barber_cita_b.sql para probar el «antes del SQL»).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { CANCEL_REASON_MAX, AppointmentExtrasInputError, cleanCancelReason } from "../appointment-extras";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

// ═══════════════════════════════════════════════════════════════════════
// Puro
// ═══════════════════════════════════════════════════════════════════════

test("motivo de cancelación: opcional, recortado de espacios, hasta 200", () => {
  assert.equal(cleanCancelReason(undefined), null);
  assert.equal(cleanCancelReason("   "), null);
  assert.equal(cleanCancelReason("  Se  enfermó \n"), "Se enfermó");
  assert.equal(cleanCancelReason("x".repeat(CANCEL_REASON_MAX))?.length, 200);
  assert.throws(() => cleanCancelReason("x".repeat(201)), AppointmentExtrasInputError);
  assert.throws(() => cleanCancelReason(5), AppointmentExtrasInputError);
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
let statusRoute: typeof import("@/app/api/barber/appointments/[id]/status/route");
let loyalty: typeof import("@/lib/barber/loyalty");

const RUN = `cb${Date.now().toString(36)}`;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
let seq = 0;

interface Shop {
  id: string;
  ctx: BarberContext;
  barberId: string;
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
  const service = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) },
  });
  const product = await prisma.barberProduct.create({
    data: { barbershopId: shop.id, name: "Cera", price: new Prisma.Decimal(150), stock: 5 },
  });
  return {
    id: shop.id,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    barberId: barber.id,
    serviceId: service.id,
    productId: product.id,
  };
}

async function staff(shop: Shop, role: "RECEPTION" | "BARBER", barberId: string | null = null): Promise<BarberContext> {
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id, supabaseId: `${RUN}-${role}-${seq++}`, email: `${RUN}-${role}-${seq}@test.local`,
      firstName: role === "RECEPTION" ? "Rita" : "Beto", lastName: "Staff", role, barberId,
    },
  });
  const barber = barberId ? await prisma.barber.findUnique({ where: { id: barberId } }) : null;
  return { barberUserId: user.id, barbershopId: shop.id, barbershop: shop.ctx.barbershop, user, barber, role };
}

async function newClient(shop: Shop, name: string): Promise<string> {
  const phone = `57${(Date.now() % 1e6).toString().padStart(6, "0")}${(seq++ % 100).toString().padStart(2, "0")}`;
  return (await prisma.barberClient.create({ data: { barbershopId: shop.id, name: `${name} ${RUN}`, phone } })).id;
}

async function appt(
  shop: Shop,
  clientId: string | null,
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW",
  startInMs: number,
  extra: Record<string, unknown> = {},
) {
  const start = new Date(Date.now() + startInMs);
  return prisma.barberAppointment.create({
    data: {
      barbershopId: shop.id, clientId, barberId: shop.barberId, status, startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId: shop.serviceId, priceAtBooking: new Prisma.Decimal(200) }] },
      ...extra,
    },
  });
}

const SQL_FILE = path.join(ROOT, "sql/barber_cita_b.sql");
async function applySql() {
  const sql = fs.readFileSync(SQL_FILE, "utf8").replace(/^\s*--.*$/gm, "");
  for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
}
async function dropColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_appointments" DROP COLUMN IF EXISTS "cancelReason"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_appointments" DROP COLUMN IF EXISTS "arrivedAt"`);
}

const req = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  statusRoute = await import("@/app/api/barber/appointments/[id]/status/route");
  loyalty = await import("@/lib/barber/loyalty");
  await dropColumns(); // empieza como producción ANTES de pegar el SQL
  A = await makeShop("A");
  B = await makeShop("B");
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "barber_sale_drafts" WHERE "barbershopId" = ANY($1::text[])`, ids);
  } catch {
    /* sin la tabla de notas */
  }
  await prisma.barberMessage.deleteMany({ where: { barbershopId: { in: ids } } });
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

const readReason = async (id: string) =>
  (await prisma.$queryRaw<Array<{ cancelReason: string | null }>>`SELECT "cancelReason" FROM "barber_appointments" WHERE "id" = ${id}`)[0]?.cancelReason ?? null;

// ── 1. Cancelar con motivo ─────────────────────────────────────────────

test("1 · cancelar con motivo: sin el SQL cancela igual; con el SQL lo guarda; se ve en el historial del cliente", { skip }, async () => {
  const ana = await newClient(A, "Ana");
  session = A.ctx;

  // ANTES del SQL: cancela como hoy y avisa que el motivo no se guardó.
  const a1 = await appt(A, ana, "CONFIRMED", 2 * DAY);
  const r1 = await statusRoute.POST(req(`/x`, "POST", { to: "CANCELLED", reason: "Se enfermó" }), params(a1.id));
  assert.equal(r1.status, 200);
  const b1 = (await r1.json()) as { appointment: { status: string }; reasonSaved: boolean };
  assert.equal(b1.appointment.status, "CANCELLED");
  assert.equal(b1.reasonSaved, false);

  await applySql();
  await applySql(); // idempotente

  // CON el SQL, y por PATCH (como la llama la cita «B»).
  const a2 = await appt(A, ana, "PENDING", 3 * DAY);
  const r2 = await statusRoute.PATCH(req(`/x`, "PATCH", { to: "CANCELLED", reason: "  Se le cruzó el trabajo  " }), params(a2.id));
  assert.equal(r2.status, 200);
  assert.equal(((await r2.json()) as { reasonSaved: boolean }).reasonSaved, true);
  assert.equal(await readReason(a2.id), "Se le cruzó el trabajo");

  // Sin motivo también se cancela (es opcional).
  const a3 = await appt(A, ana, "PENDING", 4 * DAY);
  assert.equal((await statusRoute.POST(req(`/x`, "POST", { to: "CANCELLED" }), params(a3.id))).status, 200);
  assert.equal(await readReason(a3.id), null);

  // Más de 200 caracteres: 400 y la cita NO se cancela.
  const a4 = await appt(A, ana, "PENDING", 5 * DAY);
  const r4 = await statusRoute.POST(req(`/x`, "POST", { to: "CANCELLED", reason: "x".repeat(201) }), params(a4.id));
  assert.equal(r4.status, 400);
  assert.equal((await prisma.barberAppointment.findUniqueOrThrow({ where: { id: a4.id } })).status, "PENDING");

  // El motivo solo viaja al cancelar: en otro estado se ignora.
  await statusRoute.POST(req(`/x`, "POST", { to: "CONFIRMED", reason: "no aplica" }), params(a4.id));
  assert.equal(await readReason(a4.id), null);

  // Otra barbería no cancela una cita ajena.
  session = B.ctx;
  assert.equal((await statusRoute.POST(req(`/x`, "POST", { to: "CANCELLED", reason: "ajena" }), params(a4.id))).status, 404);

  // El historial del cliente dice el motivo.
  const history = await loyalty.getBarberVisitHistory(A.ctx, ana);
  assert.equal(history.entries.find((e) => e.id === a2.id)?.cancelReason, "Se le cruzó el trabajo");
  assert.equal(history.entries.find((e) => e.id === a3.id)?.cancelReason, null);
  session = null;
});
