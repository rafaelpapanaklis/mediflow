// ws1-t5 — «Hoy» separa lo agotado de lo que está bajo, como Inventario.
// Correr: npm run test:inventario-arreglos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { avisosDeExistencias, contarExistenciasVigentes, filtroDeInventario } from "../avisos-existencias";

describe("avisos de existencias en Hoy", () => {
  it("la clínica de prueba: 108 agotados y 1 bajo son DOS avisos, no «109 bajo nivel»", () => {
    const avisos = avisosDeExistencias({ agotados: 108, bajos: 1 });
    assert.deepEqual(avisos, [
      { id: "inv-out", tone: "danger", title: "Inventario: 108 insumos agotados", href: "/dashboard/inventory?filter=out" },
      { id: "inv-low", tone: "warning", title: "Inventario: 1 insumo con stock bajo", href: "/dashboard/inventory?filter=low" },
    ]);
    assert.ok(avisos.every((a) => !a.title.includes("109")));
  });

  it("singular y plural", () => {
    assert.equal(avisosDeExistencias({ agotados: 1, bajos: 0 })[0].title, "Inventario: 1 insumo agotado");
    assert.equal(avisosDeExistencias({ agotados: 0, bajos: 4 })[0].title, "Inventario: 4 insumos con stock bajo");
  });

  it("solo sale el aviso de lo que pasa", () => {
    assert.deepEqual(avisosDeExistencias({ agotados: 3, bajos: 0 }).map((a) => a.id), ["inv-out"]);
    assert.deepEqual(avisosDeExistencias({ agotados: 0, bajos: 2 }).map((a) => a.id), ["inv-low"]);
  });

  it("todo en orden: ningún aviso", () => {
    assert.deepEqual(avisosDeExistencias({ agotados: 0, bajos: 0 }), []);
  });

  it("un conteo raro de la base (bigint convertido, negativo, NaN) no inventa avisos", () => {
    assert.deepEqual(avisosDeExistencias({ agotados: -1, bajos: NaN }), []);
    assert.equal(avisosDeExistencias({ agotados: Number(BigInt(5)), bajos: 0 })[0].title, "Inventario: 5 insumos agotados");
  });

  it("lo agotado va primero: es lo más urgente", () => {
    assert.equal(avisosDeExistencias({ agotados: 1, bajos: 1 })[0].id, "inv-out");
  });
});

describe("el enlace de cada aviso abre SU filtro", () => {
  it("cada aviso lleva a un filtro que la pantalla entiende", () => {
    for (const a of avisosDeExistencias({ agotados: 2, bajos: 2 })) {
      const param = new URL(a.href!, "https://x.test").searchParams.get("filter");
      assert.notEqual(filtroDeInventario(param), null, `el aviso ${a.id} lleva a un filtro desconocido`);
    }
  });

  it("agotados → «Agotados»; bajo → «Stock bajo»; caducidad como estaba", () => {
    assert.equal(filtroDeInventario("out"), "sin");
    assert.equal(filtroDeInventario("low"), "poco");
    assert.equal(filtroDeInventario("por-caducar"), "por_caducar");
    assert.equal(filtroDeInventario("caducado"), "caducado");
  });

  it("sin parámetro o con uno desconocido no cambia de filtro", () => {
    assert.equal(filtroDeInventario(null), null);
    assert.equal(filtroDeInventario(""), null);
    assert.equal(filtroDeInventario("todos"), null);
  });
});

describe("H17: «Stock bajo» y «Agotado» de Hoy cuentan solo lo vigente", () => {
  const items = [
    { id: "a", quantity: 10, minQuantity: 5 },
    { id: "b", quantity: 3, minQuantity: 5 },
    { id: "c", quantity: 0, minQuantity: 5 },
  ];
  it("sin caducados es el conteo de siempre", () => {
    assert.deepEqual(contarExistenciasVigentes(items, []), { agotados: 1, bajos: 1, sinContar: 0 });
  });
  it("lo caducado se resta: 10 con 7 caducados queda bajo; 3 con 3 caducados queda agotado", () => {
    const r = contarExistenciasVigentes(items, [
      { itemId: "a", remaining: 7 },
      { itemId: "b", remaining: 3 },
    ]);
    assert.deepEqual(r, { agotados: 2, bajos: 1, sinContar: 0 });
  });
  it("varios lotes caducados del mismo artículo se suman y nunca dejan negativo", () => {
    const r = contarExistenciasVigentes(items, [{ itemId: "b", remaining: 2 }, { itemId: "b", remaining: 9 }]);
    assert.deepEqual(r, { agotados: 2, bajos: 0, sinContar: 0 });
  });
});
