// Revisión ws1-t1 (fallo 4): tras «Crear plan de tratamiento» la pestaña seguía en «Sin planes
// de tratamiento» hasta recargar (el POST daba 201; solo se esperaba a `router.refresh()`).
// Fallan con el código viejo: no existía lib/patients/planes-recien-creados ni la ficha lo usaba.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agregarRecienCreado,
  planesConRecienCreados,
  purgarRecienCreados,
  quitarRecienCreado,
} from "@/lib/patients/planes-recien-creados";

const viejo = { id: "p-viejo", name: "Ortodoncia" };
const nuevo = { id: "p-nuevo", name: "QA 7e Plan restauraciones" };

test("el plan recién creado se ve al momento, primero", () => {
  assert.deepEqual(planesConRecienCreados([], [nuevo]), [nuevo]);
  assert.deepEqual(planesConRecienCreados([viejo], [nuevo]), [nuevo, viejo]);
  // Sin recién creados, la lista del servidor tal cual (misma referencia).
  const delServidor = [viejo];
  assert.equal(planesConRecienCreados(delServidor, []), delServidor);
});

test("cuando el servidor ya lo trae, gana la fila del servidor y la local sobra", () => {
  const delServidor = { ...nuevo, sessions: [{ id: "s1" }] };
  assert.deepEqual(planesConRecienCreados([delServidor, viejo], [nuevo]), [delServidor, viejo]);
  assert.deepEqual(purgarRecienCreados([delServidor, viejo], [nuevo]), []);
  const sigue = [nuevo];
  assert.equal(purgarRecienCreados([viejo], sigue), sigue, "sin cambio, misma referencia (no re-renderiza en bucle)");
});

test("agregar no duplica y borrar quita el recién creado", () => {
  assert.deepEqual(agregarRecienCreado(agregarRecienCreado([], nuevo), nuevo), [nuevo]);
  assert.deepEqual(agregarRecienCreado([], null), []);
  assert.deepEqual(agregarRecienCreado([], { id: "" }), []);
  assert.deepEqual(quitarRecienCreado([nuevo], "p-nuevo"), []);
  const sin = [nuevo];
  assert.equal(quitarRecienCreado(sin, "otro"), sin);
});

test("la ficha pinta lo que devolvió el POST y sigue refrescando", () => {
  const ficha = readFileSync(join(process.cwd(), "src/app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  assert.match(ficha, /treatments: planesDelServidor,/);
  assert.match(ficha, /const treatments = useMemo\(\s*\(\) => planesConRecienCreados\(planesDelServidor, planesRecienCreados\),/);
  const crear = ficha.slice(ficha.indexOf("async function handleCreateTreatment"), ficha.indexOf("async function handleUpdatePlan"));
  assert.match(crear, /setPlanesRecienCreados\(\(prev\) => agregarRecienCreado\(prev, \{ sessions: \[\], \.\.\.data \}\)\);\s*router\.refresh\(\);/);
  const borrar = ficha.slice(ficha.indexOf("async function handleDeleteTreatment"), ficha.indexOf("const [showNewTreatment"));
  assert.match(borrar, /quitarRecienCreado\(prev, plan\.id\)/);
});
