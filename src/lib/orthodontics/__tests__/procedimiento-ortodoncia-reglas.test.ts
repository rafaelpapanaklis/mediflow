import { test } from "node:test";
import assert from "node:assert/strict";
import { errorDeAltaDeOrtodoncia, esFilaDelControl, etiquetaDeCobro, evaluarCambioDeOrtodoncia } from "../procedimiento-ortodoncia-reglas";

const alta = (o: Partial<Parameters<typeof errorDeAltaDeOrtodoncia>[0]> = {}) =>
  errorDeAltaDeOrtodoncia({ name: "Recementado de bracket", category: "orthodontics", incluido: false, moduloActivo: true, ...o });

test("alta de ortodoncia: módulo activo y cobro elegido", () => {
  assert.equal(alta(), null);
  assert.match(alta({ moduloActivo: false }) ?? "", /no está activo/);
  assert.match(alta({ incluido: undefined }) ?? "", /Elige cómo se cobra/);
  assert.match(alta({ incluido: null }) ?? "", /Elige cómo se cobra/);
});
test("alta de otra categoría no se toca", () => {
  assert.equal(alta({ category: "dental", incluido: undefined, moduloActivo: false }), null);
});
test("no se puede crear otro «Control de ortodoncia»", () => {
  assert.match(alta({ name: " control de ortodoncia " }) ?? "", /ya existe y es fijo/);
});

const control = { name: "Control de ortodoncia", code: "ORTO_CONTROL", category: "orthodontics" };
const normal = { name: "Retenedor", code: null, category: "orthodontics" };
test("la fila del control se reconoce por llave o por el nombre de siempre", () => {
  assert.equal(esFilaDelControl(control), true);
  assert.equal(esFilaDelControl({ name: "Control de ortodoncia", code: null, category: "orthodontics" }), true);
  assert.equal(esFilaDelControl({ name: "Control de ortodoncia", code: null, category: "general" }), false);
  assert.equal(esFilaDelControl(normal), false);
});
test("al control no se le cambia el incluido ni se le quita la categoría", () => {
  const r = evaluarCambioDeOrtodoncia({ existente: control, categoria: undefined, nombre: undefined, incluido: true, moduloActivo: true });
  assert.deepEqual(r, { error: null, aplicarIncluido: false });
  const s = evaluarCambioDeOrtodoncia({ existente: control, categoria: "general", nombre: undefined, incluido: undefined, moduloActivo: true });
  assert.match(s.error ?? "", /no se puede sacar/);
});
test("un procedimiento de ortodoncia sí cambia su incluido, con o sin módulo", () => {
  const r = evaluarCambioDeOrtodoncia({ existente: normal, categoria: undefined, nombre: undefined, incluido: false, moduloActivo: false });
  assert.deepEqual(r, { error: null, aplicarIncluido: true });
});
test("pasar uno de otra categoría a Ortodoncia exige módulo y cobro", () => {
  const g = { name: "Algo", code: null, category: "general" };
  assert.match(evaluarCambioDeOrtodoncia({ existente: g, categoria: "orthodontics", nombre: undefined, incluido: undefined, moduloActivo: true }).error ?? "", /Elige cómo se cobra/);
  assert.match(evaluarCambioDeOrtodoncia({ existente: g, categoria: "orthodontics", nombre: undefined, incluido: true, moduloActivo: false }).error ?? "", /no está activo/);
  assert.equal(evaluarCambioDeOrtodoncia({ existente: g, categoria: "orthodontics", nombre: undefined, incluido: true, moduloActivo: true }).error, null);
});
test("etiquetas en español", () => {
  assert.equal(etiquetaDeCobro(true), "Incluido en el tratamiento");
  assert.equal(etiquetaDeCobro(false), "Con costo aparte");
  assert.equal(etiquetaDeCobro(null), null);
});
