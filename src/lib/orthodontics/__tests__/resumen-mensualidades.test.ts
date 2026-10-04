/**
 * Caja: cifras que dicen qué cuentan y no se contradicen (ws1-t2, auditoría de
 * uso del 3/4-oct-2026, C-21, C-22, C-23 y C-24).
 *
 * Run: npm run test:caja-cifras
 *
 *   · C-22: «14 mensualidades por cobrar · 15 vencidas» (filas contra cuotas).
 *   · C-23: «Vencido» $66,100 en Caja, $62,100 en Caja › Ortodoncia y $60,100
 *     en Cobranza, sin que ninguna dijera qué incluye.
 *   · C-21: «TOTAL COBRADO $102,370» sin periodo ni «Qué cuenta», y «ESTE MES
 *     37» (con borradores y canceladas) contra «VENTAS 34» de Finanzas.
 *   · C-24: el Hoy de recepción decía «1 factura por cobrar · $800» con otro
 *     cálculo que el del dueño («15 vencidas · $66,900»).
 *
 * Con el código viejo falla: `resumen-mensualidades.ts` no existía, la cabecera
 * contaba `items.length`, Caja contaba todas las facturas del mes y recepción
 * sumaba `total − paid` a mano.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { desgloseDeCuotas, resumenDeMensualidades, rotuloDeCuotas, type FilaDeMensualidad } from "@/lib/orthodontics/resumen-mensualidades";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

// La foto de la auditoría: 14 filas; 13 vencidas que juntan 15 cuotas ($60,100) y 1 próxima ($2,000).
const FILAS: FilaDeMensualidad[] = [
  { estado: "vencida", monto: 16_000, cantidadVencidas: 2 },
  { estado: "vencida", monto: 16_000, cantidadVencidas: 2 },
  { estado: "vencida", monto: 9_100, cantidadVencidas: 1 },
  { estado: "vencida", monto: 4_400, cantidadVencidas: 1 },
  { estado: "vencida", monto: 3_300, cantidadVencidas: 1 },
  { estado: "vencida", monto: 3_300, cantidadVencidas: 1 },
  { estado: "vencida", monto: 3_000, cantidadVencidas: 1 },
  { estado: "vencida", monto: 2_000, cantidadVencidas: 1 },
  { estado: "vencida", monto: 1_000, cantidadVencidas: 1 },
  { estado: "vencida", monto: 800, cantidadVencidas: 1 },
  { estado: "vencida", monto: 600, cantidadVencidas: 1 },
  { estado: "vencida", monto: 300, cantidadVencidas: 1 },
  { estado: "vencida", monto: 300, cantidadVencidas: 1 },
  { estado: "proxima", monto: 2_000, cantidadVencidas: 0 },
];

test("C-22: la cabecera cuenta cuotas, nunca «más vencidas que por cobrar»", () => {
  assert.equal(FILAS.length, 14, "lo que decía antes: «14 mensualidades por cobrar»");
  const r = resumenDeMensualidades(FILAS);
  assert.equal(r.vencidas, 15);
  assert.equal(r.cuotas, 16);
  assert.ok(r.cuotas >= r.vencidas);
  assert.equal(rotuloDeCuotas(r.cuotas), "16 cuotas por cobrar");
  assert.equal(desgloseDeCuotas(r), "15 vencidas · 1 próxima");
  assert.equal(rotuloDeCuotas(1), "1 cuota por cobrar");
  assert.equal(desgloseDeCuotas({ vencidas: 1, hoy: 2, proximas: 0 }), "1 vencida · 2 vencen hoy");
});

test("C-23: «Vencido» de Caja › Ortodoncia es el de Cobranza; lo de la semana va aparte", () => {
  const r = resumenDeMensualidades(FILAS);
  assert.equal(r.montoVencido, 60_100, "el mismo «Vencido» que Cobranza, Inicio y Finanzas de ortodoncia");
  assert.equal(r.montoTotal, 62_100, "con lo que vence en la semana (lo que antes se llamaba «Total»)");
  const lista = leer("src/components/specialties/orthodontics/cobranza/ListaMensualidades.tsx");
  assert.match(lista, /resumenDeMensualidades\(items\)/);
  assert.match(lista, /clave="ortoMensualidades"/);
  assert.doesNotMatch(lista, /items\.length\} mensualidades`\} por cobrar/);
});

test("C-23: el «Vencido» de Caja dice de dónde sale, en las dos Cajas y en Facturas", () => {
  assert.match(leer("src/components/dashboard/caja-rediseno/caja-nueva.tsx"), /qc\("cajaVencido"\)/);
  assert.match(leer("src/app/dashboard/caja/caja-client.tsx"), /qc\("cajaVencido"\)/);
  const facturas = leer("src/app/dashboard/billing/billing-client.tsx");
  for (const c of ["cajaPagado", "porCobrar", "cajaVencido", "cajaFacturasMes"]) assert.match(facturas, new RegExp(`qc\\("${c}"\\)`), c);
});

test("C-21: «Facturas del mes» cuenta solo las emitidas, como «Ventas» de Finanzas", () => {
  const page = leer("src/app/dashboard/caja/page.tsx");
  assert.match(page, /prisma\.invoice\.count\(\{ where: \{ \.\.\.issued, createdAt: \{ gte: monthStart \} \} \}\)/);
  assert.doesNotMatch(page, /count\(\{ where: \{ clinicId: user\.clinicId, createdAt: \{ gte: monthStart \} \} \}\)/);
  assert.match(page, /const issued: Prisma\.InvoiceWhereInput = \{ clinicId: user\.clinicId, status: \{ notIn: \["DRAFT", "CANCELLED"\] \} \}/);
});

test("C-24: el Hoy de recepción usa el mismo «Vencido» que el dueño", () => {
  const r = leer("src/app/api/dashboard/home/receptionist/route.ts");
  assert.match(r, /computeReceivables\(clinicId, new Date\(\)\)/);
  assert.doesNotMatch(r, /Number\(r\.total\) - Number\(r\.paid/);
  // Desde N-10 el texto sale de avisoDeFacturasVencidas (el mismo del dueño).
  assert.match(r, /title: avisoDeFacturasVencidas\(overdueInvoices\.count, overdueInvoices\.total\)\.titulo/);
  // El del dueño, para comparar: la misma función y el mismo conteo.
  const dueno = leer("src/app/api/dashboard/home/admin/route.ts");
  assert.match(dueno, /computeReceivables\(clinicId, new Date\(\)\)/);
  assert.match(dueno, /Object\.values\(saldos\.vencidoPorFactura\)\.filter\(\(v\) => v > 0\.005\)/);
  assert.match(r, /Object\.values\(saldos\.vencidoPorFactura\)\.filter\(\(v\) => v > 0\.005\)/);
});

test("textos es/en de las cifras de Caja", () => {
  for (const l of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${l}.json`));
    for (const k of ["cajaPagado", "cajaFacturasMes", "cajaVencido", "ortoMensualidades"]) assert.equal(typeof d.queCuenta[k], "string", `${l} ${k}`);
  }
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  assert.equal(es.billing.billingClient.kpiTotalCollected, "Pagado en facturas");
  assert.equal(es.billing.billingClient.kpiThisMonth, "Facturas del mes");
});

test("N-19: «16 vencidas» una sola vez, y la lista enseña 5 filas con «Ver las N»", () => {
  const r = resumenDeMensualidades(FILAS);
  assert.equal(desgloseDeCuotas(r, { sinVencidas: true }), "1 próxima", "las vencidas ya van en la insignia");
  assert.equal(desgloseDeCuotas({ vencidas: 3, hoy: 0, proximas: 0 }, { sinVencidas: true }), "", "sin nada más, no hay renglón");
  const lista = leer("src/components/specialties/orthodontics/cobranza/ListaMensualidades.tsx");
  assert.match(lista, /desgloseDeCuotas\(resumen, \{ sinVencidas: true \}\)/);
  assert.doesNotMatch(lista, /desgloseDeCuotas\(resumen\)\}/);
  assert.match(lista, /const VISIBLES = 5;/);
  assert.match(lista, /\(todos \? grupos : grupos\.slice\(0, VISIBLES\)\)\.map/);
  assert.match(lista, /`Ver las \$\{grupos\.length\}`/);
});
