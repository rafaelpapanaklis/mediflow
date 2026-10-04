/**
 * «Cobrado sin CFDI» del mes para la factura global del contador (ws1-t8, auditoría CFDI F-09).
 * Run: npm run test:cfdi-cobrado-sin-cfdi
 *
 * Antes no existía: no había forma de sacar «lo pagado sin CFDI» y el contador podía meter en la
 * global una nota que ya estaba timbrada (ingreso duplicado ante el SAT).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarReporte, clasificarPago, csvDelReporte, esMesValido, llevaIva,
  type PagoDelMes, type CfdiConocidos,
} from "@/lib/cfdi/cobrado-sin-cfdi";
import { rangoDelMes } from "@/lib/cfdi/cobrado-sin-cfdi.server";
import { netoDelPeriodo } from "@/lib/dinero/ingresos";

const SIN: CfdiConocidos = { porFactura: new Map(), porPago: new Map() };
const fechaUtc = (d: Date) => d.toISOString().slice(0, 10);

let n = 0;
function pago(p: Partial<PagoDelMes> & { amount: number }, inv: Partial<PagoDelMes["invoice"]> = {}): PagoDelMes {
  n += 1;
  return {
    id: `pay_${n}`,
    paidAt: new Date(`2026-10-${String(n).padStart(2, "0")}T17:00:00Z`),
    method: "cash",
    ...p,
    invoice: {
      id: `inv_${n}`, invoiceNumber: `MF-${1000 + n}`, status: "PAID", balance: 0, cfdiUuid: null,
      taxRate: 16, taxIncluded: true, ...inv,
    },
  };
}

test("el caso de la auditoría: octubre con 5 pagadas, 2 timbradas y 1 cancelada → el reporte lista 2", () => {
  n = 0;
  const pagos = [
    pago({ amount: 400 }, { cfdiUuid: "UUID-A" }),                 // timbrada (registro vigente)
    pago({ amount: 1600 }, { cfdiUuid: "UUID-B" }),                // timbrada (registro vigente)
    pago({ amount: 900 }, { status: "CANCELLED" }),                // nota cancelada
    pago({ amount: 500, method: "debit" }),
    pago({ amount: 1200, method: "transfer" }),
  ];
  const cfdi: CfdiConocidos = { porFactura: new Map([["inv_1", ["valid"]], ["inv_2", ["valid"]]]), porPago: new Map() };
  const r = armarReporte({ mes: "2026-10", pagos, cfdi, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.filas.length, 2);
  assert.deepEqual(r.filas.map((f) => f.folio), ["MF-1004", "MF-1005"]);
  assert.equal(r.total, 1700);
  assert.deepEqual(r.excluidos, { timbradas: 2, timbradoPorPago: 0, noEsVenta: 1 });
  // Exento: base = importe, IVA 0.
  assert.equal(r.base, 1700);
  assert.equal(r.iva, 0);
  assert.deepEqual(r.porForma, [{ formaSat: "03", importe: 1200 }, { formaSat: "28", importe: 500 }]);
});

test("un CFDI cancelado ya no ampara la nota: el cobro vuelve al reporte", () => {
  n = 0;
  const p = pago({ amount: 1600 }, { cfdiUuid: "UUID-VIEJO" });
  assert.equal(clasificarPago(p, { porFactura: new Map([["inv_1", ["cancelled"]]]), porPago: new Map() }), "incluido");
  // Cancelado y sustituido por otro vigente: sigue timbrada.
  assert.equal(clasificarPago(p, { porFactura: new Map([["inv_1", ["cancelled", "valid"]]]), porPago: new Map() }), "timbrada");
  // UUID en la nota sin ningún registro (timbrada antes de existir cfdi_records): timbrada.
  assert.equal(clasificarPago(p, SIN), "timbrada");
});

test("factura a plazos: el pago con su propio CFDI no entra; el otro pago de la misma nota sí", () => {
  n = 0;
  const enganche = pago({ amount: 2000 }, { id: "inv_x", balance: 6000, status: "PARTIAL" });
  const mensualidad = pago({ amount: 1000 }, { id: "inv_x", balance: 6000, status: "PARTIAL" });
  const cfdi: CfdiConocidos = { porFactura: new Map(), porPago: new Map([[enganche.id, "valid"]]) };
  const r = armarReporte({ mes: "2026-10", pagos: [enganche, mensualidad], cfdi, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.excluidos.timbradoPorPago, 1);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].importe, 1000);
  assert.equal(r.filas[0].notaConSaldo, true, "la nota tiene saldo: se marca para no timbrarla sola después");
  assert.equal(r.conSaldo, 1);
});

test("timbre en duda (apartado «timbrando:…» o CFDI de pago «apartado») → «en revisión», fuera del total", () => {
  n = 0;
  const a = pago({ amount: 700 }, { cfdiUuid: "timbrando:inv_1" });
  const b = pago({ amount: 300 });
  const r = armarReporte({ mes: "2026-10", pagos: [a, b], cfdi: { porFactura: new Map(), porPago: new Map([[b.id, "apartado"]]) }, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.filas.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.apartados.enRevision.length, 2);
});

test("anticipo (saldo a favor) y reembolso van aparte; el reembolso de una nota timbrada no aparece", () => {
  n = 0;
  const anticipo = pago({ amount: 500, method: "anticipo" });
  const efectivo = pago({ amount: 1000 }, { id: "inv_r" });
  const reembolso = pago({ amount: 200, method: "refund" }, { id: "inv_r" });
  const timbrada = pago({ amount: 300 }, { id: "inv_t", cfdiUuid: "UUID-T" });
  const reembolsoTimbrada = pago({ amount: 100, method: "refund" }, { id: "inv_t", cfdiUuid: "UUID-T" });
  const cfdi: CfdiConocidos = { porFactura: new Map([["inv_t", ["valid"]]]), porPago: new Map() };
  const r = armarReporte({ mes: "2026-10", pagos: [anticipo, efectivo, reembolso, timbrada, reembolsoTimbrada], cfdi, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.total, 1000, "solo el efectivo; el anticipo y el reembolso no suman");
  assert.deepEqual(r.apartados.anticipos.map((f) => f.importe), [500]);
  assert.deepEqual(r.apartados.reembolsos.map((f) => f.importe), [200]);
});

test("IVA: nota con IVA incluido en clínica iva16, $1,160 → base $1,000.00 e IVA $160.00; exenta → sin IVA", () => {
  n = 0;
  const conIva = pago({ amount: 1160 }, { taxRate: 16, taxIncluded: true });
  const agregado = pago({ amount: 580 }, { taxRate: 16, taxIncluded: false }); // IVA agregado: siempre lleva
  const tasa0 = pago({ amount: 800 }, { taxRate: 0, taxIncluded: true });       // exenta a propósito
  const r = armarReporte({ mes: "2026-10", pagos: [conIva, agregado, tasa0], cfdi: SIN, modoClinica: "iva16", fechaLocal: fechaUtc });
  assert.deepEqual(r.filas.map((f) => [f.importe, f.base, f.iva, f.conIva]), [
    [1160, 1000, 160, true],
    [580, 500, 80, true],
    [800, 800, 0, false],
  ]);
  assert.equal(r.total, 2540);
  assert.equal(r.base, 2300);
  assert.equal(r.iva, 240);
  // Clínica exenta: la nota con IVA incluido sale exenta (lo mismo que haría el timbrado).
  assert.equal(llevaIva({ taxRate: 16, taxIncluded: true }, "exempt"), false);
});

test("Mercado Pago sin tipo de tarjeta: forma «por definir», no se inventa", () => {
  n = 0;
  const r = armarReporte({ mes: "2026-10", pagos: [pago({ amount: 999, method: "mercadopago" })], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.filas[0].formaSat, null);
  assert.deepEqual(r.porForma, [{ formaSat: null, importe: 999 }]);
});

test("CSV para Excel: BOM, encabezados, el total y las secciones aparte", () => {
  n = 0;
  const r = armarReporte({
    mes: "2026-10",
    pagos: [pago({ amount: 500, method: "debit" }), pago({ amount: 250, method: "anticipo" })],
    cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc,
  });
  const csv = csvDelReporte(r);
  assert.ok(csv.startsWith("﻿"));
  const lineas = csv.trim().split("\r\n");
  assert.match(lineas[0], /"Fecha de cobro","Folio de la nota"/);
  assert.match(lineas[1], /"2026-10-01","MF-1001","Tarjeta de débito","28",500,500,0,"Exento"/);
  assert.match(lineas[2], /"TOTAL para la global",500,500,0/);
  assert.match(lineas[3], /Saldo a favor.*Aparte: pagado con saldo a favor/);
});

test("mes válido y rango del mes en la zona de la clínica (CDMX, UTC-6)", () => {
  assert.equal(esMesValido("2026-10"), true);
  assert.equal(esMesValido("2026-13"), false);
  assert.equal(esMesValido("10-2026"), false);
  const { desde, hasta } = rangoDelMes("2026-10", "America/Mexico_City");
  assert.equal(desde.toISOString(), "2026-10-01T06:00:00.000Z");
  assert.equal(hasta.toISOString(), "2026-11-01T06:00:00.000Z");
  const dic = rangoDelMes("2026-12", "America/Mexico_City");
  assert.equal(dic.hasta.toISOString(), "2027-01-01T06:00:00.000Z");
});

// ── Auditoría de uso (ws1-t4, 4-oct-2026): C-38, C-39 y C-56 ────────────────────────────────

test("C-38 · MF-1036: el excedente que pasó a saldo a favor NO se resta como reembolso; el cobro sigue en la global", () => {
  n = 0;
  const cobro = pago({ amount: 2400, enDefinicionUnica: true }, { id: "inv_1036" });
  const traspaso = pago({ amount: 400, method: "refund", refundMethod: "saldo_a_favor", enDefinicionUnica: false }, { id: "inv_1036" });
  const r = armarReporte({ mes: "2026-09", pagos: [cobro, traspaso], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.total, 2400);
  assert.deepEqual(r.apartados.reembolsos, [], "antes: «Aparte: reembolso» −$400");
  assert.deepEqual(r.apartados.traspasos.map((f) => f.importe), [400]);
  assert.equal(clasificarPago(traspaso, SIN), "traspaso");
  // Un reembolso viejo sin método (NULL) sigue contando como reembolso, igual que en Finanzas.
  const viejo = pago({ amount: 300, method: "refund", refundMethod: null, enDefinicionUnica: true }, { id: "inv_1036" });
  assert.equal(clasificarPago(viejo, SIN), "reembolso");
  // Y uno real en efectivo trae su forma (01), no «Por definir» (C-56).
  const real = pago({ amount: 100, method: "refund", refundMethod: "cash", enDefinicionUnica: true });
  const r2 = armarReporte({ mes: "2026-10", pagos: [real], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r2.apartados.reembolsos[0].formaSat, "01");
});

test("C-38 · la global cuadra con Finanzas: global − reembolsos reales = neto de la definición única", () => {
  n = 0;
  // Septiembre de la clínica de prueba, en chico: 3 cobros, un traspaso a saldo a favor, un reembolso real.
  const pagos = [
    pago({ amount: 1000, enDefinicionUnica: true }, { id: "inv_a" }),
    pago({ amount: 400, method: "refund", refundMethod: "saldo_a_favor", enDefinicionUnica: false }, { id: "inv_a" }),
    pago({ amount: 600, method: "transfer", enDefinicionUnica: true }, { id: "inv_b" }),
    pago({ amount: 300, enDefinicionUnica: true }, { id: "inv_c" }),
    pago({ amount: 300, method: "refund", refundMethod: "cash", enDefinicionUnica: true }, { id: "inv_c" }),
  ];
  const r = armarReporte({ mes: "2026-09", pagos, cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  const neto = netoDelPeriodo(
    pagos.filter((p) => p.method !== "refund").map((p) => ({ amount: p.amount, paidAt: p.paidAt })),
    pagos.filter((p) => p.method === "refund" && p.refundMethod !== "saldo_a_favor").map((p) => ({ amount: p.amount, paidAt: p.paidAt })),
  ).neto;
  const reembolsos = r.apartados.reembolsos.reduce((s, f) => s + f.importe, 0);
  assert.equal(r.total - reembolsos, neto);
  assert.equal(neto, 1600);
});

test("C-01/C-38 · el anticipo cobrado de una cita que se canceló (nota CANCELADA, dejado a favor) va en la global del mes en que entró", () => {
  n = 0;
  // La definición única (C-01) lo cuenta como cobro: el reporte lo sigue, aunque la nota esté cancelada.
  const anticipo = pago({ amount: 500, method: "transfer", enDefinicionUnica: true }, { id: "inv_1124", status: "CANCELLED" });
  const aFavor = pago({ amount: 500, method: "refund", refundMethod: "saldo_a_favor", enDefinicionUnica: false }, { id: "inv_1124", status: "CANCELLED" });
  const r = armarReporte({ mes: "2026-10", pagos: [anticipo, aFavor], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.total, 500);
  assert.equal(r.excluidos.noEsVenta, 0);
  // Sin la marca (servidor viejo), la nota cancelada sigue fuera como siempre.
  assert.equal(clasificarPago({ ...anticipo, enDefinicionUnica: undefined }, SIN), "noEsVenta");
  // Y lo que la definición única no cuenta (historia migrada, borradores…) queda fuera.
  assert.equal(clasificarPago(pago({ amount: 90, method: "migrated", enDefinicionUnica: false }), SIN), "noEsVenta");
});

test("C-39 · el anticipo pagado por Mercado Pago sin nota entra a la global el mes en que entró", () => {
  n = 0;
  const efectivo = pago({ amount: 1000, enDefinicionUnica: true });
  const r = armarReporte({
    mes: "2026-10",
    pagos: [efectivo],
    anticiposSinNota: [
      { id: "cred_1", creditDate: new Date("2026-10-15T18:00:00Z"), amount: 700, source: "anticipo_mercadopago" },
      { id: "cred_0", creditDate: new Date("2026-10-20T18:00:00Z"), amount: 0, source: "anticipo_mercadopago" },
    ],
    cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc,
  });
  assert.equal(r.total, 1700, "antes: $1,000 (el reporte solo leía payments)");
  assert.equal(r.anticiposSinNota, 700);
  assert.equal(r.notas, 1, "el anticipo sin nota no es una nota");
  const fila = r.filas.find((f) => f.origen === "anticipoSinNota")!;
  assert.equal(fila.fecha, "2026-10-15");
  assert.equal(fila.formaSat, null, "Mercado Pago: el panel no sabe si fue crédito o débito");
  const csv = csvDelReporte(r);
  assert.match(csv, /"2026-10-15","Sin nota","Anticipo por Mercado Pago \(sin nota\)"/);
});

test("C-56 · CSV: un reembolso ya no dice «Por definir (el panel no sabe con qué pagó)»", () => {
  n = 0;
  const cobro = pago({ amount: 800, enDefinicionUnica: true }, { id: "inv_r" });
  const viejo = pago({ amount: 200, method: "refund", refundMethod: null, enDefinicionUnica: true }, { id: "inv_r" });
  const csv = csvDelReporte(armarReporte({ mes: "2026-10", pagos: [cobro, viejo], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc }));
  const linea = csv.split("\r\n").find((l) => l.includes("Aparte: reembolso"))!;
  assert.doesNotMatch(linea, /Por definir/);
  assert.match(linea, /No aplica \(devolución\)/);
});

test("C-38 · el reembolso real de una nota que después se canceló también se aparta, como lo resta Finanzas", () => {
  n = 0;
  const cobro = pago({ amount: 790, enDefinicionUnica: true }, { id: "inv_c", status: "CANCELLED" });
  const devuelto = pago({ amount: 790, method: "refund", refundMethod: "cash", enDefinicionUnica: true }, { id: "inv_c", status: "CANCELLED" });
  const r = armarReporte({ mes: "2026-09", pagos: [cobro, devuelto], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.total, 790);
  assert.deepEqual(r.apartados.reembolsos.map((f) => f.importe), [790], "antes se perdía: global $790, neto de Finanzas $0");
});

// ── Segunda auditoría de uso (ws1-t4, 4-oct-2026): N-22, N-23, N-25 y N-27 ─────────────────────
import { asignarFifo } from "@/lib/cfdi/anticipos-timbrados";

test("N-22 · MF-1124 → MF-1126: el anticipo de $500 que se usó en una nota TIMBRADA sale de la global (un ingreso, un CFDI)", () => {
  n = 0;
  const cobro = pago({ amount: 500, method: "transfer", enDefinicionUnica: true }, { id: "inv_1124", invoiceNumber: "MF-1124", status: "CANCELLED", balance: 4000 });
  const otro = pago({ amount: 300, enDefinicionUnica: true }, { id: "inv_x" });
  // El libro: entró $500 por la cita cancelada de MF-1124 y se aplicó al abono «anticipo» de MF-1126.
  const tramos = asignarFifo(
    [{ id: "cr1", fecha: new Date("2026-10-03T18:00:00Z"), monto: 500, fuente: "cita_cancelada", invoiceId: "inv_1124", paymentId: null }],
    [{ id: "ap1", fecha: new Date("2026-10-03T20:00:00Z"), monto: 500, paymentId: "pay_ant_1126" }],
  );
  assert.deepEqual(tramos, [{ entradaId: "cr1", aplicacionPaymentId: "pay_ant_1126", monto: 500 }]);
  const r = armarReporte({
    mes: "2026-10", pagos: [cobro, otro], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc,
    cubiertosEnOtroCfdi: [{ tipo: "factura", ref: "inv_1124", monto: 500, folioDestino: "MF-1126" }],
  });
  assert.equal(r.total, 300, "antes: $800 (el $500 iba en la global Y en el CFDI de MF-1126)");
  assert.deepEqual(r.apartados.enOtroCfdi.map((f) => [f.folio, f.importe, f.folioDestino]), [["MF-1124", 500, "MF-1126"]]);
  assert.match(csvDelReporte(r), /Fuera de la global: ya va en el CFDI de MF-1126/);
  // Sin nota timbrada en el destino, el anticipo sigue en la global del mes en que entró (C-01).
  assert.equal(armarReporte({ mes: "2026-10", pagos: [cobro, otro], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc }).total, 800);
});

test("N-22 · FIFO: dos entradas y dos aplicaciones; solo se cubre lo que ya había entrado", () => {
  const t = asignarFifo(
    [
      { id: "a", fecha: new Date("2026-09-01"), monto: 300, fuente: "cita_cancelada", invoiceId: "i1", paymentId: null },
      { id: "b", fecha: new Date("2026-10-01"), monto: 200, fuente: "anticipo_mercadopago", invoiceId: null, paymentId: null },
    ],
    [
      { id: "x", fecha: new Date("2026-09-15"), monto: 250, paymentId: "p1" },
      { id: "y", fecha: new Date("2026-10-02"), monto: 250, paymentId: "p2" },
    ],
  );
  assert.deepEqual(t, [
    { entradaId: "a", aplicacionPaymentId: "p1", monto: 250 },
    { entradaId: "a", aplicacionPaymentId: "p2", monto: 50 },
    { entradaId: "b", aplicacionPaymentId: "p2", monto: 200 },
  ]);
});

test("N-23 · MF-1149: blanqueamiento con IVA 16% ($2,000) + limpieza exenta ($800) → IVA $275.86, no $0", () => {
  n = 0;
  const p = pago({ amount: 2800, enDefinicionUnica: true }, { taxRate: 0, taxIncluded: true, proporcionIva16: 2000 / 2800 });
  const r = armarReporte({ mes: "2026-10", pagos: [p], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.iva, 275.86);
  assert.equal(r.base, 2524.14);
  assert.equal(r.filas[0].conIva, true);
  // Todo exento por sus conceptos aunque la clínica sea iva16: sin IVA.
  const ex = armarReporte({ mes: "2026-10", pagos: [pago({ amount: 1000, enDefinicionUnica: true }, { proporcionIva16: 0 })], cfdi: SIN, modoClinica: "iva16", fechaLocal: fechaUtc });
  assert.equal(ex.iva, 0);
});

test("N-25 / N-27 · CSV: el traspaso no dice «Reembolso» ni «devolución»; una nota cancelada no «tiene saldo»", () => {
  n = 0;
  const cobro = pago({ amount: 500, enDefinicionUnica: true }, { id: "inv_c", status: "CANCELLED", balance: 4000 });
  const tr = pago({ amount: 500, method: "refund", refundMethod: "saldo_a_favor", enDefinicionUnica: false }, { id: "inv_c", status: "CANCELLED", balance: 4000 });
  const r = armarReporte({ mes: "2026-10", pagos: [cobro, tr], cfdi: SIN, modoClinica: "exempt", fechaLocal: fechaUtc });
  assert.equal(r.conSaldo, 0, "antes contaba la nota cancelada como «con saldo»");
  assert.equal(r.filas[0].notaConSaldo, false);
  const linea = csvDelReporte(r).split("\r\n").find((l) => l.includes("pasó a saldo a favor"))!;
  assert.match(linea, /"Traspaso a saldo a favor","No aplica \(no salió dinero\)"/);
  assert.doesNotMatch(linea, /Reembolso|devolución/);
});
