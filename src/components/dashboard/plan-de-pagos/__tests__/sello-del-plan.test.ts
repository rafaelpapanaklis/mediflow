// C-73 (auditoría de uso): MF-1132 decía «Falta el enganche» y «Al corriente» a la vez. Con el código viejo el
// sello era «Al corriente» siempre que nada estuviera vencido (este módulo no existía).

import { test } from "node:test";
import assert from "node:assert/strict";
import { selloDelPlan } from "../sello-del-plan";

test("enganche pendiente sin vencer: «Enganche por cobrar», no «Al corriente»", () => {
  assert.equal(selloDelPlan({ vencidas: 0, conFechas: true, cuotaActual: { esEnganche: true } }), "enganchePendiente");
});

test("los demás casos no cambian", () => {
  assert.equal(selloDelPlan({ vencidas: 1, conFechas: true, cuotaActual: { esEnganche: true } }), "vencido");
  assert.equal(selloDelPlan({ vencidas: 0, conFechas: true, cuotaActual: { esEnganche: false } }), "alCorriente");
  assert.equal(selloDelPlan({ vencidas: 0, conFechas: false, cuotaActual: { esEnganche: false } }), "sinFechas");
  assert.equal(selloDelPlan({ vencidas: 0, conFechas: true, cuotaActual: null }), "pagado");
});
