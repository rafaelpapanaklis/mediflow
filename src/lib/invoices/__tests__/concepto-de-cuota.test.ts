// A qué cuota fue un cobro (ws1-t5, ronda 6 — fila 12 del mapa de conexiones).
//
//   npx tsx --test src/lib/invoices/__tests__/concepto-de-cuota.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { conceptoConCuota, rotuloDeCuotasDelPago, type FilaDePago } from "../concepto-de-cuota";

/** Enganche de $4,000 + 24 mensualidades de $1,000 = $28,000. */
const plan = (over: Partial<CondicionesPago> = {}): CondicionesPago => ({
  ...condicionesPorDefecto(), modo: "plazos", enganche: 4_000, numPagos: 24, primerPago: "2026-01-05", ...over,
});
const TOTAL = 28_000;

let reloj = 0;
const pago = (id: string, amount: number, method = "cash"): FilaDePago => {
  reloj += 1;
  return { id, amount, method, paidAt: new Date(Date.UTC(2026, 0, 5, 12, reloj)) };
};

describe("rotuloDeCuotasDelPago", () => {
  it("el primer cobro es el enganche; los siguientes, cada mensualidad por su número", () => {
    const pagos = [pago("a", 4_000), pago("b", 1_000), pago("c", 1_000)];
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "a"), "enganche");
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "b"), "mensualidad 1 de 24");
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "c"), "mensualidad 2 de 24");
  });

  it("un cobro que cubre dos o más mensualidades lo dice", () => {
    const pagos = [pago("a", 4_000), pago("b", 2_000), pago("c", 3_000)];
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "b"), "mensualidades 1 y 2 de 24");
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "c"), "mensualidades 3 a 5 de 24");
  });

  it("un abono parcial cuenta para la mensualidad que abona, y el siguiente la termina", () => {
    const pagos = [pago("a", 4_000), pago("b", 400), pago("c", 600), pago("d", 1_000)];
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "b"), "mensualidad 1 de 24");
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "c"), "mensualidad 1 de 24");
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "d"), "mensualidad 2 de 24");
  });

  it("enganche y primera mensualidad en un solo cobro", () => {
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, [pago("a", 5_000)], "a"), "enganche y mensualidad 1 de 24");
  });

  it("un reembolso no es una mensualidad, y devuelve el dinero a la cuota: el siguiente cobro la vuelve a pagar", () => {
    const pagos = [pago("a", 4_000), pago("b", 1_000), pago("r", 1_000, "refund"), pago("c", 1_000)];
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "r"), null);
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, pagos, "c"), "mensualidad 1 de 24");
  });

  it("el orden es el de entrada aunque la lista llegue revuelta", () => {
    const a = pago("a", 4_000);
    const b = pago("b", 1_000);
    const c = pago("c", 1_000);
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, [c, a, b], "c"), "mensualidad 2 de 24");
  });

  it("un plan semanal o quincenal dice «pago», no «mensualidad»", () => {
    const semanal = plan({ frecuencia: "WEEKLY", enganche: 0, numPagos: 4 });
    const pagos = [pago("a", 1_000), pago("b", 2_000)];
    assert.equal(rotuloDeCuotasDelPago(semanal, 4_000, pagos, "a"), "pago 1 de 4");
    assert.equal(rotuloDeCuotasDelPago(semanal, 4_000, pagos, "b"), "pagos 2 y 3 de 4");
  });

  it("sin plan a plazos, con un pago que no está, o con dinero de más, no dice nada", () => {
    assert.equal(rotuloDeCuotasDelPago(null, TOTAL, [pago("a", 4_000)], "a"), null);
    assert.equal(rotuloDeCuotasDelPago({ ...condicionesPorDefecto() }, TOTAL, [pago("a", 4_000)], "a"), null);
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, [pago("a", 4_000)], "no-existe"), null);
    assert.equal(rotuloDeCuotasDelPago(plan(), TOTAL, [pago("a", TOTAL), pago("b", 500)], "b"), null);
  });
});

describe("conceptoConCuota", () => {
  it("añade la cuota al concepto de la factura", () => {
    assert.equal(conceptoConCuota("Tratamiento de ortodoncia", "mensualidad 7 de 24"), "Tratamiento de ortodoncia — mensualidad 7 de 24");
  });
  it("sin cuota, el concepto queda como estaba", () => {
    assert.equal(conceptoConCuota("Limpieza", null), "Limpieza");
    assert.equal(conceptoConCuota("—", null), "—");
  });
  it("sin concepto, la cuota sola y con mayúscula", () => {
    assert.equal(conceptoConCuota("—", "enganche"), "Enganche");
  });
});
