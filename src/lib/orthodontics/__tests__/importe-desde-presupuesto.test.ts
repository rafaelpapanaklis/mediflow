import { test } from "node:test";
import assert from "node:assert/strict";
import { importeDeOrtodonciaDelPresupuesto } from "../importe-desde-presupuesto";

const base = { folio: "P-0007", title: "Tratamiento", status: "ACCEPTED" };

test("todo de ortodoncia: sale el total aceptado (con su descuento)", () => {
  const r = importeDeOrtodonciaDelPresupuesto({
    ...base,
    subtotal: 30000,
    total: 27000,
    items: [{ name: "Ortodoncia con brackets metálicos", lineTotal: 30000 }],
  });
  assert.equal(r?.importe, 27000);
  assert.equal(r?.nota, "Tomado del presupuesto P-0007. Puedes cambiarlo.");
});

test("mixto: solo los conceptos de ortodoncia, el descuento global en proporción", () => {
  const r = importeDeOrtodonciaDelPresupuesto({
    ...base,
    subtotal: 40000,
    total: 36000,
    items: [
      { name: "Ortodoncia con brackets estéticos", lineTotal: 35000 },
      { name: "Retenedor de ortodoncia", lineTotal: 3000 },
      { name: "Resina 16", lineTotal: 2000 },
    ],
  });
  assert.equal(r?.importe, 34200);
  assert.deepEqual(r?.conceptos, ["Ortodoncia con brackets estéticos", "Retenedor de ortodoncia"]);
  assert.match(r?.nota ?? "", /solo los conceptos de ortodoncia/);
});

test("de ortodoncia por el título: todo el presupuesto es el tratamiento", () => {
  const r = importeDeOrtodonciaDelPresupuesto({
    ...base,
    title: "Ortodoncia completa",
    subtotal: 25000,
    total: 25000,
    items: [
      { name: "Fase 1", lineTotal: 10000 },
      { name: "Fase 2", lineTotal: 15000 },
    ],
  });
  assert.equal(r?.importe, 25000);
});

test("no aceptado, no de ortodoncia o sin importe: null", () => {
  const items = [{ name: "Ortodoncia con brackets metálicos", lineTotal: 30000 }];
  assert.equal(importeDeOrtodonciaDelPresupuesto({ ...base, status: "PRESENTED", subtotal: 30000, total: 30000, items }), null);
  assert.equal(
    importeDeOrtodonciaDelPresupuesto({ ...base, subtotal: 800, total: 800, items: [{ name: "Resina 16", lineTotal: 800 }] }),
    null,
  );
  assert.equal(
    importeDeOrtodonciaDelPresupuesto({ ...base, subtotal: 0, total: 0, items: [{ name: "Ortodoncia", lineTotal: 0 }] }),
    null,
  );
});
