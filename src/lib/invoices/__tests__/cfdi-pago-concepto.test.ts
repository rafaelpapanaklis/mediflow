// CFDI por pago de una factura a plazos (ws1-t1, sep-2026).
//
// Run: npm run test:cfdi-pago-concepto
//
// Lo que este archivo fija:
//  1. Solo las facturas "a plazos" admiten CFDI por pago — un pago único no.
//  2. El concepto dice la cuota EXACTA cuando el pago calza limpio con una
//     sola (enganche o "mensualidad N de M"), y algo más genérico cuando
//     abre varias o sobra — nunca un número inventado.
//  3. El candado "nunca pasar del total del caso", con la misma tolerancia
//     de 1¢ que el resto de los cuadres de CFDI.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { conceptoDePago, excedeElTotalDelCaso, facturaAdmiteCfdiPorPago } from "../cfdi-pago-concepto";

function condiciones(over: Partial<CondicionesPago> = {}): CondicionesPago {
  return {
    modo: "plazos",
    metodo: null,
    enganche: 0,
    numPagos: 18,
    frecuencia: "MONTHLY",
    primerPago: "2026-01-01",
    difiereConSuBanco: false,
    ...over,
  };
}

test("facturaAdmiteCfdiPorPago: solo modo plazos", () => {
  assert.equal(facturaAdmiteCfdiPorPago(condiciones({ modo: "plazos" })), true);
  assert.equal(facturaAdmiteCfdiPorPago(condiciones({ modo: "unico" })), false);
  assert.equal(facturaAdmiteCfdiPorPago(null), false);
  assert.equal(facturaAdmiteCfdiPorPago(undefined), false);
});

test("conceptoDePago: sin condiciones a plazos, el concepto no cambia", () => {
  const c = conceptoDePago({
    condiciones: condiciones({ modo: "unico" }),
    totalFactura: 18000,
    descripcionBase: "Tratamiento de ortodoncia",
    pagosAnteriores: [],
    pago: { amount: 18000, paidAt: "2026-01-01" },
  });
  assert.equal(c.descripcion, "Tratamiento de ortodoncia");
  assert.deepEqual(c.cuotas, []);
});

test("conceptoDePago: enganche limpio", () => {
  const c = conceptoDePago({
    condiciones: condiciones({ enganche: 1000, numPagos: 18 }),
    totalFactura: 19000,
    descripcionBase: "Tratamiento de ortodoncia",
    pagosAnteriores: [],
    pago: { amount: 1000, paidAt: "2026-01-01" },
  });
  assert.equal(c.descripcion, "Tratamiento de ortodoncia — enganche");
  assert.deepEqual(c.cuotas, []);
});

test("conceptoDePago: mensualidad N de M, limpia", () => {
  // 18 cuotas de $1,000 exactos (18000/18). Los dos primeros pagos ya
  // saldaron las cuotas 1 y 2; este pago es la 3.
  const c = conceptoDePago({
    condiciones: condiciones({ enganche: 0, numPagos: 18 }),
    totalFactura: 18000,
    descripcionBase: "Tratamiento de ortodoncia",
    pagosAnteriores: [
      { amount: 1000, paidAt: "2026-01-01" },
      { amount: 1000, paidAt: "2026-02-01" },
    ],
    pago: { amount: 1000, paidAt: "2026-03-01" },
  });
  assert.equal(c.descripcion, "Tratamiento de ortodoncia — mensualidad 3 de 18");
  assert.deepEqual(c.cuotas, [3]);
});

test("conceptoDePago: un abono que abre dos cuotas no inventa UN número", () => {
  const c = conceptoDePago({
    condiciones: condiciones({ enganche: 0, numPagos: 18 }),
    totalFactura: 18000,
    descripcionBase: "Tratamiento de ortodoncia",
    pagosAnteriores: [],
    pago: { amount: 2000, paidAt: "2026-01-01" }, // salda cuotas 1 y 2 de un jalón
  });
  assert.equal(c.descripcion, "Tratamiento de ortodoncia — abono (cuotas 1–2)");
  assert.deepEqual(c.cuotas, [1, 2]);
});

test("conceptoDePago: un pago que llega con el plan ya saldado", () => {
  const anteriores = Array.from({ length: 18 }, (_, i) => ({ amount: 1000, paidAt: `2026-${String(i + 1).padStart(2, "0")}-01` }));
  const c = conceptoDePago({
    condiciones: condiciones({ enganche: 0, numPagos: 18 }),
    totalFactura: 18000,
    descripcionBase: "Tratamiento de ortodoncia",
    pagosAnteriores: anteriores,
    pago: { amount: 500, paidAt: "2027-07-01" },
  });
  assert.equal(c.descripcion, "Tratamiento de ortodoncia — abono adicional");
  assert.deepEqual(c.cuotas, []);
});

test("conceptoDePago: un abono parcial SÍ nombra la cuota a la que va", () => {
  const c = conceptoDePago({
    condiciones: condiciones({ enganche: 0, numPagos: 18 }),
    totalFactura: 18000,
    descripcionBase: "Tratamiento de ortodoncia",
    pagosAnteriores: [],
    pago: { amount: 400, paidAt: "2026-01-01" }, // abona parte de la cuota 1 ($1,000)
  });
  assert.equal(c.descripcion, "Tratamiento de ortodoncia — mensualidad 1 de 18");
  assert.deepEqual(c.cuotas, [1]);
});

test("excedeElTotalDelCaso: exacto al total no excede", () => {
  assert.equal(excedeElTotalDelCaso({ yaTimbrado: 600, montoDelPago: 400, totalFactura: 1000 }), false);
});

test("excedeElTotalDelCaso: dentro de la tolerancia de 1¢", () => {
  assert.equal(excedeElTotalDelCaso({ yaTimbrado: 600, montoDelPago: 400.01, totalFactura: 1000 }), false);
});

test("excedeElTotalDelCaso: rebasa el total del caso", () => {
  assert.equal(excedeElTotalDelCaso({ yaTimbrado: 600, montoDelPago: 400.02, totalFactura: 1000 }), true);
});
