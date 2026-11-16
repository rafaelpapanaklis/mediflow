// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1), punto 4: pestañas «Cortes» y «Gastos» y sus CSV,
// contra una base REAL.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-cortes-gastos-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { closeCashSession, listCortes, openCashSession } from "@/lib/barber/cash";
import { currentPeriodKey, shiftPeriodKey } from "@/lib/barber/commissions";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement, listExpenses } from "@/lib/barber/caja-movimientos";
import { cortesCsv, csvLine, gastosCsv, type CortesCsvLabels } from "@/lib/barber/caja-csv";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cg${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
let skip: false | string = skipDb;
let ctx: BarberContext;
let otro: BarberContext;

async function shop(suffix: string): Promise<BarberContext> {
  const s = await prisma.barbershop.create({ data: { name: `CG ${suffix}`, slug: `${RUN}-${suffix}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ } });
  const user = await prisma.barberUser.create({ data: { barbershopId: s.id, supabaseId: `${RUN}-${suffix}`, email: `${RUN}-${suffix}@test.local`, firstName: "Lu", lastName: suffix, role: "OWNER" } });
  return { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
}

const LABELS = new Proxy({}, { get: (_t, k) => String(k) }) as CortesCsvLabels;

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  if (!(await cashMovementsReady(prisma))) {
    skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
    return;
  }
  ctx = await shop("a");
  otro = await shop("b");
  // Gasto fuera de caja (renta por transferencia), luego un turno con gastos y un corte.
  await createCashMovement(ctx, { type: "EXPENSE", amount: 4500, method: "TRANSFER", category: "RENT", note: "=SUMA(A1)" });
  await openCashSession(ctx, { openingAmount: 500 });
  await createCashMovement(ctx, { type: "EXPENSE", amount: 80, category: "SUPPLIES", note: "Garrafón, el grande" });
  await createCashMovement(ctx, { type: "WITHDRAWAL", amount: 100 });
  await closeCashSession(ctx, { countedAmount: 310, leftForNext: 300 });
  await openCashSession(ctx, { openingAmount: 300 });
  // Otra barbería: no se debe ver nunca.
  await createCashMovement(otro, { type: "EXPENSE", amount: 999, category: "RENT" });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  if (ids.length > 0 && !skip) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("Cortes: los del mes con esperado, contado, diferencia y su resumen; el CSV dice lo mismo", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const rows = await listCortes(ctx, currentPeriodKey(TZ));
  assert.equal(rows.length, 2, "el cerrado y el abierto de hoy");
  const cerrado = rows.find((r) => r.closedAt)!;
  assert.equal(cerrado.expectedAmount, 320, "500 − 80 − 100");
  assert.equal(cerrado.countedAmount, 310);
  assert.equal(cerrado.difference, -10);
  assert.equal(cerrado.leftForNext, 300);
  assert.equal(cerrado.resumen.expenses.total, 80, "la renta fuera de caja no es de este corte");
  const csv = cortesCsv(rows, LABELS, TZ);
  assert.ok(csv.startsWith("﻿"), "BOM para Excel");
  const lineas = csv.trim().split("\r\n");
  assert.equal(lineas.length, 3);
  const fila = lineas.find((l) => l.includes(",310,"))!;
  assert.match(fila, /,500,0,0,80,100,0,0,320,310,-10,300,/, "fondo, efectivo, entradas, gastos, retiros, pagos, devol., esperado, contado, dif., fondo mañana");
  assert.deepEqual(await listCortes(ctx, shiftPeriodKey(currentPeriodKey(TZ), -1)), [], "el mes pasado está vacío");
});

test("Gastos: TODOS los del mes (también fuera de caja), filtro por categoría, totales; nada de otra barbería", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const all = await listExpenses(ctx, {});
  assert.equal(all.items.length, 2);
  assert.equal(all.resumen.total, 4580);
  assert.deepEqual(all.resumen.byCategory.map((c) => [c.category, c.total]), [["RENT", 4500], ["SUPPLIES", 80]]);
  assert.equal(all.items.filter((m) => m.sessionId === null).length, 1, "la renta va fuera de caja");
  const solo = await listExpenses(ctx, { category: "SUPPLIES" });
  assert.equal(solo.items.length, 1);
  assert.equal(solo.resumen.total, 80);
  const raro = await listExpenses(ctx, { category: "NO-EXISTE", periodKey: "2026-99" });
  assert.equal(raro.category, null, "categoría desconocida = todas");
  assert.match(raro.periodKey, /^\d{4}-\d{2}$/, "periodo inválido = el actual");

  const csv = gastosCsv(all.items, {
    date: "Fecha", category: "Categoría", amount: "Monto", method: "Pagado con", note: "Nota", who: "Registró", inRegister: "En caja",
    yes: "Sí", no: "No", voided: "Anulado", categoryOf: (c) => c ?? "", methodOf: (m) => m,
  }, TZ);
  const lineas = csv.replace("﻿", "").trim().split("\r\n");
  assert.equal(lineas[0], "Fecha,Categoría,Monto,Pagado con,Nota,Registró,En caja");
  assert.ok(lineas.some((l) => l.includes(',SUPPLIES,80,CASH,"Garrafón, el grande",Lu a,Sí')), lineas.join("\n"));
  assert.ok(lineas.some((l) => l.includes(",RENT,4500,TRANSFER,'=SUMA(A1),Lu a,No")), "una nota que empieza con = no corre como fórmula");
});

test("csvLine: comillas, comas y saltos de línea se escapan; los números negativos siguen siendo números", () => {
  assert.equal(csvLine(['a "b"', "x,y", "l1\nl2", -10, 0.5, null, "-5"]), `"a ""b""","x,y","l1\nl2",-10,0.5,,'-5`);
});
