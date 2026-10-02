/**
 * TARJETA DEL PRESUPUESTO Y VIGENCIA — arreglos de la revisión de ws1-t6.
 *
 * Run: npm run test:presupuesto-aceptacion
 *
 *  2. La vigencia era «vence 1 nov» en el panel (UTC) y «Válido hasta 31/10»
 *     en la liga (hora del navegador): ahora las dos pintan el día que calcula
 *     el servidor con la zona de la clínica.
 *  3. Aceptado en parte: el importe grande es lo aceptado, no el total cotizado.
 *  6. El duplicado de un presupuesto ya cargado avisa (sin bloquear) qué
 *     concepto ya se cargó desde el otro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diaDeVigencia, fechaDeDia, fechaDeVigencia } from "@/lib/quotes/vigencia";
import { toPublicView } from "@/lib/quotes/serialize";
import { cargadosEnOtrosPresupuestos, claveDeConcepto, importesDeTarjeta } from "@/lib/quotes/aceptacion";

// ── 2 · vigencia ────────────────────────────────────────────────────────────

test("vigencia elegida en el editor (medianoche UTC) = ese día, en cualquier zona", () => {
  assert.equal(diaDeVigencia("2026-11-01T00:00:00.000Z", "America/Mexico_City"), "2026-11-01");
  assert.equal(diaDeVigencia("2026-11-01T00:00:00.000Z", "America/Tijuana"), "2026-11-01");
  assert.equal(diaDeVigencia("2026-11-01T00:00:00.000Z", "Europe/Madrid"), "2026-11-01");
  assert.equal(fechaDeDia("2026-11-01"), "1 nov 2026");
});

test("vigencia puesta al presentar (+30 días, hora cualquiera) = el día del reloj de la clínica", () => {
  // 03:00 UTC del 1 nov = 21:00 del 31 oct en Ciudad de México.
  assert.equal(diaDeVigencia("2026-11-01T03:00:00.000Z", "America/Mexico_City"), "2026-10-31");
  assert.equal(diaDeVigencia("2026-11-01T03:00:00.000Z", "Europe/Madrid"), "2026-11-01");
  // Zona basura guardada en la clínica: la de por defecto, nunca una excepción.
  assert.equal(diaDeVigencia("2026-11-01T03:00:00.000Z", "No/Existe"), "2026-10-31");
  assert.equal(diaDeVigencia(null, "America/Mexico_City"), null);
  assert.equal(diaDeVigencia("no es fecha", "America/Mexico_City"), null);
  assert.equal(fechaDeDia(null), "—");
});

test("la liga y la tarjeta del panel pintan el MISMO día (el caso de la revisión: 1 nov)", () => {
  const quote = {
    folio: "P-0012", title: "QA", status: "PRESENTED", validUntil: new Date("2026-11-01T00:00:00.000Z"),
    subtotal: 10000, discountAmount: 0, total: 10000, notes: null, acceptedAt: null, items: [],
  };
  const liga = toPublicView(quote, {
    clinicName: "Clínica de prueba", clinicLogoUrl: null, patientFirstName: "Ana",
    signatureUrl: null, expired: false, timezone: "America/Mexico_City",
  });
  assert.equal(liga.validUntilDia, "2026-11-01");
  // Panel: GET /api/quotes manda el mismo día; la tarjeta lo pinta tal cual.
  const panel = { validUntil: "2026-11-01T00:00:00.000Z", validUntilDia: diaDeVigencia(quote.validUntil, "America/Mexico_City") };
  assert.equal(fechaDeVigencia(liga), "1 nov 2026");
  assert.equal(fechaDeVigencia(panel), fechaDeVigencia(liga));
  // Con un instante de «Presentar» los dos siguen de acuerdo (31 oct en CDMX).
  const presentado = { ...quote, validUntil: new Date("2026-11-01T03:00:00.000Z") };
  const liga2 = toPublicView(presentado, {
    clinicName: "x", clinicLogoUrl: null, patientFirstName: "Ana", signatureUrl: null, expired: false,
    timezone: "America/Mexico_City",
  });
  assert.equal(fechaDeVigencia(liga2), "31 oct 2026");
  assert.equal(fechaDeVigencia({ validUntil: liga2.validUntil, validUntilDia: diaDeVigencia(presentado.validUntil, "America/Mexico_City") }), "31 oct 2026");
});

// ── 3 · importe grande de la tarjeta ────────────────────────────────────────

test("aceptado en parte: grande lo aceptado ($1,500) y aparte el total cotizado ($10,000)", () => {
  assert.deepEqual(importesDeTarjeta(10000, { alcance: "parcial", totalAceptado: 1500 }), { principal: 1500, cotizado: 10000 });
});

test("aceptado completo, o sin aceptación por concepto: el total, como siempre", () => {
  assert.deepEqual(importesDeTarjeta(10000, { alcance: "total", totalAceptado: 10000 }), { principal: 10000, cotizado: null });
  assert.deepEqual(importesDeTarjeta(10000, undefined), { principal: 10000, cotizado: null });
  assert.deepEqual(importesDeTarjeta(10000, null), { principal: 10000, cotizado: null });
});

// ── 6 · aviso al cargar el duplicado ────────────────────────────────────────

const ORIGINAL = {
  id: "q12", folio: "P-0012",
  items: [
    { id: "r12", name: "Resina", toothFdi: "16", },
    { id: "l12", name: "Limpieza dental", toothFdi: null },
  ],
  cobro: {
    cargados: ["r12"],
    cargos: [{ invoiceId: "f1", invoiceNumber: "MF-1098", status: "PENDING", monto: 1500, tipo: "concepto" as const, quoteItemId: "r12" }],
  },
};
const DUPLICADO = {
  id: "q13", folio: "P-0013",
  items: [
    { id: "r13", name: "Resina", toothFdi: "16" },
    { id: "l13", name: "Limpieza dental", toothFdi: null },
  ],
  cobro: { cargados: [], cargos: [] },
};

test("el duplicado avisa que la Resina ya se cargó desde P-0012 en MF-1098; la Limpieza no", () => {
  const m = cargadosEnOtrosPresupuestos("q13", [ORIGINAL, DUPLICADO]);
  assert.deepEqual(m.get(claveDeConcepto("Resina", "16")), [{ folio: "P-0012", factura: "MF-1098" }]);
  assert.equal(m.get(claveDeConcepto("Limpieza dental", null)), undefined);
});

test("el propio presupuesto no se avisa a sí mismo, y otra pieza es otro concepto", () => {
  const m = cargadosEnOtrosPresupuestos("q12", [ORIGINAL, DUPLICADO]);
  assert.equal(m.size, 0);
  const otraPieza = cargadosEnOtrosPresupuestos("q13", [ORIGINAL]);
  assert.equal(otraPieza.get(claveDeConcepto("Resina", "21")), undefined);
});

test("mismo concepto con otra escritura (mayúsculas, acentos, espacios) cuenta como el mismo", () => {
  assert.equal(claveDeConcepto("  RESINA ", "16"), claveDeConcepto("resina", "16"));
  assert.equal(claveDeConcepto("Limpieza  dentál", null), claveDeConcepto("limpieza dental", null));
});

test("factura vieja del presupuesto (sin quote_charges): avisa con el folio del presupuesto, sin nota", () => {
  const viejo = { ...ORIGINAL, cobro: { cargados: ["r12"], cargos: [] } };
  const m = cargadosEnOtrosPresupuestos("q13", [viejo, DUPLICADO]);
  assert.deepEqual(m.get(claveDeConcepto("Resina", "16")), [{ folio: "P-0012", factura: null }]);
});

test("sin aceptación por concepto (sin SQL) no hay aviso", () => {
  const sinCobro = { ...ORIGINAL, cobro: undefined };
  assert.equal(cargadosEnOtrosPresupuestos("q13", [sinCobro, DUPLICADO]).size, 0);
});
