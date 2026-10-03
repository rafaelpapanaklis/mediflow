/**
 * Paciente nuevo desde la fila de walk-in: nombre y apellidos por separado (ws1-t1, 3-oct-2026).
 *
 * Run: npm run test:walk-in-nombre-apellidos
 *
 * Antes «Iniciar» partía el texto libre de la fila en «primera palabra / el resto» («Ana» / «María López Ruiz»).
 * Ahora la pantalla pide confirmar los dos campos, prellenados con una propuesta. Con el código viejo el módulo
 * no existe y la pantalla no abre ninguna confirmación.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  leerNombreYApellidos,
  nombreCompleto,
  sugerirNombreYApellidos,
  textosPacienteNuevo,
} from "@/lib/walk-in/nombre-del-paciente-nuevo";

test("la propuesta deja DOS apellidos al final (lo habitual en México) y no parte en la primera palabra", () => {
  const casos: Array<[string, string, string]> = [
    ["Ana María López Ruiz", "Ana María", "López Ruiz"],
    ["Juan Pérez López", "Juan", "Pérez López"],
    ["Juan Pérez", "Juan", "Pérez"],
    ["  ana   maría  lópez ruiz ", "ana maría", "lópez ruiz"],
    ["José de la Cruz Martínez", "José", "de la Cruz Martínez"],
    ["María Fernanda del Río Gómez", "María Fernanda", "del Río Gómez"],
    ["Luis Ángel van der Berg", "Luis", "Ángel van der Berg"],
    ["Daisy", "Daisy", ""],
    ["", "", ""],
  ];
  for (const [completo, firstName, lastName] of casos) {
    assert.deepEqual(sugerirNombreYApellidos(completo), { firstName, lastName }, completo);
  }
});

test("solo vale con los dos campos llenos y de largo razonable; limpia espacios", () => {
  assert.deepEqual(leerNombreYApellidos({ firstName: "  Ana  María ", lastName: " López Ruiz " }), { firstName: "Ana María", lastName: "López Ruiz" });
  assert.equal(leerNombreYApellidos({ firstName: "Ana" }), null);
  assert.equal(leerNombreYApellidos({ firstName: "Ana", lastName: "   " }), null);
  assert.equal(leerNombreYApellidos({ firstName: 3, lastName: "López" }), null);
  assert.equal(leerNombreYApellidos({ firstName: "A".repeat(81), lastName: "López" }), null);
  assert.equal(leerNombreYApellidos(null), null);
  assert.equal(nombreCompleto({ firstName: "Ana María", lastName: "López" }), "Ana María López");
});

test("textos en español e inglés", () => {
  assert.equal(textosPacienteNuevo("es").apellidos, "Apellidos");
  assert.equal(textosPacienteNuevo("en-US").apellidos, "Last name(s)");
  assert.equal(textosPacienteNuevo(undefined).titulo, "Paciente nuevo");
});

test("el servidor ya no parte el nombre: usa lo confirmado y sin ello contesta 400", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/walk-in/iniciar-consulta.ts"), "utf8");
  assert.doesNotMatch(src, /partirNombre|split\(/, "nada de partir el texto libre en el servidor");
  assert.match(src, /nombre_y_apellidos_requeridos/);
  const ruta = readFileSync(join(process.cwd(), "src/app/api/walk-in/[id]/route.ts"), "utf8");
  assert.match(ruta, /nombre: leerNombreYApellidos\(body\)/);
});

test("la pantalla abre «Paciente nuevo» antes de iniciar una fila sin paciente y manda los dos campos", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/walk-in/walk-in-client.tsx"), "utf8");
  assert.match(src, /if \(action === "start" && fila && !fila\.patientId && !nombre\) \{\s*setPacienteNuevo\(/);
  assert.match(src, /\.\.\.\(nombre \?\? \{\}\)/);
  assert.match(src, /err\?\.error === "nombre_y_apellidos_requeridos"/);
  // En las dos versiones de la pantalla (con y sin el rediseño).
  assert.equal(src.match(/\{ventanaPacienteNuevo\}/g)?.length, 2);
});
