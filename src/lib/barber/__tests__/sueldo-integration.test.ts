// ═══════════════════════════════════════════════════════════════════════
// Sueldo del barbero contra una base REAL (ws6-t6, 16-nov-2026).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/sueldo-integration.test.ts
//
// Requiere sql/barber_sueldo.sql YA pegado en esa base local (si no, se
// salta y lo dice). Conduce lo real: updateBarberProfile/listBarbers
// (Equipo), getCommissionSummary / markCommissionsPaid / getCommissionReceipt
// (Comisiones) y createSale (Caja).
//
//   · el sueldo mensual se suma a «A pagar» con sus propinas, aunque no haya
//     tickets; se paga UNA vez por periodo y queda congelado;
//   · semanal en un mes de 30 días = prorrateo «aprox.»;
//   · al pasar a Comisión el monto se conserva pero deja de contar, y al
//     volver a Sueldo vuelve a contar;
//   · validación: monto 0 o sin periodo → 400 y no se guarda nada;
//   · el rol Barbero ve su sueldo y no el de otros.
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  currentPeriodKey,
  getCommissionReceipt,
  getCommissionSummary,
  markCommissionsPaid,
  BarberCajaError,
} from "@/lib/barber/commissions";
import { createSale, openCashSession } from "@/lib/barber/cash";
import { listBarbers, updateBarberProfile } from "@/lib/barber/team";
import { salaryForPeriodKey } from "@/lib/barber/sueldo-core";
import { resetSalaryReadyCache, salaryReady } from "@/lib/barber/sueldo";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `s${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const TZ = "America/Mexico_City";
const PERIOD = currentPeriodKey(TZ);

let skip: false | string = skipDb;
let ctx: BarberContext;
let shopId: string;
let fijo: string; // sueldo mensual $9,000
let semanal: string; // sueldo semanal $3,000
let otro: string; // comisión, con sueldo guardado que no cuenta
let corte: string;

async function row(barberId: string, c: BarberContext = ctx) {
  const summary = await getCommissionSummary(c, PERIOD);
  return summary.rows.find((r) => r.barberId === barberId)!;
}

before(async () => {
  if (!HAS_DB) return;
  resetSalaryReadyCache();
  if (!(await salaryReady(prisma))) {
    skip = "sql/barber_sueldo.sql no está pegado en esta base local";
    return;
  }
  const shop = await prisma.barbershop.create({
    data: { name: "Barbería Sueldo", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ },
  });
  shopId = shop.id;
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "S", role: "OWNER" },
  });
  ctx = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber: null, role: "OWNER" };
  const [a, b, c] = await Promise.all([
    prisma.barber.create({ data: { barbershopId: shopId, name: "Fijo Mensual", commissionType: "SALARY" } }),
    prisma.barber.create({ data: { barbershopId: shopId, name: "Fijo Semanal", commissionType: "SALARY" } }),
    prisma.barber.create({ data: { barbershopId: shopId, name: "A Comisión", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } }),
  ]);
  fijo = a.id;
  semanal = b.id;
  otro = c.id;
  corte = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  await openCashSession(ctx, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  if (ids.length > 0 && !skip) {
    await prisma.$executeRaw`DELETE FROM "barber_salary_payments" WHERE "barbershopId" = ANY(${ids}::text[])`;
  }
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("Equipo: monto 0 o sin «cada cuándo» → 400 claro y no se guarda nada", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(updateBarberProfile(ctx, fijo, { salaryAmount: "0", salaryPeriod: "MONTHLY" }), /mayor a \$0/);
  await assert.rejects(updateBarberProfile(ctx, fijo, { salaryAmount: "9000", salaryPeriod: "" }), /cada cuándo/);
  const lista = await listBarbers(ctx, [shopId]);
  assert.equal(lista.find((b) => b.id === fijo)!.salaryAmount, null);
});

test("Equipo: se guarda opcional y la ficha lo devuelve («Sueldo $9,000 mensual»)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const r1 = await updateBarberProfile(ctx, fijo, { salaryAmount: "$9,000", salaryPeriod: "MONTHLY" });
  assert.equal(r1.salaryAmount, 9000);
  assert.equal(r1.salaryPeriod, "MONTHLY");
  await updateBarberProfile(ctx, semanal, { salaryAmount: "3000", salaryPeriod: "WEEKLY" });
  // Otro a comisión, con un sueldo capturado que NO debe contar.
  await updateBarberProfile(ctx, otro, { salaryAmount: "5000", salaryPeriod: "MONTHLY" });
  const lista = await listBarbers(ctx, [shopId]);
  assert.equal(lista.find((b) => b.id === semanal)!.salaryPeriod, "WEEKLY");
  // Editar otra cosa sin mandar el sueldo no lo borra.
  const r2 = await updateBarberProfile(ctx, fijo, { nickname: "Fijo" });
  assert.equal(r2.salaryAmount, 9000);
});

test("Comisiones: sin tickets, el sueldo del mes va en «A pagar» y en el estado", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const r = await row(fijo);
  assert.equal(r.salaryPeriodTotal, 9000);
  assert.equal(r.salaryApprox, false);
  assert.equal(r.salaryPending, 9000);
  assert.equal(r.totalToPay, 9000);
  assert.equal(r.paidStatus, "PENDING", "no «Sin tickets»: hay sueldo por pagar");
});

test("Comisiones: semanal en el mes que se ve = prorrateo por días, «aprox.» si no son semanas exactas", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const esperado = salaryForPeriodKey({ amount: 3000, period: "WEEKLY" }, PERIOD);
  const r = await row(semanal);
  assert.equal(r.salaryPeriodTotal, esperado.amount.toNumber());
  assert.equal(r.salaryApprox, esperado.approx);
  assert.equal(r.totalToPay, esperado.amount.toNumber());
});

test("Comisiones: el sueldo guardado de quien cobra a comisión no cuenta", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const r = await row(otro);
  assert.equal(r.salaryAmount, 5000, "se ve el dato guardado…");
  assert.equal(r.salaryPeriodTotal, null, "…pero no suma");
  assert.equal(r.totalToPay, 0);
  assert.equal(r.paidStatus, "EMPTY");
});

test("Comisiones: sueldo + propina = «A pagar»; marcar pagado lo cubre UNA vez y queda congelado", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  await createSale(ctx, { barberId: fijo, items: [{ kind: "service", id: corte }], tip: 50, paymentMethod: "CASH" }, FEATURES);
  const antes = await row(fijo);
  assert.equal(antes.totalToPay, 9050, "sueldo $9,000 + propina $50; el corte no comisiona (sueldo fijo)");

  const pago = await markCommissionsPaid(ctx, { barberId: fijo, periodKey: PERIOD, expectedTotal: 9050 });
  assert.equal(pago.paidAmount, 9050);
  assert.equal(pago.marked, 2, "la entrada del ticket + el sueldo");

  const despues = await row(fijo);
  assert.equal(despues.totalToPay, 0);
  assert.equal(despues.paidTotal, 9050);
  assert.equal(despues.salaryPaid, 9000);
  assert.equal(despues.salaryPending, 0);
  assert.equal(despues.paidStatus, "PAID");

  // Un segundo clic no paga dos veces.
  const otraVez = await markCommissionsPaid(ctx, { barberId: fijo, periodKey: PERIOD });
  assert.equal(otraVez.marked, 0);
  assert.equal(otraVez.paidAmount, 0);

  // Subirle el sueldo después NO reescribe lo ya pagado del periodo.
  await updateBarberProfile(ctx, fijo, { salaryAmount: "10000", salaryPeriod: "MONTHLY" });
  const congelado = await row(fijo);
  assert.equal(congelado.salaryPeriodTotal, 9000);
  assert.equal(congelado.totalToPay, 0);

  // El recibo sale de la misma fila.
  const recibo = await getCommissionReceipt(ctx, { barberId: fijo, periodKey: PERIOD });
  assert.equal(recibo!.row.salaryPaid, 9000);
  assert.equal(recibo!.row.paidTotal, 9050);
});

test("Comisiones: si la cifra cambió (le pusieron sueldo con el diálogo abierto), no se paga nada", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(
    markCommissionsPaid(ctx, { barberId: semanal, periodKey: PERIOD, expectedTotal: 0 }),
    (e: unknown) => e instanceof BarberCajaError && e.code === "PAYOUT_CHANGED",
  );
  assert.equal((await row(semanal)).salaryPaid, null);
});

test("Equipo: pasar a Comisión no borra el monto; deja de contar y vuelve a contar al regresar a Sueldo", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const aComision = await updateBarberProfile(ctx, semanal, { commissionType: "COMMISSION", commissionPct: 40 });
  assert.equal(aComision.salaryAmount, 3000, "el monto se conserva");
  assert.equal((await row(semanal)).salaryPeriodTotal, null, "pero no cuenta");
  await updateBarberProfile(ctx, semanal, { commissionType: "SALARY" });
  assert.ok((await row(semanal)).salaryPeriodTotal! > 0, "vuelve a contar");
});

test("Rol Barbero: ve su sueldo y no el de los demás", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const barbero = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-barb`, email: `${RUN}-b@test.local`, firstName: "Fijo", lastName: "S", role: "BARBER", barberId: fijo },
  });
  const ficha = await prisma.barber.findUniqueOrThrow({ where: { id: fijo } });
  const c = { ...ctx, barberUserId: barbero.id, user: barbero, barber: ficha, role: "BARBER" } as BarberContext;
  const summary = await getCommissionSummary(c, PERIOD);
  assert.deepEqual(summary.rows.map((r) => r.barberId), [fijo]);
  assert.equal(summary.rows[0].salaryPaid, 9000);
  await assert.rejects(getCommissionSummary(c, PERIOD, { barberId: semanal }), /tus propias comisiones/);
  // Y Barberos (con los sueldos de todos) exige barbers.manage.
  await assert.rejects(listBarbers(c, [shopId]));
});
