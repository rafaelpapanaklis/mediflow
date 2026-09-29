import { test } from "node:test";
import assert from "node:assert/strict";
import { soloModulosConCompra, TABS_VISIBLES, moduloSeOfrece } from "../catalogo-visible";

test("solo Ortodoncia se ofrece en el Marketplace", () => {
  const todos = ["orthodontics", "periodontics", "endodontics", "implants", "pediatric-dentistry", "cardiology"].map((key) => ({ key }));
  assert.deepEqual(soloModulosConCompra(todos), [{ key: "orthodontics" }]);
  assert.equal(moduloSeOfrece("periodontics"), false);
});

test("no hay pestañas de otras especialidades", () => {
  assert.deepEqual([...TABS_VISIBLES], ["Todos", "Dental"]);
});
