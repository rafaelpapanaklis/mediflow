// La devolución de un anticipo NO es un «ticket» en los conteos de Inicio y
// Reportes (ronda 5 · M2 de la revisión de ws6-t2).
//
// La devolución se registra como un ticket de subtotal NEGATIVO en el turno
// abierto (sql/barber_devolucion_anticipo.sql). El INGRESO tiene que seguir
// restándola, pero «Tickets» y «ticket promedio» no deben contarla:
//   3 tickets de $100 y una devolución de −$100  →  Tickets 3, Ingresos $200
//   (y ticket promedio $66.67 = 200 / 3, no 200 / 4).
//
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<puerto>/barber \
//   DIRECT_URL=$DATABASE_URL npx tsx --test \
//     src/lib/barber/__tests__/stats-devolucion-integration.test.ts
//
// Necesita la base con sql/barber_devolucion_anticipo.sql aplicado (la
// restricción vieja rechaza el ticket negativo). Solo corre contra una base
// LOCAL: crea y borra una barbería (ver _base-local.ts).
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { skip } from "./_base-local";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { createSale, getCashState, openCashSession } from "@/lib/barber/cash";
import { getInicioSummary, getReportsSummary } from "@/lib/barber/stats";
import { BARBER_DEPOSIT_REFUND_LINE_PREFIX, buildSaleTag } from "@/lib/barber/memberships-core";

const db = prisma;
const RUN = `dev${Date.now().toString(36)}`;
const PRO = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const money = (n: number) => new Prisma.Decimal(n);

let shopId = "";
let ctx: BarberContext;
let barberId = "";
let now: Date;

before(async () => {
  if (skip) return;
  now = new Date();
  const shop = await db.barbershop.create({
    data: { name: "Dev", slug: `${RUN}-dev`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  shopId = shop.id;
  const user = await db.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Dueño", lastName: "Dev", role: "OWNER" },
  });
  ctx = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber: null, role: "OWNER" };
  const barber = await db.barber.create({
    data: { barbershopId: shopId, name: `Barbero-${RUN}`, commissionType: "COMMISSION", commissionPct: money(50) },
  });
  barberId = barber.id;
  const corte = await db.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: money(100) } });

  await openCashSession(ctx, { openingAmount: 0 });
  for (let i = 0; i < 3; i++) {
    await createSale(ctx, { barberId, items: [{ kind: "service", id: corte.id }], paymentMethod: "CASH" }, PRO, now);
  }

  // La devolución de un anticipo, tal como la escribe el servidor: ticket
  // NEGATIVO, sin barbero ni cita ni propina, con su sello interno, en el
  // turno abierto.
  const session = await db.barberCashSession.findFirstOrThrow({ where: { barbershopId: shopId, closedAt: null } });
  await db.barberSale.create({
    data: {
      barbershopId: shopId,
      cashSessionId: session.id,
      soldByUserId: user.id,
      paymentMethod: "CASH",
      subtotal: money(-100),
      tip: money(0),
      total: money(-100),
      notes: buildSaleTag({ k: "refund", appt: `cita-${RUN}` }),
      createdAt: now,
      items: { create: [{ description: `${BARBER_DEPOSIT_REFUND_LINE_PREFIX}Cliente de prueba`, qty: 1, unitPrice: money(-100) }] },
    },
  });
});

after(async () => {
  if (skip || !shopId) return;
  const w = { barbershopId: shopId };
  await db.barberCommissionEntry.deleteMany({ where: w });
  await db.barberStockMovement.deleteMany({ where: w });
  await db.barberSaleItem.deleteMany({ where: { sale: w } });
  await db.barberSale.deleteMany({ where: w });
  await db.barberCashSession.deleteMany({ where: w });
  await db.barberService.deleteMany({ where: w });
  await db.barberUser.deleteMany({ where: w });
  await db.barber.deleteMany({ where: w });
  await db.barbershop.delete({ where: { id: shopId } });
  await db.$disconnect();
});

test("Inicio: 3 tickets de $100 y una devolución de −$100 → Tickets 3, Ingresos $200", { skip }, async () => {
  const s = await getInicioSummary(ctx, { features: PRO, now });
  assert.equal(s.today.tickets, 3, "la devolución no es un ticket");
  assert.equal(s.today.revenue, 200, "pero el ingreso SÍ la resta: 300 − 100");
  assert.equal(s.today.total, 200);
  assert.equal(s.today.avgTicket, 66.67, "ticket promedio = 200 / 3 (no 200 / 4)");
});

test("Reportes: Tickets 3, Ingresos $200, y por barbero 3 tickets", { skip }, async () => {
  const r = await getReportsSummary(ctx, { range: "month", features: PRO, now });
  assert.equal(r.totals.tickets, 3);
  assert.equal(r.totals.revenue, 200);
  assert.equal(r.totals.avgTicket, 66.67);
  const hoy = r.byDay.filter((d) => d.tickets > 0 || d.revenue !== 0);
  assert.equal(hoy.reduce((n, d) => n + d.tickets, 0), 3, "por día también suman 3");
  const fila = r.byBarber.find((b) => b.barberId === barberId)!;
  assert.equal(fila.tickets, 3);
  assert.equal(fila.produced, 300, "el barbero produjo 300: la devolución no es suya (no lleva barbero)");
  assert.equal(fila.avgTicket, 100);
});

test("La caja SÍ cuenta la devolución en su turno (no se toca): el efectivo esperado baja a $200", { skip }, async () => {
  const caja = await getCashState(ctx);
  assert.ok(caja.open);
  assert.equal(caja.open!.session.salesTotal, 200, "vendido neto: 300 − 100");
  assert.equal(caja.open!.expectedCash, 200, "fondo 0 + 300 cobrados − 100 devueltos");
});
