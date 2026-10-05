/**
 * Revisión de Rafael con Claude en Chrome (panel.108, 5-oct-2026) — lo de dinero
 * y facturas: #1, #2, #4, #5, #6, #7 y #11 — ws1-t5.
 *
 * Run: npm run test:qa-rafael-5oct
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aliasDe, grupoDelArqueo, metodoCanonico } from "@/lib/dinero/metodo-pago";
import { netoDelDia } from "@/lib/dinero/caja-dia";
import { fusionarFacturas, ordenarFacturas } from "@/lib/invoices/orden-facturas";
import { deriveWindow, type CajaDb } from "@/lib/caja";
import { crearBase } from "@/lib/sabina/tools/__tests__/doble-base";
import { CL_NORTE } from "@/lib/sabina/tools/__tests__/siembra";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

// ── #2 ──────────────────────────────────────────────────────────────────────
test("#2 · los alias de la base («credit_card» 7, «debit_card» 5, «CARD» 3, «CASH» 1) van a su método", () => {
  assert.equal(metodoCanonico("credit_card"), "credit");
  assert.equal(metodoCanonico("debit_card"), "debit");
  assert.equal(metodoCanonico("CASH"), "cash");
  assert.equal(metodoCanonico("CARD"), "card");
  assert.equal(metodoCanonico(" Transferencia "), "transfer");
  assert.equal(grupoDelArqueo("credit_card"), "credit");
  assert.equal(grupoDelArqueo("CARD"), "other", "tarjeta sin tipo: no se adivina débito o crédito");
  assert.ok(aliasDe("cash").includes("CASH") && aliasDe("cash").includes("cash"));
});

test("#2 · Caja: un cobro «credit_card» de $1,224 suma en Crédito (antes en «Otros») y la fila dice «credit»; «CASH» suma en efectivo", async () => {
  const dia = (h: number) => new Date(Date.UTC(2026, 8, 27, h));
  const db = crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL", cfdiTaxMode: "exempt" }],
    patients: [{ id: "p1", clinicId: CL_NORTE, firstName: "A", lastName: "B", status: "ACTIVE", visibleUserIds: [] }],
    invoices: [
      { id: "f1", clinicId: CL_NORTE, patientId: "p1", status: "PAID", items: [], subtotal: 1224, discount: 0, total: 1224, paid: 1224, balance: 0, notes: null, doctorId: null, appointmentId: null, taxRate: 0, taxIncluded: true, createdAt: dia(15) },
      { id: "f2", clinicId: CL_NORTE, patientId: "p1", status: "PAID", items: [], subtotal: 100, discount: 0, total: 100, paid: 100, balance: 0, notes: null, doctorId: null, appointmentId: null, taxRate: 0, taxIncluded: true, createdAt: dia(15) },
    ],
    payments: [
      { id: "c1", invoiceId: "f1", amount: 1224, method: "credit_card", paidAt: dia(16), refundMethod: null },
      { id: "c2", invoiceId: "f2", amount: 100, method: "CASH", paidAt: dia(17), refundMethod: null },
    ],
  }) as unknown as CajaDb;
  const w = await deriveWindow(CL_NORTE, dia(6), dia(23), { db });
  assert.equal(w.cardCreditIncome, 1224);
  assert.equal(w.cashIncome, 100);
  assert.deepEqual(w.list.map((r: any) => r.method).sort(), ["cash", "credit"]);
  assert.match(leer("src/lib/caja.ts"), /method: \{ in: aliasDe\("cash"\) \}/, "el efectivo del cajón también con «CASH»");
});

// ── #6 ──────────────────────────────────────────────────────────────────────
test("#6 · el encabezado del día resta los reembolsos reales: $3,300 cobrados − $500 devueltos = $2,800; el traspaso a saldo a favor y el saldo aplicado no cuentan", () => {
  assert.equal(netoDelDia([
    { method: "cash", amount: 3000 },
    { method: "debit", amount: 300 },
    { method: "refund", amount: 500, refundMethod: "cash" },
    { method: "refund", amount: 200, refundMethod: "saldo_a_favor" },
    { method: "anticipo", amount: 150 },
  ]), 2800);
  assert.match(leer("src/app/dashboard/caja/caja-client.tsx"), /total: netoDelDia\(/);
});

// ── #11 ─────────────────────────────────────────────────────────────────────
test("#11 · orden estable en la ficha: la más reciente primero y, a igual fecha, el folio más alto", () => {
  const f = (id: string, n: string, c: string) => ({ id, invoiceNumber: n, createdAt: c });
  const r = ordenarFacturas([f("a", "MF-0179", "2026-10-04T10:00:00Z"), f("b", "MF-0181", "2026-10-04T10:00:00Z"), f("c", "MF-0180", "2026-10-04T11:00:00Z"), f("d", "MF-0099", "2026-09-01T10:00:00Z")]);
  assert.deepEqual(r.map((x) => x.invoiceNumber), ["MF-0180", "MF-0181", "MF-0179", "MF-0099"]);
  assert.match(leer("src/components/dashboard/expediente-rediseno/facturacion.tsx"), /facturas=\{ordenarFacturas\(facturas\)\}/);
  assert.match(leer("src/components/dashboard/patient-detail/billing-tab.tsx"), /ordenarFacturas\(invoices\)\.map/);
});

// ── #1 ──────────────────────────────────────────────────────────────────────
test("#1 · un refresco viejo ya no pisa la factura recién cobrada (gana la copia más nueva por updatedAt)", () => {
  const vieja = { id: "mf179", paid: 0, balance: 700, updatedAt: "2026-10-04T18:00:00Z" };
  const cobrada = { id: "mf179", paid: 700, balance: 0, updatedAt: "2026-10-04T18:05:00Z" };
  const otra = { id: "mf180", paid: 0, balance: 300, updatedAt: "2026-10-04T17:00:00Z" };
  assert.deepEqual(fusionarFacturas([vieja, otra], [cobrada, otra]).map((f) => [f.id, f.paid, f.balance]), [["mf179", 700, 0], ["mf180", 0, 300]]);
  // Y si el servidor trae la más nueva, gana el servidor.
  assert.equal(fusionarFacturas([cobrada], [vieja])[0].paid, 700);
  assert.match(leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx"), /setInvoices\(\(prev: any\[\]\) => fusionarFacturas\(initialInvoices as any\[\], prev \?\? \[\]\)\)/);
  const modal = leer("src/components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(modal, /fetch\(`\/api\/invoices\/\$\{id\}`, \{ cache: "no-store" \}\)/);
  assert.match(modal, /alAbonarA: \(id\) => subirFacturaFresca\(id\)/, "la factura que recibió el abono también");
  assert.match(modal, /subirFacturaFresca\(invoice\.id\); subirFacturaFresca\(destinoId\);/, "desde el botón «Abonar a otra factura»");
});

// ── #4 ──────────────────────────────────────────────────────────────────────
test("#4 · los «Qué cuenta» dicen la verdad: sin la historia traída de otro sistema, pero el pago de HOY a un saldo migrado sí cuenta", () => {
  const es = leer("src/i18n/dictionaries/es.json");
  assert.doesNotMatch(es, /Sin pagos migrados\.|Sin los pagos migrados/);
  assert.match(es, /"inicioIngresos": "[^"]*lo que un paciente paga hoy de un saldo migrado sí cuenta/);
  assert.match(es, /"efectivo": "[^"]*el efectivo que un paciente paga hoy de un saldo migrado sí cuenta/);
  assert.match(leer("src/lib/dinero/textos.ts"), /cobradoHoyNota: "[^"]*lo que un paciente paga hoy de un saldo migrado sí cuenta/);
  // La regla no cambia: los pagos con método «migrated» siguen fuera del ingreso.
  assert.match(leer("src/lib/dinero/ingresos.server.ts"), /\{ method: \{ notIn: \[\.\.\.METODOS_DE_HISTORIA\] \} \}/);
});

// ── #5 ──────────────────────────────────────────────────────────────────────
test("#5 · «Se cobrará hoy» con abono: el resumen enseña el pago que se registra AHORA y el pie lo dice", () => {
  const ui = leer("src/components/dashboard/presupuesto-nuevo/aceptacion-y-cobro.tsx");
  assert.match(ui, /txP\.notaConAbono\(plan\.plan\.total > 0, plan\.plan\.abono\.nombre\)/);
  assert.match(ui, /<span>\{txP\.pagoAhora\}<\/span>/);
  assert.match(ui, /plan\.plan\.abono \? txP\.cargoHoy : t\("presupuestoAceptacion\.hoy"\)/);
});

// ── #7 ──────────────────────────────────────────────────────────────────────
test("#7 · «Nueva factura»: el descuento global 150 % o $9,999 se recorta al subtotal, avisa y se guarda recortado", () => {
  const ed = leer("src/components/billing/invoice-editor-modal.tsx");
  assert.match(ed, /const descuentoGlobal = useMemo\(/);
  assert.match(ed, /valor: discountMode === "pct" \? Math\.min\(100, /);
  assert.equal((ed.match(/discountPct: discountMode === "pct" \? descuentoGlobal\.valor : null/g) ?? []).length, 3, "en la vista y en los dos guardados");
  assert.match(ed, /data-descuento-recortado/);
  assert.match(ed, /onBlur=\{\(\) => \{ if \(descuentoGlobal\.recortado\) setDiscountValue\(descuentoGlobal\.valor\); \}\}/);
});
