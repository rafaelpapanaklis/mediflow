/**
 * Tercera auditoría de uso, grupo G1 (ronda final), 4-oct-2026 — ws1-t5.
 *
 * Run: npm run test:dinero-auditoria-uso-final (F6 en test:anulables-cancelada)
 *
 * Los números son los del reporte ws1-t6 de la tercera auditoría. Cada caso
 * falla con el código de antes (se dice cómo).
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { deriveWindow, movimientosDelCorte, type CajaDb } from "@/lib/caja";
import { bajasEnVentana, bajasSinFecha, lineaDeBaja, marcasDeBaja, selloUtc } from "@/lib/dinero/bajas";
import { reembolsosEnEfectivoDelCorte } from "@/lib/dinero/corte-del-historial";
import { conceptoDeLaCita } from "@/lib/invoices/cobrar-hoy";
import { notasLegibles } from "@/lib/invoices/notas-legibles";
import { crearBase } from "@/lib/sabina/tools/__tests__/doble-base";
import { CL_NORTE } from "@/lib/sabina/tools/__tests__/siembra";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

// ── F2 ──────────────────────────────────────────────────────────────────────
test("F2 · la marca de baja lleva fecha al segundo y se lee legible (antes: sin fecha)", () => {
  const l = lineaDeBaja(200, "reembolso por cobro de más", new Date("2026-10-04T12:25:30Z"));
  assert.equal(l, "[BAJA DEL TOTAL: $200.00 · reembolso por cobro de más · 2026-10-04 12:25:30 UTC]");
  assert.equal(selloUtc(new Date("2026-10-04T06:16:09Z")), "2026-10-04 06:16:09 UTC");
  assert.deepEqual(marcasDeBaja(l), [{ monto: 200, cuando: new Date("2026-10-04T12:25:30Z") }]);
  assert.doesNotMatch(notasLegibles(l, (d) => d.toISOString()), /UTC|\[/);
  // El cancelar con «dar de baja el resto» también la fecha.
  assert.match(leer("src/app/api/invoices/[id]/cancel/route.ts"), /\[RESTO DADO DE BAJA: \$\{montoParaTexto[^\n]*· \$\{selloUtc\(new Date\(\)\)\}\]/);
});

test("F2 · bajas en la ventana: R3 $200 + R4 $1,500 = $1,700 enteras; la vieja sin fecha no entra; ni la de otro turno", () => {
  const notas = [
    "[RESTO DADO DE BAJA: $1,500.00: deja el tratamiento · 2026-10-04 12:20:05 UTC]",
    lineaDeBaja(200, "reembolso por cobro de más", new Date("2026-10-04T12:25:30Z")),
    "[RESTO DADO DE BAJA: $2,000.00]",
    lineaDeBaja(50, "x", new Date("2026-10-04T11:59:59Z")),
  ].join("\n");
  assert.equal(bajasEnVentana(notas, new Date("2026-10-04T12:16:00Z"), new Date("2026-10-04T12:28:00Z")), 1_700);
  assert.equal(bajasSinFecha(notas), 2_000);
  // Al segundo: el turno que cerró justo antes no la cuenta otra vez.
  assert.equal(bajasEnVentana(notas, new Date("2026-10-04T12:00:00Z"), new Date("2026-10-04T12:20:04Z")), 0);
});

test("F2 · Caja: «Bajas…» del turno = $1,700 (la suma de las bajas), no el prorrateo con los cobros ($1,650 antes)", async () => {
  const turno = { desde: new Date("2026-10-04T12:16:00Z"), hasta: new Date("2026-10-04T12:28:00Z") };
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL", cfdiTaxMode: "exempt" }],
    patients: [{ id: "p1", clinicId: CL_NORTE, firstName: "A", lastName: "B", status: "ACTIVE", visibleUserIds: [] }],
    invoices: [
      // R4: $3,000 de tratamiento; cobró $1,500 antes del turno y en el turno dio de baja el resto ($1,500).
      { id: "r4", clinicId: CL_NORTE, patientId: "p1", status: "PAID", items: [], subtotal: 3_000, discount: 1_500, total: 1_500, paid: 1_500, balance: 0,
        notes: "[RESTO DADO DE BAJA: $1,500.00: deja · 2026-10-04 12:20:05 UTC]", doctorId: null, appointmentId: null, taxRate: 0, taxIncluded: true,
        createdAt: new Date("2026-10-01T15:00:00Z"), updatedAt: new Date("2026-10-04T12:20:05Z") },
      // R3: $1,000 cobrados de más $200 → reembolso en el turno que baja el total a $800.
      { id: "r3", clinicId: CL_NORTE, patientId: "p1", status: "PAID", items: [], subtotal: 1_000, discount: 200, total: 800, paid: 800, balance: 0,
        notes: lineaDeBaja(200, "reembolso por cobro de más", new Date("2026-10-04T12:25:30Z")), doctorId: null, appointmentId: null, taxRate: 0, taxIncluded: true,
        createdAt: new Date("2026-10-04T12:17:00Z"), updatedAt: new Date("2026-10-04T12:25:30Z") },
      // Otra clínica con una baja en la misma ventana: no entra.
      { id: "ajena", clinicId: "otra", patientId: "px", status: "PAID", items: [], subtotal: 900, discount: 900, total: 0, paid: 0, balance: 0,
        notes: lineaDeBaja(900, "x", new Date("2026-10-04T12:21:00Z")), createdAt: new Date("2026-10-01T15:00:00Z"), updatedAt: new Date("2026-10-04T12:21:00Z") },
    ],
    payments: [
      { id: "c3", invoiceId: "r3", amount: 1_000, method: "cash", paidAt: new Date("2026-10-04T12:18:00Z"), refundMethod: null },
      { id: "d3", invoiceId: "r3", amount: -200, method: "refund", paidAt: new Date("2026-10-04T12:25:30Z"), refundMethod: "cash" },
    ],
  }) as unknown as CajaDb;
  const w = await deriveWindow(CL_NORTE, turno.desde, turno.hasta, { db });
  assert.equal(w.writeOffs, 1_700);
  assert.equal(w.discounts, 0, "ninguna de las dos es descuento");
});

// ── F3 ──────────────────────────────────────────────────────────────────────
test("F3 · el corte del historial suma: 5,300 + 3,800 − 700 de reembolsos en efectivo = 8,400", () => {
  assert.equal(reembolsosEnEfectivoDelCorte({ openingBalance: 5_300, cashIncome: 3_800, withdrawals: 0, expectedCash: 8_400 }), 700);
  assert.equal(reembolsosEnEfectivoDelCorte({ openingBalance: 5_200, cashIncome: 100, withdrawals: 0, expectedCash: 5_300 }), 0);
  assert.equal(reembolsosEnEfectivoDelCorte({ openingBalance: null, cashIncome: 100, withdrawals: 0, expectedCash: 5_300 }), 0);
  const cli = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cli, /historialReembolsosEfectivo, `-\$\{fmtMXNdec\(reembolsosEnEfectivoDelCorte\(h\)\)\}`/);
  assert.match(cli, /fetch\(`\/api\/caja\/history\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(cli, /\.\.\.lineasDelCorte\(h\), \.\.\.\(m \? lineasSinCajon\(m\) : \[\]\)/, "también en lo impreso");
});

test("F3 · lo que la foto no guarda (reembolsos, saldo a favor, bajas) sale del turno del corte, y solo de la clínica", async () => {
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL", cfdiTaxMode: "exempt" }],
    patients: [{ id: "p1", clinicId: CL_NORTE, firstName: "A", lastName: "B", status: "ACTIVE", visibleUserIds: [] }],
    cashRegisters: [
      { id: "k1", clinicId: CL_NORTE, status: "CLOSED", operatorId: "u1", openingBalance: 5_300, openedAt: new Date("2026-10-04T12:16:00Z"), closedAt: new Date("2026-10-04T12:28:00Z") },
      { id: "k2", clinicId: "otra", status: "CLOSED", operatorId: "u9", openingBalance: 0, openedAt: new Date("2026-10-04T12:16:00Z"), closedAt: new Date("2026-10-04T12:28:00Z") },
    ],
    invoices: [
      { id: "f1", clinicId: CL_NORTE, patientId: "p1", status: "PAID", items: [], subtotal: 1_000, discount: 0, total: 1_000, paid: 1_000, balance: 0, notes: null, taxRate: 0, taxIncluded: true, createdAt: new Date("2026-10-04T12:17:00Z"), updatedAt: new Date("2026-10-04T12:17:00Z") },
    ],
    payments: [
      { id: "a", invoiceId: "f1", amount: 1_000, method: "cash", paidAt: new Date("2026-10-04T12:18:00Z"), refundMethod: null },
      { id: "b", invoiceId: "f1", amount: -700, method: "refund", paidAt: new Date("2026-10-04T12:20:00Z"), refundMethod: "cash" },
    ],
  }) as unknown as CajaDb;
  // `cobrosAsignados` lee su tabla con SQL crudo: sin ella (el doble lanza) no hay asignados.
  const m = await movimientosDelCorte(CL_NORTE, "k1", db).catch((e) => ({ error: String(e) }));
  assert.ok(m && !("error" in m), `movimientosDelCorte: ${JSON.stringify(m)}`);
  assert.equal((m as any).refunds, 700);
  assert.equal(await movimientosDelCorte(CL_NORTE, "k2", db), null, "un corte de otra clínica no se lee");
  const ruta = leer("src/app/api/caja/history/[id]/route.ts");
  assert.match(ruta, /denyIfMissingPermission\(ctx, "billing\.view"\)/);
  assert.match(ruta, /canUseCaja\(ctx\.user\)/);
  assert.match(ruta, /movimientosDelCorte\(ctx\.clinicId, params\.id\)/);
});

// ── F4 ──────────────────────────────────────────────────────────────────────
test("F4 · sin cargos vigentes, «Estado de cuenta» ya no dice «$0 pagado de $0 facturado · 0 %»: dice que lo pagado pasó a saldo a favor", () => {
  const r = leer("src/components/dashboard/pacientes-rediseno/resumen.tsx");
  assert.match(r, /const sinCargosVigentes = finanzas\.total <= 0;/);
  assert.match(r, /\{sinCargosVigentes \? \(/);
  assert.match(r, /txReembolso\.sinCargosConSaldo\(formatCurrency\(pasadoASaldo\)\)/);
});

// ── F5 ──────────────────────────────────────────────────────────────────────
test("F5 · el motivo «Limpieza» trae el precio de «Limpieza dental» si es el único; con dos candidatos no adivina", () => {
  const uno = [{ id: "l1", name: "Limpieza dental", basePrice: 700 }, { id: "r1", name: "Resina", basePrice: 1_500 }];
  assert.deepEqual(conceptoDeLaCita("Limpieza", uno), { nombre: "Limpieza dental", importe: 700, procedureId: "l1" });
  assert.deepEqual(conceptoDeLaCita("Consulta general de primera vez", [{ id: "c1", name: "Consulta general", basePrice: 400 }]),
    { nombre: "Consulta general", importe: 400, procedureId: "c1" });
  const dos = [...uno, { id: "l2", name: "Limpieza profunda", basePrice: 1_200 }];
  assert.ok(Number.isNaN(conceptoDeLaCita("Limpieza", dos)!.importe));
  // «Limp» no es una palabra completa del nombre.
  assert.ok(Number.isNaN(conceptoDeLaCita("Limp", uno)!.importe));
  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /!dto\.anticipoPedido && !dto\.depositoPagado &&\s*permissions\.canDeposit && \(/);
});

// ── F1, F7 y B1 (cableado) ──────────────────────────────────────────────────
test("F1 · en transferencia la referencia se rotula obligatoria (antes «Referencia (opcional)» y luego el aviso)", () => {
  const h = leer("src/components/dashboard/cobrar-hoy/cobrar-hoy.tsx");
  assert.match(h, /metodo === "transfer" \? textosDinero\(locale\)\.cobro\.referenciaObligatoria : t\("cobrarHoy\.referencia"\)/);
});

test("F7 · «Facturado hoy» y «Por cobrar de hoy» dicen qué cuentan, en las dos Cajas", () => {
  assert.match(leer("src/components/dashboard/caja-rediseno/caja-nueva.tsx"), /nota=\{txDinero\.caja\.porCobrarHoyNota\}/);
  assert.match(leer("src/app/dashboard/caja/caja-client.tsx"), /hint=\{txDinero\.caja\.porCobrarHoyNota\}/);
});

test("B1 · en el celular el pie del detalle va en una fila que se desliza", () => {
  const css = leer("src/components/dashboard/factura-rediseno/factura-rediseno.module.css");
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.raiz \.pie:not\(\.pieApilado\) \{\s*flex-wrap: nowrap;[\s\S]*?overflow-x: auto;/);
});

// ── Comprobación final antes del push ───────────────────────────────────────
import { fechaHoraPanel } from "@/lib/formato-fecha-panel";
test("F4 (resto) · la tarjeta «Estado de cuenta» de la pestaña Facturación no pinta «Pagado $0 · 0 %» sin cargos vigentes", () => {
  const sc = leer("src/components/dashboard/patient-detail/side-cards.tsx");
  assert.match(sc, /const sinCargosVigentes = finance\.total <= 0 && finance\.balance <= 0;/);
  assert.match(sc, /\{sinCargosVigentes \? \(\s*<div className=\{styles\.financeBarLabel\} data-sin-cargos>/);
  assert.match(sc, /\{!sinCargosVigentes && \(\s*<>\s*<div className=\{styles\.financeBar\}>/, "sin barra ni «0 %»");
});

test("F-06 · las fechas de Caja usan el formato del panel: «3 oct 2026, 11:45 p.m.» (antes «03-oct, 11:45 p.m.»)", () => {
  assert.equal(fechaHoraPanel("2026-10-04T05:45:00Z", "America/Mexico_City"), "3 oct 2026, 11:45 p.m.");
  assert.match(leer("src/app/dashboard/caja/caja-client.tsx"), /const fmtDateTime = \(iso: string\) => fechaHoraPanel\(iso, tz, locale\);/);
  assert.match(leer("src/components/dashboard/billing/caja-fuera-de-corte.tsx"), /const fecha = \(iso: string\) => fechaHoraPanel\(iso, timezone\);/);
});
