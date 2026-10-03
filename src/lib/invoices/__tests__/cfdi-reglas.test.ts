/**
 * Reglas fiscales del timbrado (ws1-t4, tanda 0): puras, con números.
 *
 * Run: npm run test:cfdi-reglas
 *
 * Los casos son los de la auditoría del 3-oct-2026 (§4 Tanda 0):
 * retencion-candado, forma-pago-mayor, pue-saldo y uso-por-regimen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  tipoDePersona, bloqueoPorRetencion, bloqueoPorSaldo, avisoDeSaldo, usoCfdiPorRegimen,
  formaDePagoSat, formaDeOrigenes, formaDeMetodo, normalizarRfc,
} from "../cfdi-reglas";
import { derivePaymentForm } from "@/lib/invoice-totals";
import { USOS_CFDI } from "@/lib/cfdi-catalogs";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

// ── retencion-candado ───────────────────────────────────────────────────────
test("retencion-candado · 626 o 612 + RFC de 12 bloquea; RFC de 13, XAXX y emisor 601 pasan", () => {
  assert.equal(bloqueoPorRetencion({ regimenEmisor: "626", rfcReceptor: "ABC010101AB1" })?.code, "CFDI_RETENCION_PENDIENTE");
  assert.equal(bloqueoPorRetencion({ regimenEmisor: "612", rfcReceptor: "ABC010101AB1" })?.code, "CFDI_RETENCION_PENDIENTE");
  assert.equal(bloqueoPorRetencion({ regimenEmisor: "626", rfcReceptor: "GOMA800101AB1" }), null);
  assert.equal(bloqueoPorRetencion({ regimenEmisor: "626", rfcReceptor: "XAXX010101000" }), null);
  assert.equal(bloqueoPorRetencion({ regimenEmisor: "626", rfcReceptor: "XEXX010101000" }), null);
  assert.equal(bloqueoPorRetencion({ regimenEmisor: "601", rfcReceptor: "ABC010101AB1" }), null);
  assert.equal(bloqueoPorRetencion({ regimenEmisor: null, rfcReceptor: "ABC010101AB1" }), null);
});

test("retencion-candado · el RFC se lee como lo lee el SAT (minúsculas y espacios no lo esquivan; & cuenta)", () => {
  assert.equal(normalizarRfc(" abc 010101 ab1 "), "ABC010101AB1");
  assert.equal(tipoDePersona(" abc010101ab1 "), "moral");
  assert.equal(tipoDePersona("A&C010101AB1"), "moral");
  assert.equal(tipoDePersona("GOMA800101AB1"), "fisica");
  assert.equal(tipoDePersona("xaxx010101000"), "generico");
  assert.equal(tipoDePersona(""), "desconocido");
  assert.equal(bloqueoPorRetencion({ regimenEmisor: " 626 ", rfcReceptor: "a&c010101ab1" })?.code, "CFDI_RETENCION_PENDIENTE");
});

test("retencion-candado · el mensaje dice qué hacer, en español y en inglés", () => {
  assert.equal(
    bloqueoPorRetencion({ regimenEmisor: "626", rfcReceptor: "ABC010101AB1" })?.error,
    "Todavía no se pueden emitir desde DaleControl facturas a empresas (RFC de 12 caracteres) con retención de ISR; emítela por fuera mientras lo habilitamos.",
  );
  assert.match(bloqueoPorRetencion({ regimenEmisor: "626", rfcReceptor: "ABC010101AB1", locale: "en" })!.error, /Issue this one outside the system/);
});

// ── pue-saldo ───────────────────────────────────────────────────────────────
test("pue-saldo · $8,000 con $2,000 pagados → bloquea con el saldo de $6,000.00; pagada → no", () => {
  const b = bloqueoPorSaldo({ total: 8000, paid: 2000, esAPlazos: false });
  assert.equal(b?.code, "CFDI_CON_SALDO");
  assert.match(b!.error, /\$6,000\.00/);
  assert.equal(bloqueoPorSaldo({ total: 8000, paid: 8000, esAPlazos: false }), null);
  // Un centavo de redondeo no es saldo (la misma holgura de siempre).
  assert.equal(bloqueoPorSaldo({ total: 1600, paid: 1599.99, esAPlazos: false }), null);
  assert.equal(bloqueoPorSaldo({ total: 1600, paid: 1599.98, esAPlazos: false })?.code, "CFDI_CON_SALDO");
  // 0.1 + 0.2 no se cuela por coma flotante.
  assert.equal(bloqueoPorSaldo({ total: 0.3, paid: 0.1 + 0.2, esAPlazos: false }), null);
});

test("pue-saldo · a plazos (ortodoncia en 12) el aviso SEÑALA «Facturar este pago»", () => {
  const b = bloqueoPorSaldo({ total: 26000, paid: 4000, esAPlazos: true });
  assert.equal(b?.code, "CFDI_CON_SALDO_A_PLAZOS");
  assert.equal(b?.error, "Esta factura tiene saldo ($22,000.00): factura cada pago cobrado con «Facturar este pago», junto a cada pago en «Movimientos».");
  assert.match(avisoDeSaldo(true), /^Esta factura tiene saldo: factura cada pago cobrado con «Facturar este pago»/);
  assert.match(avisoDeSaldo(null), /Si es a plazos, abre la factura y usa «Facturar este pago»/);
  assert.match(avisoDeSaldo(true, "en"), /"Invoice this payment"/);
});

test("pue-saldo · los formularios ya no ofrecen «timbrar de todos modos» ni mandan confirmUnpaidPue", () => {
  for (const f of [
    "src/components/dashboard/billing/invoice-detail-modal.tsx",
    "src/app/dashboard/billing/billing-client.tsx",
  ]) {
    const src = leer(f);
    assert.ok(!src.includes("confirmUnpaidPue"), `${f} sigue mandando confirmUnpaidPue`);
    assert.ok(!src.includes("cfdiUnpaidConfirm"), `${f} sigue ofreciendo «Timbrar de todos modos»`);
    assert.ok(src.includes("avisoDeSaldo("), `${f} no usa el aviso compartido`);
  }
  // El caso de ortodoncia a plazos tiene su botón a los pagos.
  const orto = leer("src/components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.match(orto, /Facturar pagos \(CFDI\)/);
  assert.match(orto, /kind: "facturar-pagos"/);
  assert.match(orto, /abrirCobro=\{false\}/);
});

// ── forma-pago-mayor ────────────────────────────────────────────────────────
test("forma-pago-mayor · $4,000 crédito + $1,000 efectivo (el último) → «04»", () => {
  assert.equal(formaDePagoSat([{ method: "credit", amount: 4000 }, { method: "cash", amount: 1000 }]), "04");
  // Y con el orden al revés, lo mismo: manda el importe, no el orden.
  assert.equal(formaDePagoSat([{ method: "cash", amount: 1000 }, { method: "credit", amount: 4000 }]), "04");
});

test("forma-pago-mayor · se suma por forma: $600 + $600 en efectivo le ganan a $1,000 con débito", () => {
  assert.equal(formaDePagoSat([{ method: "cash", amount: 600 }, { method: "debit", amount: 1000 }, { method: "cash", amount: 600 }]), "01");
});

test("forma-pago-mayor · empate $2,500 / $2,500 → siempre la misma (la clave menor, «01»)", () => {
  assert.equal(formaDePagoSat([{ method: "debit", amount: 2500 }, { method: "cash", amount: 2500 }]), "01");
  assert.equal(formaDePagoSat([{ method: "cash", amount: 2500 }, { method: "debit", amount: 2500 }]), "01");
});

test("forma-pago-mayor · los reembolsos no cuentan", () => {
  assert.equal(formaDePagoSat([{ method: "refund", amount: 5000 }, { method: "transfer", amount: 100 }]), "03");
});

test("forma-pago-mayor · Mercado Pago, «tarjeta» sin tipo, portal y «otro» → null (hay que escoger)", () => {
  for (const m of ["mercadopago", "card", "online", "stripe", "other"]) {
    assert.equal(formaDePagoSat([{ method: m, amount: 1600 }]), null, m);
    assert.equal(formaDeMetodo(m), null, m);
  }
  assert.equal(formaDeMetodo("oxxo"), "01");
  assert.equal(formaDeMetodo("spei"), "03");
});

test("forma-pago-mayor · con una parte desconocida solo se propone si gana pase lo que pase", () => {
  // $4,000 crédito + $900 por Mercado Pago: aunque los $900 fueran de otra forma, gana «04».
  assert.equal(formaDePagoSat([{ method: "credit", amount: 4000 }, { method: "mercadopago", amount: 900 }]), "04");
  // $1,000 crédito + $600 efectivo + $900 Mercado Pago: si los $900 fueron efectivo, gana «01» ($1,500).
  assert.equal(formaDePagoSat([{ method: "credit", amount: 1000 }, { method: "cash", amount: 600 }, { method: "mercadopago", amount: 900 }]), null);
  // $500 débito + $1,100 por Mercado Pago: lo desconocido es más grande que lo conocido.
  assert.equal(formaDePagoSat([{ method: "debit", amount: 500 }, { method: "mercadopago", amount: 1100 }]), null);
});

test("forma-pago-mayor · un «anticipo» hereda la forma del dinero original; sin saberla, null", () => {
  assert.equal(formaDePagoSat([{ method: "anticipo", amount: 500 }], "01"), "01");
  assert.equal(formaDePagoSat([{ method: "anticipo", amount: 500 }], null), null);
  assert.equal(formaDeOrigenes(["01", "01"]), "01");
  assert.equal(formaDeOrigenes(["01", "03"]), null, "mezcla de formas: no se sabe cuál se gastó");
  assert.equal(formaDeOrigenes(["01", null]), null, "un origen desconocido");
  assert.equal(formaDeOrigenes([]), null);
});

test("forma-pago-mayor · derivePaymentForm ya no inventa «03»", () => {
  assert.equal(derivePaymentForm([{ method: "mercadopago", amount: 1600, paidAt: "2026-10-03" }], null), null);
  assert.equal(derivePaymentForm([], null), null);
  assert.equal(derivePaymentForm([], "cash"), "01");
  assert.equal(derivePaymentForm([
    { method: "credit", amount: 4000, paidAt: "2026-10-01" },
    { method: "cash", amount: 1000, paidAt: "2026-10-02" },
  ]), "04");
});

test("forma-pago-mayor · «Facturar este pago» ya no tiene su propia tabla (que mandaba Mercado Pago a «03»)", () => {
  const src = leer("src/components/dashboard/billing/payment-cfdi-button.tsx");
  assert.ok(!src.includes('mercadopago: "03"'));
  assert.match(src, /derivePaymentForm\(\[\{ method: props\.method, amount: props\.amount \}\]\)/);
});

// ── uso-por-regimen ─────────────────────────────────────────────────────────
test("uso-por-regimen · 612 → D01; 626 → G03; persona moral → G03; 616 → S01", () => {
  assert.equal(usoCfdiPorRegimen("612", "GOMA800101AB1"), "D01");
  assert.equal(usoCfdiPorRegimen("626", "GOMA800101AB1"), "G03");
  assert.equal(usoCfdiPorRegimen("601", "ABC010101AB1"), "G03");
  assert.equal(usoCfdiPorRegimen("616", "XAXX010101000"), "S01");
  // Otras personas físicas con deducciones personales.
  for (const r of ["605", "606", "607", "608", "611", "614", "615", "625"]) assert.equal(usoCfdiPorRegimen(r), "D01", r);
  // RFC de empresa con un régimen de persona física mal capturado → G03 (D01 lo rechazaría el SAT).
  assert.equal(usoCfdiPorRegimen("612", "ABC010101AB1"), "G03");
  // Régimen desconocido o vacío → G03 (no D01).
  assert.equal(usoCfdiPorRegimen("", undefined), "G03");
});

test("uso-por-regimen · CP01 ya no está en el catálogo de ingreso", () => {
  assert.ok(!USOS_CFDI.some((u) => u.clave === "CP01"));
  for (const c of ["G03", "D01", "S01"]) assert.ok(USOS_CFDI.some((u) => u.clave === c), c);
});

test("uso-por-regimen · los tres formularios proponen el uso según el régimen (no D01 fijo)", () => {
  for (const f of [
    "src/components/dashboard/billing/invoice-detail-modal.tsx",
    "src/app/dashboard/billing/billing-client.tsx",
    "src/components/dashboard/billing/payment-cfdi-button.tsx",
  ]) {
    const src = leer(f);
    assert.match(src, /usoCfdiPorRegimen\(/, f);
    assert.ok(!/uso(Cfdi)?:\s*"D01",/.test(src), `${f} sigue con D01 fijo`);
  }
});
