// Integración de Inicio + Reportes contra Postgres REAL. Lo que se prueba
// aquí son garantías de base de datos y de alcance, no de UI:
//   · los números de Inicio CUADRAN con la caja (summarizeSession) y con
//     comisiones (getCommissionSummary) para el mismo día/mes;
//   · un rol BARBER recibe SOLO lo suyo (ni el total de la barbería ni
//     nombres de otros barberos), también llamando a las rutas de la API;
//   · dos barberías no se ven entre sí;
//   · un plan Básico/Avanzado ve Inicio pero la API de reportes le responde
//     403 FEATURE_LOCKED (el gate está en el servidor);
//   · el render de Inicio no hace N+1 (se cuentan las sentencias SQL).
//
//   docker run -d --name barber-stats-pg -e POSTGRES_PASSWORD=barber \
//     -e POSTGRES_DB=barber -p 54329:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:barber@localhost:54329/barber \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
//     src/lib/barber/__tests__/stats-integration.test.ts
//
// Sin DATABASE_URL se SALTAN (no fallan). JAMÁS apuntarlas a producción:
// crean y borran barberías.
import "./_sin-server-only";
import Module from "node:module";
import { spawnSync } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  BarberCajaError,
  getCommissionSummary,
  periodKeyFor,
  startOfDayInTz,
} from "@/lib/barber/commissions";
import { cancelSale, closeCashSession, createSale, getCashState, openCashSession } from "@/lib/barber/cash";
import {
  buildReportsCsv,
  getInicioSummary,
  getReportsSummary,
  resolveReportPeriod,
  type ReportsCsvLabels,
} from "@/lib/barber/stats";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

// ── Sesión falsa para las RUTAS: getBarberContext() devuelve el ctx elegido ──
// Se intercepta el require de "@/lib/barber-auth" (tsx compila a CJS y los
// consumidores leen la propiedad al llamar, no al importar). Todo lo demás
// del módulo es el real.
let routeCtx: BarberContext | null = null;
{
  const M = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    __barberStatsAuthStub?: boolean;
  };
  if (!M.__barberStatsAuthStub) {
    const original = M._load;
    M._load = function (request: string, parent: unknown, isMain: boolean) {
      const real = original.call(this, request, parent, isMain);
      if (request === "@/lib/barber-auth" && real && typeof real === "object") {
        return Object.create(real as object, {
          getBarberContext: { value: async () => routeCtx, enumerable: true },
        });
      }
      return real;
    };
    M.__barberStatsAuthStub = true;
  }
}
// Se importan DESPUÉS del stub, a propósito.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const inicioRoute = require("@/app/api/barber/stats/inicio/route") as { GET: (req: Request) => Promise<Response> };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const reportsRoute = require("@/app/api/barber/stats/reports/route") as { GET: (req: Request) => Promise<Response> };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextRequest } = require("next/server") as { NextRequest: new (url: string) => Request };

const db = prisma;
const RUN = `s${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const PRO = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const AVZ = FALLBACK_BARBER_PLAN_CONFIG.AVANZADO.features;
const proResolver = async () => PRO;

// Contador de sentencias, leído del LOG de Postgres (log_statement = all
// en el contenedor): cuenta todo lo que llega a la base, incluido $queryRaw,
// sin depender de middlewares (el cliente extendido del repo no expone $use).
//   docker exec barber-stats-pg psql -U postgres -d barber -c "ALTER SYSTEM SET
//     log_statement = 'all';" -c "SELECT pg_reload_conf();"
// Si no hay docker CLI o el log no trae los marcadores, devuelve null y la
// prueba solo lo reporta (no falla por eso).
const PG_CONTAINER = process.env.BARBER_PG_CONTAINER ?? "barber-stats-pg";
async function countStatements(fn: () => Promise<void>): Promise<number | null> {
  const tag = `MARK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await db.$queryRawUnsafe(`SELECT '${tag}-START'`);
  await fn();
  await db.$queryRawUnsafe(`SELECT '${tag}-END'`);
  try {
    // Sin shell: el nombre del contenedor va como argumento. Postgres escribe su log en stderr.
    const res = spawnSync("docker", ["logs", PG_CONTAINER], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const logs = (res.stdout ?? "") + (res.stderr ?? "");
    const start = logs.indexOf(`${tag}-START`);
    const end = logs.indexOf(`${tag}-END`);
    if (start < 0 || end < 0) return null;
    const lines = logs.slice(start, end).split("\n").filter((l) => /LOG:\s+(execute|statement)/.test(l));
    return Math.max(0, lines.length - 1); // menos el propio marcador START
  } catch {
    return null;
  }
}

type Shop = { id: string; ctx: BarberContext };

async function makeShop(name: string, plan: "AVANZADO" | "PROFESIONAL"): Promise<Shop> {
  const shop = await db.barbershop.create({
    data: { name, slug: `${RUN}-${name.toLowerCase()}`, plan, subscriptionStatus: "active", timezone: TZ },
  });
  const user = await db.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-${name}-owner`,
      email: `${RUN}-${name}@test.local`,
      firstName: "Dueño",
      lastName: name,
      role: "OWNER",
    },
  });
  return { id: shop.id, ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" } };
}

let barberCtxSeq = 0;
async function barberCtx(shop: Shop, barberId: string | null): Promise<BarberContext> {
  barberCtxSeq += 1;
  const user = await db.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-${barberId ?? "loose"}-b${barberCtxSeq}`,
      email: `${RUN}-${barberId ?? "loose"}-${barberCtxSeq}@test.local`,
      firstName: "Barbero",
      lastName: "Rol",
      role: "BARBER",
      barberId,
    },
  });
  const barber = barberId ? await db.barber.findUniqueOrThrow({ where: { id: barberId } }) : null;
  return { barberUserId: user.id, barbershopId: shop.id, barbershop: shop.ctx.barbershop, user, barber, role: "BARBER" };
}

const money = (n: number) => new Prisma.Decimal(n);

let A: Shop, B: Shop;
let alan: string, beto: string, bruno: string;
let corteA: string, barbaA: string, ceraA: string, corteB: string;
let clientFiel: string, clientFalta: string;
let now: Date, todayStart: Date, yesterdayNoon: Date, sameMonth: boolean;
const NAMES = { alan: `Alan-${RUN}`, beto: `Beto-${RUN}`, bruno: `Bruno-${RUN}`, fiel: `Fiel-${RUN}`, falta: `Falta-${RUN}` };

before(async () => {
  if (!HAS_DB) return;
  now = new Date();
  todayStart = startOfDayInTz(now, TZ);
  yesterdayNoon = new Date(todayStart.getTime() - 12 * 3_600_000);
  sameMonth = periodKeyFor(yesterdayNoon, TZ) === periodKeyFor(now, TZ);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 3_600_000);

  A = await makeShop("A", "PROFESIONAL");
  B = await makeShop("B", "AVANZADO");

  const [ba, bb, bc] = await Promise.all([
    db.barber.create({ data: { barbershopId: A.id, name: NAMES.alan, commissionType: "COMMISSION", commissionPct: money(40) } }),
    db.barber.create({ data: { barbershopId: A.id, name: NAMES.beto, commissionType: "CHAIR_RENT", chairRent: money(3000) } }),
    db.barber.create({ data: { barbershopId: B.id, name: NAMES.bruno, commissionType: "COMMISSION", commissionPct: money(50) } }),
  ]);
  alan = ba.id; beto = bb.id; bruno = bc.id;

  // Alan tiene horario; Beto no → "1 barbero sin horario".
  await db.barberSchedule.createMany({
    data: [1, 2, 3, 4, 5, 6].map((d) => ({ barbershopId: A.id, barberId: alan, dayOfWeek: d, startMinute: 9 * 60, endMinute: 19 * 60 })),
  });

  const [sc, sb, scb] = await Promise.all([
    db.barberService.create({ data: { barbershopId: A.id, name: "Corte", durationMin: 30, price: money(180) } }),
    db.barberService.create({ data: { barbershopId: A.id, name: "Barba", durationMin: 20, price: money(140) } }),
    db.barberService.create({ data: { barbershopId: B.id, name: "Corte B", durationMin: 30, price: money(200) } }),
  ]);
  corteA = sc.id; barbaA = sb.id; corteB = scb.id;

  const cera = await db.barberProduct.create({
    data: { barbershopId: A.id, name: "Cera", price: money(150), cost: money(80), stock: 1, minStock: 2 },
  });
  ceraA = cera.id;

  const [cf, cx] = await Promise.all([
    db.barberClient.create({ data: { barbershopId: A.id, name: NAMES.fiel, phone: "5511111111" } }),
    db.barberClient.create({ data: { barbershopId: A.id, name: NAMES.falta, phone: "5522222222" } }),
  ]);
  clientFiel = cf.id; clientFalta = cx.id;

  // Membresía que vence en 3 días → aviso "por vencer esta semana".
  const plan = await db.barberMembership.create({ data: { barbershopId: A.id, name: "Ilimitado", price: money(600), periodDays: 30 } });
  await db.barberClientMembership.create({
    data: { barbershopId: A.id, clientId: clientFiel, membershipId: plan.id, status: "ACTIVE", endAt: new Date(now.getTime() + 3 * 86_400_000) },
  });

  // Fila virtual: 2 esperando, 1 llamado.
  await db.barberWalkIn.createMany({
    data: [
      { barbershopId: A.id, clientName: "W1", status: "WAITING", position: 1 },
      { barbershopId: A.id, clientName: "W2", status: "WAITING", position: 2 },
      { barbershopId: A.id, clientName: "W3", status: "CALLED", position: 3 },
    ],
  });

  // Visitas de HOY (en la zona de la barbería):
  const at = (h: number, m = 0) => new Date(todayStart.getTime() + (h * 60 + m) * 60_000);
  const apptDoneCharged = await db.barberAppointment.create({
    data: {
      barbershopId: A.id, clientId: clientFiel, barberId: alan, status: "DONE", startAt: at(10), endAt: at(10, 30),
      services: { create: [{ serviceId: corteA, priceAtBooking: money(180) }] },
    },
  });
  await db.barberAppointment.create({ // terminada SIN cobrar (Beto)
    data: { barbershopId: A.id, clientName: "Suelto", barberId: beto, status: "DONE", startAt: at(11), endAt: at(11, 20),
      services: { create: [{ serviceId: barbaA, priceAtBooking: money(140) }] } },
  });
  await db.barberAppointment.create({ // en silla ahora (Alan) → próxima
    data: { barbershopId: A.id, clientName: "EnSilla", barberId: alan, status: "IN_PROGRESS", startAt: at(12), endAt: at(12, 30) },
  });
  await db.barberAppointment.create({ // pendiente al final del día (Beto) → próxima
    data: { barbershopId: A.id, clientName: "Tarde", barberId: beto, status: "PENDING", startAt: at(23, 45), endAt: tomorrowStart },
  });
  await db.barberAppointment.create({ data: { barbershopId: A.id, clientName: "Cancel", barberId: alan, status: "CANCELLED", startAt: at(13), endAt: at(13, 30) } });
  // Dos no-shows del mismo cliente (reincide), uno hoy y otro hace 3 días (en el mes o no).
  await db.barberAppointment.create({ data: { barbershopId: A.id, clientId: clientFalta, barberId: alan, status: "NO_SHOW", startAt: at(14), endAt: at(14, 30) } });
  await db.barberAppointment.create({ data: { barbershopId: A.id, clientId: clientFalta, barberId: alan, status: "NO_SHOW", startAt: at(15), endAt: at(15, 30) } });
  // Mañana: una PENDING (sin confirmar) de Alan y una CONFIRMED de Beto; y una solicitud pública.
  const tm = (h: number) => new Date(tomorrowStart.getTime() + h * 3_600_000);
  await db.barberAppointment.createMany({
    data: [
      { barbershopId: A.id, clientName: "M1", barberId: alan, status: "PENDING", startAt: tm(10), endAt: tm(10.5) },
      { barbershopId: A.id, clientName: "M2", barberId: beto, status: "CONFIRMED", startAt: tm(11), endAt: tm(11.5) },
      { barbershopId: A.id, clientName: "Web", barberId: null, status: "PENDING", source: "PUBLIC", startAt: tm(16), endAt: tm(16.5) },
    ],
  });

  // ── Dinero, por la MISMA puerta que la caja (createSale) ──
  // Turno 1 (ayer): una venta de Alan; se cierra "ayer".
  await openCashSession(A.ctx, { openingAmount: 300 });
  await createSale(A.ctx, { barberId: alan, items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, PRO, yesterdayNoon);
  await closeCashSession(A.ctx, { countedAmount: 480 }, yesterdayNoon);
  // Turno 2 (hoy, fondo 500):
  await openCashSession(A.ctx, { openingAmount: 500 });
  // S1: cita cobrada, Alan, corte 180 + propina 20, efectivo.
  await createSale(A.ctx, { appointmentId: apptDoneCharged.id, items: [{ kind: "service", id: corteA }], tip: 20, paymentMethod: "CASH" }, PRO, now);
  // S2: mostrador, Beto, barba 140 + cera 150 − 10 de descuento, tarjeta.
  await createSale(A.ctx, { barberId: beto, clientId: clientFiel, items: [{ kind: "service", id: barbaA }, { kind: "product", id: ceraA }], discount: 10, paymentMethod: "CARD" }, PRO, now);
  // S3: Alan, corte 180 + propina 30, SPEI.
  await createSale(A.ctx, { barberId: alan, items: [{ kind: "service", id: corteA }], tip: 30, paymentMethod: "SPEI" }, PRO, now);
  // S4: se cobra y se CANCELA → no cuenta en nada.
  const s4 = await createSale(A.ctx, { barberId: alan, items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, PRO, now);
  await cancelSale(A.ctx, s4.id, { reason: "prueba" }, now);

  // Barbería B: una venta de 200 en efectivo.
  await openCashSession(B.ctx, { openingAmount: 0 });
  await createSale(B.ctx, { barberId: bruno, items: [{ kind: "service", id: corteB }], paymentMethod: "CASH" }, AVZ, now);
});

after(async () => {
  if (!HAS_DB) return;
  // BARBER_KEEP=1 deja las barberías de prueba para inspeccionar la UI a mano.
  if (process.env.BARBER_KEEP) return;
  // Orden por los FK NoAction (ver caja-integration.test.ts).
  for (const shopId of [A?.id, B?.id].filter(Boolean) as string[]) {
    const w = { barbershopId: shopId };
    await db.barberCommissionEntry.deleteMany({ where: w });
    await db.barberStockMovement.deleteMany({ where: w });
    await db.barberSaleItem.deleteMany({ where: { sale: w } });
    await db.barberSale.deleteMany({ where: w });
    await db.barberAppointmentService.deleteMany({ where: { appointment: w } });
    await db.barberAppointment.deleteMany({ where: w });
    await db.barberWalkIn.deleteMany({ where: w });
    await db.barberClientMembership.deleteMany({ where: w });
    await db.barberMembership.deleteMany({ where: w });
    await db.barberCashSession.deleteMany({ where: w });
    await db.barberClient.deleteMany({ where: w });
    await db.barberSchedule.deleteMany({ where: w });
    await db.barberProduct.deleteMany({ where: w });
    await db.barberService.deleteMany({ where: w });
    await db.barberUser.deleteMany({ where: w });
    await db.barber.deleteMany({ where: w });
    await db.barbershop.delete({ where: { id: shopId } });
  }
  await db.$disconnect();
});

// ── 1. Inicio cuadra con caja y con comisiones ─────────────────────────

test("Inicio (dueño): ingreso, tickets, propinas y efectivo esperado cuadran con la caja", { skip }, async () => {
  let s!: Awaited<ReturnType<typeof getInicioSummary>>;
  const inicioQueries = await countStatements(async () => {
    s = await getInicioSummary(A.ctx, { features: PRO, now });
  });

  assert.equal(s.today.revenue, 640, "640 = 180 + 280 + 180 (la cancelada no cuenta)");
  assert.equal(s.today.tips, 50);
  assert.equal(s.today.total, 690);
  assert.equal(s.today.tickets, 3);
  assert.equal(s.today.avgTicket, 213.33);
  assert.equal(s.compare.yesterday.revenue, 180);
  assert.equal(s.compare.vsYesterdayPct, 255.6);

  const caja = await getCashState(A.ctx);
  assert.ok(caja.open, "hay turno abierto");
  assert.equal(s.today.revenue, caja.open!.session.salesTotal, "Inicio.ingreso = Caja.vendido");
  assert.equal(s.today.tips, caja.open!.session.tipsTotal, "Inicio.propinas = Caja.propinas");
  assert.equal(s.today.tickets, caja.open!.session.ticketCount, "Inicio.tickets = Caja.tickets");
  assert.ok(s.cash && s.cash.open);
  assert.equal(s.cash!.expectedCash, caja.open!.expectedCash, "Inicio.efectivo esperado = Caja.esperado");
  assert.equal(s.cash!.expectedCash, 700, "500 de fondo + 200 del único ticket en efectivo vivo");
  assert.equal(s.cash!.ticketCount, 3);

  const period = periodKeyFor(now, TZ);
  const com = await getCommissionSummary(A.ctx, period);
  const expectedProduced = sameMonth ? 820 : 640;
  assert.equal(com.totals.produced, expectedProduced, "Comisiones.producido del mes = ventas del mes");
  assert.equal(s.today.revenue + (sameMonth ? s.compare.yesterday.revenue : 0), com.totals.produced, "Inicio (hoy + ayer) = Comisiones.producido");
  const alanRow = com.rows.find((r) => r.barberId === alan)!;
  const betoRow = com.rows.find((r) => r.barberId === beto)!;
  assert.equal(alanRow.commissionTotal, sameMonth ? 216 : 144, "Alan 40% de 180 por ticket");
  assert.equal(betoRow.commissionTotal, 130, "Beto renta de silla: base = 140 − 10 de descuento");

  // Visitas de hoy y avisos.
  assert.deepEqual(s.visits, { total: 7, done: 2, pending: 1, inProgress: 1, cancelled: 1, noShow: 2, toCharge: 1 });
  assert.equal(s.upcoming.length, 2, "en silla + la pendiente de las 23:45");
  assert.equal(s.upcoming[0].status, "IN_PROGRESS");
  assert.deepEqual(s.queue, { waiting: 2, called: 1 });
  assert.equal(s.alerts.barbersNoSchedule?.count, 1);
  assert.deepEqual(s.alerts.barbersNoSchedule?.names, [NAMES.beto]);
  assert.equal(s.alerts.lowStock?.count, 1, "la cera quedó en 0 con mínimo 2");
  assert.equal(s.alerts.membershipsSoon, 1);
  assert.equal(s.alerts.tomorrowPending, 2, "M1 y la solicitud pública son PENDING");
  assert.equal(s.alerts.tomorrowTotal, 3);
  assert.equal(s.alerts.publicRequests, 1);
  assert.equal(s.setup.isFresh, false);
  if (inicioQueries !== null) assert.ok(inicioQueries <= 8, `Inicio hizo ${inicioQueries} sentencias (tope 8, sin N+1)`);
  console.log(`[stats] Inicio dueño: ${inicioQueries ?? "?"} sentencias SQL`);
});

test("Reportes (dueño, mes): cuadran con comisiones, desglose y métodos de pago", { skip }, async () => {
  let r!: Awaited<ReturnType<typeof getReportsSummary>>;
  const reportQueries = await countStatements(async () => {
    r = await getReportsSummary(A.ctx, { range: "month", features: PRO, now });
  });
  const com = await getCommissionSummary(A.ctx, periodKeyFor(now, TZ));

  assert.equal(r.totals.revenue, com.totals.produced, "Reportes.ingresos = Comisiones.producido");
  assert.equal(r.totals.tips, 50);
  assert.equal(r.totals.products, 150);
  assert.equal(r.totals.discounts, 10);
  assert.equal(r.totals.services, sameMonth ? 670 : 490, "servicios netos de descuento");
  assert.equal(r.totals.services + r.totals.products, r.totals.revenue, "servicios netos + productos = ingresos");
  assert.equal(r.totals.total, r.totals.revenue + r.totals.tips);

  const alanRow = r.byBarber.find((b) => b.barberId === alan)!;
  const betoRow = r.byBarber.find((b) => b.barberId === beto)!;
  const comAlan = com.rows.find((x) => x.barberId === alan)!;
  const comBeto = com.rows.find((x) => x.barberId === beto)!;
  assert.equal(alanRow.produced, comAlan.produced);
  assert.equal(alanRow.commission, comAlan.commissionTotal);
  assert.equal(betoRow.produced, comBeto.produced);
  assert.equal(betoRow.commission, comBeto.commissionTotal);
  assert.equal(alanRow.tickets, comAlan.ticketCount);

  const cash = r.payments.find((p) => p.method === "CASH")!;
  const card = r.payments.find((p) => p.method === "CARD")!;
  const spei = r.payments.find((p) => p.method === "SPEI")!;
  assert.equal(cash.total, sameMonth ? 380 : 200);
  assert.equal(card.total, 280);
  assert.equal(spei.total, 210);
  assert.equal(cash.count + card.count + spei.count, r.totals.tickets);

  const corte = r.topServices.find((i) => i.id === corteA)!;
  assert.equal(corte.qty, sameMonth ? 3 : 2);
  const cera = r.topProducts.find((i) => i.id === ceraA)!;
  assert.equal(cera.revenue, 150);
  assert.equal(cera.margin, 70, "150 − 1 × 80 de costo");

  assert.equal(r.noShows.count, 2);
  assert.equal(r.noShows.repeat.length, 1);
  assert.equal(r.noShows.repeat[0].count, 2);
  assert.equal(r.noShows.repeat[0].name, NAMES.falta);
  assert.ok(r.retention.newClients >= 1, "el cliente fiel tuvo su primera visita en el periodo");
  assert.ok(r.occupancy.totalVisits >= 3, "2 citas atendidas/en silla + la venta de mostrador con servicio");
  const dowToday = new Date(todayStart.getTime() + 12 * 3_600_000).getUTCDay();
  assert.ok(r.occupancy.cells.some((c) => c.dow === dowToday && c.hour === 10 && c.visits >= 1), "la cita de las 10 pinta su celda");
  if (reportQueries !== null) assert.ok(reportQueries <= 12, `Reportes hizo ${reportQueries} sentencias (tope 12)`);
  console.log(`[stats] Reportes dueño: ${reportQueries ?? "?"} sentencias SQL`);

  const csv = buildReportsCsv(r, csvLabels());
  assert.equal(csv.charCodeAt(0), 0xfeff, "BOM para Excel");
  assert.ok(csv.includes(`${NAMES.alan},`) || csv.includes(NAMES.alan), "el CSV trae la fila del barbero");
});

// ── 2. Rol BARBER: solo lo suyo ────────────────────────────────────────

test("Rol BARBER: Inicio y Reportes solo traen su producción; nada de la barbería ni de otros", { skip }, async () => {
  const ctx = await barberCtx(A, alan);
  let s!: Awaited<ReturnType<typeof getInicioSummary>>;
  const n = await countStatements(async () => {
    s = await getInicioSummary(ctx, { features: PRO, now });
  });
  console.log(`[stats] Inicio barbero: ${n ?? "?"} sentencias SQL`);
  assert.equal(s.scope.selfOnly, true);
  assert.equal(s.today.revenue, 360, "solo los dos tickets de Alan");
  assert.equal(s.today.tickets, 2);
  assert.equal(s.today.tips, 50);
  assert.equal(s.cash, null, "sin cash.view no hay turno de caja");
  assert.deepEqual(s.visits, { total: 5, done: 1, pending: 0, inProgress: 1, cancelled: 1, noShow: 2, toCharge: 0 });
  assert.equal(s.upcoming.length, 1, "solo su visita en silla; la de Beto no");
  assert.equal(s.alerts.tomorrowPending, 1, "solo su pendiente de mañana");
  assert.equal(s.alerts.lowStock, null);
  assert.equal(s.alerts.membershipsSoon, null);
  assert.equal(s.alerts.barbersNoSchedule, null);
  assert.equal(s.alerts.publicRequests, null);
  const json = JSON.stringify(s);
  assert.ok(!json.includes(NAMES.beto), "no aparece el otro barbero");
  assert.ok(!json.includes("640"), "no aparece el total de la barbería");

  const r = await getReportsSummary(ctx, { range: "month", features: PRO, now });
  assert.equal(r.scope.selfOnly, true);
  assert.equal(r.byBarber.length, 1);
  assert.equal(r.byBarber[0].barberId, alan);
  assert.equal(r.totals.revenue, sameMonth ? 540 : 360);
  assert.equal(r.byBarber[0].commission, sameMonth ? 216 : 144, "commissions.view sí lo trae el rol");
  assert.ok(!JSON.stringify(r).includes(NAMES.beto));
  assert.equal(r.topProducts.length, 0, "la cera la vendió Beto");

  await assert.rejects(
    () => getReportsSummary(ctx, { range: "month", barberId: beto, features: PRO, now }),
    (e: unknown) => e instanceof BarberCajaError && e.code === "FORBIDDEN_SCOPE",
    "pedir a otro barbero → 403 FORBIDDEN_SCOPE",
  );

  const loose = await barberCtx(A, null);
  const s2 = await getInicioSummary(loose, { features: PRO, now });
  assert.equal(s2.today.revenue, 0, "BARBER sin fila ligada no ve dinero");
  assert.equal(s2.scope.barberLinked, false);
  const r2 = await getReportsSummary(loose, { range: "month", features: PRO, now });
  assert.equal(r2.byBarber.length, 0);
  assert.equal(r2.totals.revenue, 0);
});

// ── 3. Dos barberías no se ven ─────────────────────────────────────────

test("Aislamiento: la barbería B solo ve lo suyo y no aparece en A", { skip }, async () => {
  const sB = await getInicioSummary(B.ctx, { features: AVZ, now });
  assert.equal(sB.today.revenue, 200);
  assert.equal(sB.today.tickets, 1);
  assert.deepEqual(sB.queue, { waiting: 0, called: 0 });
  assert.deepEqual(sB.visits, { total: 0, done: 0, pending: 0, inProgress: 0, cancelled: 0, noShow: 0, toCharge: 0 });
  const jsonB = JSON.stringify(sB);
  for (const n of [NAMES.alan, NAMES.beto, NAMES.fiel, NAMES.falta]) assert.ok(!jsonB.includes(n), `B no ve ${n}`);

  const sA = await getInicioSummary(A.ctx, { features: PRO, now });
  assert.ok(!JSON.stringify(sA).includes(NAMES.bruno));
  assert.equal(sA.today.revenue, 640);

  const rA = await getReportsSummary(A.ctx, { range: "month", features: PRO, now });
  assert.ok(!rA.byBarber.some((b) => b.barberId === bruno));
  // B pidiendo la sede de A como branchId: se ignora y cae a la propia.
  const sB2 = await getInicioSummary(B.ctx, { branchId: A.id, features: AVZ, now });
  assert.deepEqual(sB2.scope.branchIds, [B.id]);
  assert.equal(sB2.today.revenue, 200);
});

// ── 4. Las rutas de la API, llamadas directo ───────────────────────────

async function callRoute(route: { GET: (req: Request) => Promise<Response> }, url: string) {
  const res = await route.GET(new NextRequest(`http://localhost${url}`));
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, body, type };
}

test("API: plan Avanzado ve Inicio pero /stats/reports responde 403 FEATURE_LOCKED; Profesional 200", { skip }, async () => {
  routeCtx = B.ctx; // AVANZADO
  const inicio = await callRoute(inicioRoute, "/api/barber/stats/inicio");
  assert.equal(inicio.status, 200);
  assert.equal(inicio.body.today.revenue, 200);
  const rep = await callRoute(reportsRoute, "/api/barber/stats/reports?range=month");
  assert.equal(rep.status, 403);
  assert.equal(rep.body.code, "FEATURE_LOCKED");
  assert.equal(rep.body.feature, "analytics");
  assert.equal(rep.body.requiredPlan, "PROFESIONAL");

  routeCtx = A.ctx; // PROFESIONAL
  const repA = await callRoute(reportsRoute, "/api/barber/stats/reports?range=month");
  assert.equal(repA.status, 200);
  assert.equal(repA.body.totals.revenue, sameMonth ? 820 : 640);
  const csv = await callRoute(reportsRoute, "/api/barber/stats/reports?range=month&format=csv");
  assert.equal(csv.status, 200);
  assert.ok(csv.type.startsWith("text/csv"));
  assert.ok(String(csv.body).includes(NAMES.alan));

  routeCtx = null;
  const anon = await callRoute(inicioRoute, "/api/barber/stats/inicio");
  assert.equal(anon.status, 401);
});

test("API con rol BARBER: sin el total de la barbería, sin otros barberos, y 403 al pedir a otro", { skip }, async () => {
  routeCtx = await barberCtx(A, alan);
  const inicio = await callRoute(inicioRoute, "/api/barber/stats/inicio");
  assert.equal(inicio.status, 200);
  assert.equal(inicio.body.today.revenue, 360);
  assert.equal(inicio.body.cash, null);
  assert.ok(!JSON.stringify(inicio.body).includes(NAMES.beto));

  const rep = await callRoute(reportsRoute, "/api/barber/stats/reports?range=month");
  assert.equal(rep.status, 200);
  assert.equal(rep.body.byBarber.length, 1);
  assert.equal(rep.body.byBarber[0].barberId, alan);
  assert.ok(!JSON.stringify(rep.body).includes(NAMES.beto));

  const other = await callRoute(reportsRoute, `/api/barber/stats/reports?range=month&barberId=${beto}`);
  assert.equal(other.status, 403);
  assert.equal(other.body.code, "FORBIDDEN_SCOPE");
  routeCtx = null;
});

// ── 5. Periodos ────────────────────────────────────────────────────────

test("resolveReportPeriod: hoy, semana calendario, mes y rango con tope", () => {
  const ref = new Date("2026-08-24T18:00:00Z"); // lunes 24 ago en CDMX
  const today = resolveReportPeriod({ range: "today" }, TZ, ref);
  assert.deepEqual([today.from, today.to, today.days], ["2026-08-24", "2026-08-24", 1]);
  const week = resolveReportPeriod({ range: "week" }, TZ, ref);
  assert.deepEqual([week.from, week.to], ["2026-08-24", "2026-08-24"], "el lunes la semana empieza hoy");
  const sun = resolveReportPeriod({ range: "week" }, TZ, new Date("2026-08-30T18:00:00Z"));
  assert.deepEqual([sun.from, sun.to, sun.days], ["2026-08-24", "2026-08-30", 7]);
  const month = resolveReportPeriod({ range: "month" }, TZ, ref);
  assert.deepEqual([month.from, month.to, month.prevFrom, month.prevTo], ["2026-08-01", "2026-08-24", "2026-07-08", "2026-07-31"]);
  const custom = resolveReportPeriod({ range: "custom", from: "2026-08-10", to: "2026-08-01" }, TZ, ref);
  assert.deepEqual([custom.from, custom.to, custom.days], ["2026-08-01", "2026-08-10", 10], "rango al revés se endereza");
  const huge = resolveReportPeriod({ range: "custom", from: "2020-01-01", to: "2026-08-24" }, TZ, ref);
  assert.equal(huge.days, 366, "tope de 366 días");
  const bad = resolveReportPeriod({ range: "custom", from: "x", to: "y" }, TZ, ref);
  assert.equal(bad.key, "month", "rango inválido cae al mes");
  assert.equal(month.start, "2026-08-01T06:00:00.000Z", "medianoche CDMX = 06:00Z");
});

function csvLabels(): ReportsCsvLabels {
  const id = (s: string) => s;
  return {
    section: id("section"), day: "day", tickets: "tickets", services: "services", products: "products", tips: "tips",
    discounts: "discounts", revenue: "revenue", total: "total", barber: "barber", produced: "produced", avgTicket: "avg",
    commission: "commission", item: "item", qty: "qty", cost: "cost", margin: "margin", marginPct: "marginPct",
    weekday: "weekday", hour: "hour", visits: "visits", client: "client", phone: "phone", noShows: "noShows", lastAt: "lastAt",
    method: "method", share: "share", metric: "metric", value: "value",
    sections: { summary: "summary", byDay: "byDay", byBarber: "byBarber", services: "services", products: "products", occupancy: "occupancy", noShows: "noShows", retention: "retention", payments: "payments" },
    weekdays: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
    methods: { CASH: "Efectivo", CARD: "Tarjeta", SPEI: "SPEI", STRIPE: "En línea" },
    metrics: { period: "period", tickets: "tickets", revenue: "revenue", tips: "tips", total: "total", avgTicket: "avg", prevRevenue: "prev", noShowRate: "rate", newClients: "new", returningClients: "returning", newReturned: "returned", returnRate: "returnRate" },
  };
}
