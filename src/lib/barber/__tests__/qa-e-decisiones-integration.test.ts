// ═══════════════════════════════════════════════════════════════════════
// QA de cierre E — decisiones del 16-nov-2026 (las tomó el gerente; Rafael
// puede cambiarlas), contra una base REAL y por las rutas REALES de
// /api/barber con el getBarberContext REAL (solo la sesión está doblada).
//
//   D1 · «Pagado» incluye lo marcado pagado SIN «sale de la caja»: queda un
//        movimiento «fuera de caja» y Reportes = Comisiones, sin doble conteo.
//   D2 · sin «Ver comisiones» no viajan la Ganancia ni «Comisiones y sueldos».
//   D3 · renta y sueldo cuentan desde el ALTA del barbero.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/qa-e-decisiones-integration.test.ts
// Requiere sql/barber_caja_completa.sql (y sql/barber_sueldo.sql para el sueldo).
// ═══════════════════════════════════════════════════════════════════════
import { sesion, llamar, type Resp } from "./_permisos-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `qe${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const API = path.resolve(__dirname, "../../../app/api/barber");
const ruta = (rel: string) => import(path.join(API, rel, "route.ts")) as Promise<Record<string, Parameters<typeof llamar>[0]>>;

let prisma: typeof import("@/lib/prisma")["prisma"];
let cash: typeof import("@/lib/barber/cash");
let commissions: typeof import("@/lib/barber/commissions");
let movimientos: typeof import("@/lib/barber/caja-movimientos");
let PRO: (typeof import("@/lib/barber/plan-shared"))["FALLBACK_BARBER_PLAN_CONFIG"]["PROFESIONAL"]["features"];
let ready = false;
let hasSalary = false;
let PERIOD = "";
let n = 0;

const sb: Record<string, string> = {};
const ctxs: Record<string, BarberContext> = {};

async function persona(tag: string, shopId: string, role: "OWNER" | "RECEPTION" | "BARBER", extra: Partial<Prisma.BarberUserUncheckedCreateInput> = {}) {
  const supabaseId = `${RUN}-${tag}`;
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Prueba", role, ...extra },
  });
  const barbershop = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  sb[tag] = supabaseId;
  ctxs[tag] = { barberUserId: user.id, barbershopId: shopId, barbershop, user, barber: null, role } as BarberContext;
}

/** Una barbería nueva con su dueño (`tag`) y un servicio de $140 y otro de $80. */
async function barberia(tag: string): Promise<{ id: string; s140: string; s80: string }> {
  n += 1;
  const s = await prisma.barbershop.create({
    data: { name: `QA-E ${n}`, slug: `${RUN}-${n}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ, locale: "es" },
  });
  await persona(tag, s.id, "OWNER");
  const s140 = (await prisma.barberService.create({ data: { barbershopId: s.id, name: "Arreglo de barba", durationMin: 25, price: new Prisma.Decimal(140) } })).id;
  const s80 = (await prisma.barberService.create({ data: { barbershopId: s.id, name: "Delineado", durationMin: 15, price: new Prisma.Decimal(80) } })).id;
  return { id: s.id, s140, s80 };
}

async function como(tag: string, rel: string, query = ""): Promise<Resp> {
  sesion.supabaseId = sb[tag];
  sesion.cookieSede = null;
  sesion.pinSede = null;
  const mod = await ruta(rel);
  return llamar(mod.GET, { url: `http://localhost/api/barber/${rel}${query ? `?${query}` : ""}` });
}
async function post(tag: string, rel: string, cuerpo: unknown): Promise<Resp> {
  sesion.supabaseId = sb[tag];
  sesion.cookieSede = null;
  sesion.pinSede = null;
  const mod = await ruta(rel);
  return llamar(mod.POST, { method: "POST", url: `http://localhost/api/barber/${rel}`, body: cuerpo });
}
const body = (r: Resp) => r.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const filaDe = (r: Resp, id: string) => body(r).byBarber.find((b: { barberId: string }) => b.barberId === id);

async function movimientosDe(barbershopId: string) {
  return prisma.$queryRaw<Array<{ id: string; type: string; method: string; amount: Prisma.Decimal; payoutKind: string | null; sessionId: string | null; voidedAt: Date | null }>>`
    SELECT "id", "type", "method", "amount", "payoutKind", "sessionId", "voidedAt" FROM "barber_cash_movements"
    WHERE "barbershopId" = ${barbershopId} ORDER BY "createdAt" ASC`;
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  commissions = await import("@/lib/barber/commissions");
  movimientos = await import("@/lib/barber/caja-movimientos");
  const { cashMovementsReady, resetCashMovementsReadyCache } = await import("@/lib/barber/cash-movements");
  const { salaryReady, resetSalaryReadyCache } = await import("@/lib/barber/sueldo");
  resetCashMovementsReadyCache();
  resetSalaryReadyCache();
  ready = await cashMovementsReady(prisma);
  hasSalary = await salaryReady(prisma);
  PRO = (await import("@/lib/barber/plan-shared")).FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
  PERIOD = commissions.currentPeriodKey(TZ);
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  if (ready && ids.length > 0) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  if (hasSalary && ids.length > 0) await prisma.$executeRaw`DELETE FROM "barber_salary_payments" WHERE "barbershopId" = ANY(${ids}::text[])`;
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ── D1 ──────────────────────────────────────────────────────────────────
// El caso real de la sucursal QA-E (panel.108, 16-nov): a «QA-E Comi2» (40 %) se
// le marcó pagado SIN «sale de la caja» ($56 + $15.50 de propina = $71.50) y
// después se le pagaron $52 desde la caja. Comisiones decía «Ya pagado
// $123.50» y Reportes «Pagado $52.00».
test("🔴 D1 (caso QA-E Comi2): pagado sin «sale de la caja» → Reportes «Pagado» = Comisiones «Ya pagado», con su desglose y sin doble conteo", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const shop = await barberia("d1");
  const ctx = ctxs.d1;
  const comi2 = (await prisma.barber.create({ data: { barbershopId: shop.id, name: "QA-E Comi2", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) } })).id;
  await cash.openCashSession(ctx, { openingAmount: 500 });
  await cash.createSale(ctx, { barberId: comi2, items: [{ kind: "service", id: shop.s140 }], tip: 15.5, paymentMethod: "SPEI" }, PRO);

  const antes = await como("d1", "stats/reports", "range=today");
  assert.equal(antes.status, 200, JSON.stringify(antes.body).slice(0, 300));
  assert.equal(filaDe(antes, comi2).paidOut, 0);
  const gananciaAntes = body(antes).cashFlow.current.profit;
  assert.equal(gananciaAntes, 84, "140 − 56 de comisión");

  // 1) Marcar pagado SIN «sale de la caja» (la casilla desmarcada de Comisiones).
  const p1 = await post("d1", "commissions/pay", { barberId: comi2, periodKey: PERIOD, expectedTotal: 71.5, fromCash: false });
  assert.equal(p1.status, 200, JSON.stringify(p1.body).slice(0, 300));
  assert.equal(body(p1).paidAmount, 71.5);
  assert.equal(body(p1).movementId ?? null, null, "no salió de la caja");
  assert.ok(body(p1).outsideMovementId, "pero quedó anotado fuera de caja");
  let movs = await movimientosDe(shop.id);
  assert.equal(movs.length, 1);
  assert.deepEqual(
    [movs[0].type, movs[0].payoutKind, movs[0].sessionId, movs[0].method !== "CASH", new Prisma.Decimal(movs[0].amount).toNumber()],
    ["BARBER_PAYOUT", "COMMISSION", null, true, 71.5],
    "sin turno y sin efectivo",
  );
  assert.equal((await cash.getCashState(ctx)).open!.expectedCash, 500, "el cajón no se movió (el ticket fue por SPEI)");

  const tras1 = await como("d1", "stats/reports", "range=today");
  assert.deepEqual([filaDe(tras1, comi2).paidOut, filaDe(tras1, comi2).paidDrawer, filaDe(tras1, comi2).paidOutside], [71.5, 0, 71.5]);
  assert.equal(body(tras1).cashFlow.current.profit, gananciaAntes, "la Ganancia no cambia por pagar");
  assert.equal(body(tras1).cashFlow.current.cashNet, 0, "fuera de caja: el efectivo del periodo no se mueve");

  // 2) Otro ticket, ahora pagado DESDE la caja.
  await cash.createSale(ctx, { barberId: comi2, items: [{ kind: "service", id: shop.s80 }], tip: 20, paymentMethod: "CASH" }, PRO);
  const p2 = await post("d1", "commissions/pay", { barberId: comi2, periodKey: PERIOD, expectedTotal: 52, fromCash: true });
  assert.equal(p2.status, 200, JSON.stringify(p2.body).slice(0, 300));
  assert.ok(body(p2).movementId);
  assert.equal(body(p2).outsideMovementId ?? null, null, "un pago = un registro");
  movs = await movimientosDe(shop.id);
  assert.equal(movs.length, 2, "dos pagos, dos registros: nada duplicado");

  // Comisiones y Reportes dicen lo mismo.
  const com = (await commissions.getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === comi2)!;
  assert.deepEqual([com.paidTotal, com.totalToPay, com.paidStatus], [123.5, 0, "PAID"]);
  const rep = await como("d1", "stats/reports", "range=today");
  const f = filaDe(rep, comi2);
  assert.equal(f.paidOut, com.paidTotal, "«Pagado» de Reportes = «Ya pagado» de Comisiones");
  assert.deepEqual([f.paidDrawer, f.paidOutside, f.advances], [52, 71.5, 0]);
  const cf = body(rep).cashFlow.current;
  assert.deepEqual([cf.payouts.total, cf.payouts.count, cf.payouts.byKind.COMMISSION], [123.5, 2, 123.5]);
  assert.deepEqual(cf.payoutsSplit, { drawer: 52, outside: 71.5 });
  assert.equal(cf.payoutsSplit.drawer + cf.payoutsSplit.outside, cf.payouts.total);
  assert.equal(cf.profit, 132, "220 − 88 de comisión: lo entregado no resta");
  assert.equal(cf.cashNet, 48, "+100 del ticket en efectivo − 52 del pago desde caja");
  assert.equal((await cash.getCashState(ctx)).open!.expectedCash, 548);

  // Inicio: lo entregado hoy y el cajón.
  const ini = await como("d1", "stats/inicio");
  assert.equal(body(ini).money.payouts, 123.5);
  assert.equal(body(ini).cash.expectedCash, 548, "«En caja ahora» = la Caja");

  // CSV: la columna vuelve a ser «Pagado», con su desglose.
  const todo = String((await como("d1", "stats/reports", "range=today&format=csv")).body);
  assert.match(todo, /Comisión,Pagado,Pagado en caja,Pagado fuera de caja,Adelantos/);
  assert.match(todo, /QA-E Comi2,2,220,35\.5,110,88,123\.5,52,71\.5,0/);
  const seccion = String((await como("d1", "stats/reports", "range=today&format=csv&section=money")).body);
  assert.match(seccion, /Entregado a barberos \(informativo\),123\.5/);
  assert.match(seccion, /Entregado en caja \(efectivo del cajón\),52/);
  assert.match(seccion, /Entregado fuera de caja,71\.5/);

  // Anular el registro de fuera de caja deshace ESE pago (y solo ese).
  await movimientos.voidCashMovement(ctx, body(p1).outsideMovementId, { reason: "prueba" });
  const com2 = (await commissions.getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === comi2)!;
  assert.deepEqual([com2.paidTotal, com2.totalToPay], [52, 71.5], "vuelve a deberse lo del primer ticket");
  const rep2 = await como("d1", "stats/reports", "range=today");
  assert.deepEqual([filaDe(rep2, comi2).paidOut, filaDe(rep2, comi2).paidDrawer, filaDe(rep2, comi2).paidOutside], [52, 52, 0]);
});

// ── D2 ──────────────────────────────────────────────────────────────────
// Recepción nace con «Ver caja» y SIN «Ver comisiones»: veía en Inicio «Te queda
// hoy» y «Comisiones y sueldos de hoy», y en Reportes y su CSV la Ganancia y
// «comisión $X · sueldo $Y» (en una barbería con un solo barbero a sueldo, su sueldo).
test("🔴 D2: sin «Ver comisiones» no viajan la Ganancia, «Comisiones y sueldos» ni lo pagado por barbero o por tipo (Inicio, Reportes, CSV y API)", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const shop = await barberia("d2");
  const ctx = ctxs.d2;
  const comi = (await prisma.barber.create({ data: { barbershopId: shop.id, name: "Comi", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  if (hasSalary) {
    const fijo = (await prisma.barber.create({ data: { barbershopId: shop.id, name: "Fijo", commissionType: "SALARY" } })).id;
    await (await import("@/lib/barber/sueldo")).saveSalary(prisma, fijo, { amount: 6000, period: "MONTHLY" });
  }
  await persona("d2recep", shop.id, "RECEPTION"); // de fábrica
  await persona("d2recepCom", shop.id, "RECEPTION", { permissionsOverride: ["cash.view", "cash.manage", "cash.expenses", "commissions.view"] });

  await cash.openCashSession(ctx, { openingAmount: 500 });
  await cash.createSale(ctx, { barberId: comi, items: [{ kind: "service", id: shop.s140 }], tip: 10, paymentMethod: "CASH" }, PRO);
  await movimientos.createCashMovement(ctx, { type: "EXPENSE", amount: 30, category: "SUPPLIES" });
  const pago = await post("d2", "commissions/pay", { barberId: comi, periodKey: PERIOD, expectedTotal: 80, fromCash: true });
  assert.equal(pago.status, 200, JSON.stringify(pago.body).slice(0, 300));
  // Hoy: 140 de ingresos − 30 de gastos − 70 de comisión − 200 del sueldo de un día (6,000 / 30).
  const ganancia = hasSalary ? -160 : 40;

  // El dueño lo ve todo, como antes.
  const repDueno = await como("d2", "stats/reports", "range=today");
  assert.equal(body(repDueno).cashFlow.current.profit, ganancia);
  assert.equal(body(repDueno).cashFlow.current.barberCost.commission, 70);
  if (hasSalary) assert.equal(body(repDueno).cashFlow.current.barberCost.salary, 200);
  assert.equal(body(repDueno).cashFlow.current.payouts.byKind.COMMISSION, 80);
  assert.equal(filaDe(repDueno, comi).paidOut, 80);
  const iniDueno = await como("d2", "stats/inicio");
  assert.equal(body(iniDueno).money.profit, ganancia);
  assert.equal(body(iniDueno).money.noProfit ?? false, false);

  // Recepción de fábrica («Ver caja», sin «Ver comisiones»).
  const ini = await como("d2recep", "stats/inicio");
  assert.equal(ini.status, 200, JSON.stringify(ini.body).slice(0, 300));
  const m = body(ini).money;
  assert.ok(m, "el dinero del día sí viaja: tiene «Ver caja»");
  assert.deepEqual([m.income, m.expenses, m.expensesCash, m.tips], [140, 30, 30, 10]);
  assert.deepEqual([m.profit, m.barberCost, m.payouts], [null, null, null], "ni «Te queda hoy» ni «Comisiones y sueldos de hoy»");
  assert.equal(m.noProfit, true);
  assert.equal(m.unavailable ?? false, false, "no es una falla de lectura");
  assert.equal(body(ini).cash.expectedCash, 540, "el cajón sí: 500 + 150 − 30 − 80");

  const rep = await como("d2recep", "stats/reports", "range=today");
  assert.equal(rep.status, 200, JSON.stringify(rep.body).slice(0, 300));
  const cf = body(rep).cashFlow;
  assert.ok(cf, "«Ingresos y gastos» sí viaja");
  assert.deepEqual([cf.current.charged, cf.current.income, cf.current.expenses.total, cf.current.cashNet], [150, 140, 30, 40]);
  assert.deepEqual([cf.current.profit, cf.current.barberCost, cf.previous.profit, cf.vsPrevProfitPct], [null, null, null, null]);
  assert.equal(cf.current.payouts.total, 80, "el total entregado es dinero que salió: sí");
  assert.deepEqual(cf.current.payoutsSplit, { drawer: 80, outside: 0 });
  assert.ok(Object.values(cf.current.payouts.byKind).every((v) => v === 0), "por tipo (ahí va «Sueldos») no");
  assert.deepEqual(cf.current.byBarber, [], "por barbero tampoco");
  const fr = filaDe(rep, comi);
  assert.equal(fr.commission, null);
  assert.ok(!("paidOut" in fr) && !("paidDrawer" in fr) && !("paidOutside" in fr) && !("advances" in fr), "«Pagado» y «Adelantos» no viajan");
  const crudo = JSON.stringify(rep.body) + JSON.stringify(ini.body);
  assert.doesNotMatch(crudo, /"profit":-?\d/, "ningún número de ganancia en la respuesta");
  assert.doesNotMatch(crudo, /"barberCost":(\{|-?\d)/, "ni lo devengado");
  assert.doesNotMatch(crudo, /"salary":\d/);

  const csv = String((await como("d2recep", "stats/reports", "range=today&format=csv&section=money")).body);
  assert.match(csv, /Ingresos \(sin propinas\),140/);
  assert.match(csv, /Gastos,30/);
  assert.match(csv, /Entregado a barberos \(informativo\),80/);
  assert.doesNotMatch(csv, /Ganancia|devengados|Pagos a barberos por tipo|Sueldos|Comisiones,/);
  const todo = String((await como("d2recep", "stats/reports", "range=today&format=csv")).body);
  assert.match(todo, /Ingresos y gastos/);
  assert.doesNotMatch(todo, /Ganancia|devengados|Pagos a barberos por tipo|Sueldos|Pagado|Adelantos|Comisión/);

  // Con «Ver comisiones» encendido, Recepción lo vuelve a ver todo.
  const rep2 = await como("d2recepCom", "stats/reports", "range=today");
  assert.equal(body(rep2).cashFlow.current.profit, ganancia);
  assert.equal(filaDe(rep2, comi).paidOut, 80);
  assert.equal(body(await como("d2recepCom", "stats/inicio")).money.profit, ganancia);
  assert.match(String((await como("d2recepCom", "stats/reports", "range=today&format=csv&section=money")).body), /Ganancia,/);
});
