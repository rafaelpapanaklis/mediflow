// C-63 (auditoría de uso): un procedimiento escrito a mano sin precio se guardaba en el plan y se presentaba
// en el presupuesto sin aviso. Con el código viejo no había forma de contarlos fuera de «Convertir en
// presupuesto» (este módulo no existía).

import { test } from "node:test";
import assert from "node:assert/strict";
import { conceptosDelPresupuestoSinPrecio, renglonesDelPlanSinPrecio } from "../sin-precio";

test("plan: cuenta los renglones con nombre y precio vacío, cero o inválido", () => {
  assert.equal(
    renglonesDelPlanSinPrecio([
      { procedimiento: "Restauración resina 1 cara", precio: "700" },
      { procedimiento: "Ajuste oclusal (texto libre)", precio: "" },
      { procedimiento: "Revisión", precio: "0" },
      { procedimiento: "Algo", precio: "abc" },
      { procedimiento: "  ", precio: "" }, // renglón vacío: no cuenta
    ]),
    3,
  );
});

test("presupuesto: conceptos con precio unitario en $0", () => {
  assert.equal(conceptosDelPresupuestoSinPrecio([{ unitPrice: 700 }, { unitPrice: 0 }]), 1);
  assert.equal(conceptosDelPresupuestoSinPrecio([{ unitPrice: 700 }]), 0);
});
