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
