/**
 * Finanzas · dos números que engañaban.
 *   A) Un gasto con fecha futura del mes en curso desaparecía: «este mes»
 *      cortaba en *ahora* también para los gastos.
 *   B) «Ventas» y «por doctor» contaban facturas en borrador (DRAFT).
 *
 * Corre con: npm run test:finanzas-periodo
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NOT_A_SALE_STATUSES, expenseWindowEnd, serieEnd } from "../finanzas-periodo";
import { bucketKeyOf, eachBucket } from "../analytics/query";

// 5 de septiembre de 2026, 10:00 en México (UTC-6).
const AHORA = new Date("2026-09-05T10:00:00.000-06:00");
// Lo que guarda /api/gastos para «2026-09-30»: las 00:00 de México.
const RENTA_DEL_30 = new Date("2026-09-30T00:00:00.000-06:00");

test("A · «mes»: la renta del 30 registrada el 5 entra en la ventana de gastos", () => {
  const fin = expenseWindowEnd("mes", AHORA, AHORA);
  assert.equal(fin.toISOString(), new Date("2026-09-30T23:59:59.999-06:00").toISOString());
  assert.ok(RENTA_DEL_30 <= fin, "el gasto futuro del mes se ve y resta");
  // …pero NO se cuela el mes siguiente.
  assert.ok(new Date("2026-10-01T00:00:00.000-06:00") > fin);
});

test("A · sin `period` (default) y con un valor desconocido se comporta como «mes»", () => {
  const esperado = expenseWindowEnd("mes", AHORA, AHORA).getTime();
  assert.equal(expenseWindowEnd(null, AHORA, AHORA).getTime(), esperado);
  assert.equal(expenseWindowEnd("loquesea", AHORA, AHORA).getTime(), esperado);
});

test("A · el fin de mes es el de MÉXICO, no el de UTC (último día, de noche)", () => {
  // 30-sep 20:00 MX ya es 1-oct en UTC: el mes sigue siendo septiembre.
  const noche = new Date("2026-09-30T20:00:00.000-06:00");
  const fin = expenseWindowEnd("mes", noche, noche);
  assert.equal(fin.toISOString(), new Date("2026-09-30T23:59:59.999-06:00").toISOString());
});

test("A · diciembre cierra en diciembre (el +1 de mes no se va de año mal)", () => {
  const dic = new Date("2026-12-10T09:00:00.000-06:00");
  const fin = expenseWindowEnd("mes", dic, dic);
  assert.equal(fin.toISOString(), new Date("2026-12-31T23:59:59.999-06:00").toISOString());
});

test("A · «hoy», «mes_anterior» y «custom» NO se tocan: devuelven su `to` tal cual", () => {
  const to = new Date("2026-08-31T23:59:59.999-06:00");
  for (const p of ["hoy", "mes_anterior", "custom"]) {
    assert.equal(expenseWindowEnd(p, AHORA, to), to, p);
  }
});

test("A · la serie se alarga SOLO hasta el último gasto futuro, y su suma es el KPI", () => {
  const from = new Date("2026-09-01T00:00:00.000-06:00");
  const gastos = [
    { amount: 1200, date: new Date("2026-09-03T00:00:00.000-06:00") },
    { amount: 18000, date: RENTA_DEL_30 },
  ];
  const fin = serieEnd(AHORA, gastos.map((g) => g.date));
  const dias = eachBucket(from, fin, "day");
  assert.equal(dias.length, 30);
  const porDia: Record<string, number> = {};
  for (const g of gastos) porDia[bucketKeyOf(g.date, "day")] = g.amount;
  const suma = dias.reduce((s, d) => s + (porDia[d] ?? 0), 0);
  assert.equal(suma, 19200, "la gráfica suma lo que dice la tarjeta de gastos");
});

test("A · sin gastos futuros la serie es EXACTAMENTE la de antes", () => {
  const pasado = [new Date("2026-09-03T00:00:00.000-06:00")];
  assert.equal(serieEnd(AHORA, pasado), AHORA);
  assert.equal(serieEnd(AHORA, []), AHORA);
});

test("B · un borrador no es una venta (ni una cancelada)", () => {
  assert.deepEqual([...NOT_A_SALE_STATUSES], ["DRAFT", "CANCELLED"]);
});

// Guardia sobre el código de las rutas: que nadie vuelva a la ventana cortada
// en «ahora» para gastos, ni a contar borradores.
const raiz = path.resolve(__dirname, "../../..");
const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

test("las dos rutas usan la MISMA ventana de gastos (lista = tarjeta = utilidad)", () => {
  for (const rel of ["src/app/api/finanzas/route.ts", "src/app/api/gastos/route.ts"]) {
    const src = leer(rel);
    assert.match(src, /expenseWindowEnd\(/, rel);
    assert.match(src, /date:\s*\{\s*gte:\s*(win\.)?from,\s*lte:\s*expenseTo\s*\}/, rel);
  }
});

test("/api/finanzas: ventas y porDoctor excluyen DRAFT; nada filtra ya solo CANCELLED", () => {
  const src = leer("src/app/api/finanzas/route.ts");
  assert.equal((src.match(/notIn:\s*\[\.\.\.NOT_A_SALE_STATUSES\]/g) ?? []).length, 2);
  // El único `not: "CANCELLED"` que queda es el de las citas, que no se tocó.
  assert.equal((src.match(/not:\s*"CANCELLED"/g) ?? []).length, 1);
});
