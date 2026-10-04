// C-75 (auditoría de uso): «Tratamiento activo» con un plan ($1,350) contra «Plan activo $2,550» del estado de
// cuenta (dos planes). Con el código viejo la tarjeta solo miraba el primer plan activo (este módulo no existía).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenDePlanesActivos } from "../planes-activos";

test("dos planes activos: uno más y el total de los dos, la cifra del estado de cuenta", () => {
  assert.deepEqual(
    resumenDePlanesActivos([
      { status: "ACTIVE", totalCost: 1350 },
      { status: "ACTIVE", totalCost: 1200 },
      { status: "COMPLETED", totalCost: 999 },
    ]),
    { otros: 1, totalCosto: 2550 },
  );
  assert.deepEqual(resumenDePlanesActivos([{ status: "ACTIVE", totalCost: 1350 }]), { otros: 0, totalCosto: 1350 });
  assert.deepEqual(resumenDePlanesActivos([]), { otros: 0, totalCosto: 0 });
});
