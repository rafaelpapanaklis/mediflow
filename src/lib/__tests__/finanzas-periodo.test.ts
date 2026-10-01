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
import { NOT_A_SALE_STATUSES, expenseWindowEnd, resolveFinanzasWindow, serieEnd } from "../finanzas-periodo";
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
  // /api/finanzas delega el cálculo en @/lib/finanzas-resumen.server (lo lee
  // también Sabina): la ruta calcula `expenseTo` y la función lo aplica.
  const finanzas = leer("src/app/api/finanzas/route.ts");
  assert.match(finanzas, /expenseWindowEnd\(/, "finanzas/route.ts");
  assert.match(finanzas, /calcularResumenFinanzas\(/, "finanzas/route.ts");
  assert.match(leer("src/lib/finanzas-resumen.server.ts"), /date:\s*\{\s*gte:\s*from,\s*lte:\s*expenseTo\s*\}/);
  const gastos = leer("src/app/api/gastos/route.ts");
  assert.match(gastos, /expenseWindowEnd\(/, "gastos/route.ts");
  assert.match(gastos, /listarGastosDelPeriodo\(/, "gastos/route.ts");
  assert.match(leer("src/lib/gastos-periodo.server.ts"), /date:\s*\{\s*gte:\s*from,\s*lte:\s*expenseTo\s*\}/);
});

test("/api/finanzas: ventas y porDoctor excluyen DRAFT; nada filtra ya solo CANCELLED", () => {
  const src = leer("src/lib/finanzas-resumen.server.ts"); // el cálculo vive aquí; la ruta lo llama
  assert.equal((src.match(/notIn:\s*\[\.\.\.NOT_A_SALE_STATUSES\]/g) ?? []).length, 2);
  // El único `not: "CANCELLED"` que queda es el de las citas, que no se tocó.
  assert.equal((src.match(/not:\s*"CANCELLED"/g) ?? []).length, 1);
});

// ── La ventana del periodo (ws1-t5, ronda 6): la comparten /api/finanzas y el
// bloque «Ortodoncia» (/api/finanzas/ortodoncia), para que hablen del mismo mes.
const sp = (q: string) => new URLSearchParams(q);

test("ventana · «mes» va del día 1 de México a ahora; es también el default", () => {
  const w = resolveFinanzasWindow(sp("period=mes"), AHORA);
  assert.ok(!("error" in w));
  if ("error" in w) return;
  assert.equal(w.from.toISOString(), new Date("2026-09-01T00:00:00.000-06:00").toISOString());
  assert.equal(w.to.getTime(), AHORA.getTime());
  assert.deepEqual(resolveFinanzasWindow(sp(""), AHORA), w);
  assert.deepEqual(resolveFinanzasWindow(sp("period=cualquiera"), AHORA), w);
});

test("ventana · «hoy» y «mes_anterior»", () => {
  const hoy = resolveFinanzasWindow(sp("period=hoy"), AHORA);
  assert.ok(!("error" in hoy));
  if (!("error" in hoy)) assert.equal(hoy.from.toISOString(), new Date("2026-09-05T00:00:00.000-06:00").toISOString());
  const ant = resolveFinanzasWindow(sp("period=mes_anterior"), AHORA);
  assert.ok(!("error" in ant));
  if (!("error" in ant)) {
    assert.equal(ant.from.toISOString(), new Date("2026-08-01T00:00:00.000-06:00").toISOString());
    assert.equal(ant.to.toISOString(), new Date("2026-08-31T23:59:59.999-06:00").toISOString());
  }
});

test("ventana · «custom» exige las dos fechas, bien formadas y en orden", () => {
  const ok = resolveFinanzasWindow(sp("period=custom&from=2026-09-01&to=2026-09-03"), AHORA);
  assert.ok(!("error" in ok));
  if (!("error" in ok)) assert.equal(ok.to.toISOString(), new Date("2026-09-03T23:59:59.999-06:00").toISOString());
  assert.ok("error" in resolveFinanzasWindow(sp("period=custom&from=2026-09-01"), AHORA));
  assert.ok("error" in resolveFinanzasWindow(sp("period=custom&from=01/09/2026&to=2026-09-03"), AHORA));
  assert.ok("error" in resolveFinanzasWindow(sp("period=custom&from=2026-09-05&to=2026-09-03"), AHORA));
});
