import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agregarPasoLocal,
  descartarPasosAlcanzados,
  mezclarPasosDeArco,
} from "../pasos-de-arco-optimistas";
import type { WireStepDTO } from "../types";

function paso(id: string, orderIndex: number, extra: Partial<WireStepDTO> = {}): WireStepDTO {
  return {
    id,
    orderIndex,
    phaseKey: "ALIGNMENT",
    material: "NITI",
    shape: "ROUND",
    gauge: "014",
    purpose: null,
    archUpper: true,
    archLower: true,
    durationWeeks: 6,
    auxiliaries: [],
    notes: null,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    ...extra,
  };
}

test("con la secuencia vacía, el primer arco aparece al instante (antes: «Aún no hay arcos»)", () => {
  const vista = mezclarPasosDeArco([], [paso("nuevo", 1)]);
  assert.equal(vista.length, 1);
  assert.equal(vista[0].id, "nuevo");
});

test("sin filas locales devuelve la misma lista del servidor (misma identidad)", () => {
  const servidor = [paso("a", 1)];
  assert.equal(mezclarPasosDeArco(servidor, []), servidor);
});

test("el arco nuevo va al final de la secuencia, ordenado por orderIndex", () => {
  const servidor = [paso("a", 1), paso("b", 2)];
  const vista = mezclarPasosDeArco(servidor, [paso("c", 3)]);
  assert.deepEqual(vista.map((w) => w.id), ["a", "b", "c"]);
});

test("cuando el servidor ya trae la fila, no se duplica y manda la del servidor", () => {
  const servidor = [paso("a", 1), paso("c", 2, { status: "ACTIVE" })];
  const vista = mezclarPasosDeArco(servidor, [paso("c", 2)]);
  assert.equal(vista, servidor);
  assert.equal(vista.length, 2);
  assert.equal(vista[1].status, "ACTIVE");
});

test("descartarPasosAlcanzados quita solo las que el servidor ya trae", () => {
  const servidor = [paso("a", 1), paso("c", 3)];
  const locales = [paso("c", 3), paso("d", 4)];
  assert.deepEqual(descartarPasosAlcanzados(servidor, locales).map((w) => w.id), ["d"]);
});

test("descartarPasosAlcanzados devuelve el mismo arreglo si no hay nada que quitar", () => {
  const locales = [paso("d", 4)];
  assert.equal(descartarPasosAlcanzados([paso("a", 1)], locales), locales);
  const vacio: WireStepDTO[] = [];
  assert.equal(descartarPasosAlcanzados([paso("a", 1)], vacio), vacio);
});

test("agregarPasoLocal no duplica por id y no muta el arreglo original", () => {
  const original = [paso("a", 1)];
  const con = agregarPasoLocal(original, paso("b", 2));
  assert.deepEqual(con.map((w) => w.id), ["a", "b"]);
  assert.equal(original.length, 1);
  const reemplazo = agregarPasoLocal(con, paso("b", 2, { gauge: "016" }));
  assert.equal(reemplazo.length, 2);
  assert.equal(reemplazo.find((w) => w.id === "b")!.gauge, "016");
});

test("dos arcos agregados seguidos antes del refresh se ven los dos, en orden", () => {
  let locales: WireStepDTO[] = [];
  locales = agregarPasoLocal(locales, paso("x", 1));
  locales = agregarPasoLocal(locales, paso("y", 2));
  assert.deepEqual(mezclarPasosDeArco([], locales).map((w) => w.id), ["x", "y"]);
});

// ── Candado del cableado (el módulo puro no sirve si la ficha no lo usa) ─────
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

test("la ficha pinta la secuencia mezclada y el cajón agrega la fila que devolvió la acción", () => {
  const cliente = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(cliente, /wireSequence=\{wireSequence\}/);
  assert.doesNotMatch(cliente, /wireSequence=\{vm\.wireSequence\}/);
  assert.doesNotMatch(cliente, /availableWires=\{vm\.wireSequence\}/);
  assert.match(cliente, /agregarPasoLocal\(/);
  const pestana = leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(pestana, /return res\.data\.paso;/);
  const accion = leer("src/app/actions/orthodontics/addWireStep.ts");
  assert.match(accion, /paso: \{/);
});
