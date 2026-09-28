import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULO_ORTODONCIA, fichaOrtodonciaDesdeRutaVieja } from "../rutas-viejas";

test("lleva a la pestaña Ortodoncia de la ficha", () => {
  assert.equal(fichaOrtodonciaDesdeRutaVieja("p1"), "/dashboard/patients/p1?tab=ortodoncia");
});

test("conserva el resto de la dirección y no duplica la pestaña", () => {
  assert.equal(
    fichaOrtodonciaDesdeRutaVieja("p 1", { tab: "resumen", abrirCaso: "1", x: ["a", "b"], y: undefined }),
    "/dashboard/patients/p%201?tab=ortodoncia&abrirCaso=1&x=a&x=b",
  );
});

test("el módulo", () => {
  assert.equal(MODULO_ORTODONCIA, "/dashboard/orthodontics");
});
