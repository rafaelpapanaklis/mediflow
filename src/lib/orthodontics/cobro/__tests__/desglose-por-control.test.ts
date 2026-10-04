// C-59 (auditoría de uso): el caso importado «QaDL Ana Ortega» en «Pago por control». Cifras reales de la
// clínica de prueba: colocación MF-1074 $8,000 (a plazos, 6 × $1,333.33, pagada) y cuatro controles facturados
// ($600, $600, $300 y $300 sin pagar). Antes la pestaña decía «Estimado: 4 controles × $300 = $1,200» contra
// «Colocación y controles $9,800»: el estimado no contaba la colocación ni lo ya facturado. Este módulo no
// existía con el código viejo.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desglosePorControl,
  estimadoDelCasoPorControl,
  textoDelEstimadoDelCaso,
  tituloPagosDeColocacion,
} from "../desglose-por-control";

const COLOCACION = "cqx10prhj7w95zm0zt3jo9lvc";
const cuotasDelCasoImportado = [
  // Las seis cuotas del plan a plazos de la colocación (sin factura propia).
  ...[1333.33, 1333.33, 1333.33, 1333.33, 1333.34, 1333.34].map((importe) => ({ importe })),
  { importe: 600, invoiceId: "c4xdz2l0vr1zwf9l57a2w8g9v" },
  { importe: 600, invoiceId: "ck6ktkztlizr44ticksoe14sb" },
  { importe: 300, invoiceId: "cmurebnvq000q10vpysf7xyyi" },
  { importe: 300, invoiceId: "cmutd4ind006yivdw9z1a7h8b" },
];

test("separa la colocación (6 pagos, $8,000) de los controles facturados (4, $1,800)", () => {
  const d = desglosePorControl(cuotasDelCasoImportado, COLOCACION);
  assert.deepEqual(d, { colocacion: 8000, pagosDeColocacion: 6, controles: 1800, controlesFacturados: 4 });
  // La suma es «Colocación y controles» de la misma pestaña.
  assert.equal(d.colocacion + d.controles, 9800);
});

test("con los 4 previstos ya facturados el estimado es exactamente $9,800 (antes: 4 × $300 = $1,200)", () => {
  const e = estimadoDelCasoPorControl({ desglose: desglosePorControl(cuotasDelCasoImportado, COLOCACION), previstos: 4, hechos: 4, precioPorControl: 300 });
  assert.equal(e.porVenir, 0);
  assert.equal(e.total, 9800);
  assert.equal(textoDelEstimadoDelCaso(e), "Colocación $8,000.00 + 4 controles ya facturados $1,800.00 = $9,800.00");
});

test("faltan controles: colocación + facturados + por venir × precio", () => {
  const d = desglosePorControl([{ importe: 5000, invoiceId: COLOCACION }, { importe: 800, invoiceId: "c1" }, { importe: 800, invoiceId: "c2" }], COLOCACION);
  assert.deepEqual(d, { colocacion: 5000, pagosDeColocacion: 1, controles: 1600, controlesFacturados: 2 });
  const e = estimadoDelCasoPorControl({ desglose: d, previstos: 18, hechos: 3, precioPorControl: 800 });
  // Tres atendidos (uno aún sin factura): faltan 15, no 16.
  assert.equal(e.porVenir, 15);
  assert.equal(e.total, 5000 + 1600 + 15 * 800);
  assert.match(textoDelEstimadoDelCaso(e), /15 controles por venir × \$800\.00 = \$18,600\.00$/);
});

test("sin precio por control no se inventa un total", () => {
  const d = desglosePorControl([{ importe: 5000, invoiceId: COLOCACION }], COLOCACION);
  const e = estimadoDelCasoPorControl({ desglose: d, previstos: 10, hechos: 0, precioPorControl: null });
  assert.equal(e.total, null);
  assert.match(textoDelEstimadoDelCaso(e), /sin precio por control/);
});

test("el calendario de la colocación no se llama «mensualidades»", () => {
  assert.equal(tituloPagosDeColocacion(6), "Pagos de la colocación (6)");
  assert.equal(tituloPagosDeColocacion(1), "Pago de la colocación");
});
