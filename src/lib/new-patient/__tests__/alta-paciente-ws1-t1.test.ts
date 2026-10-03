// ws1-t1 (auditoría BEVADENT, E1 y E2) — el alta desde el «Nuevo paciente» general recarga la lista de Pacientes, y
// el aviso de duplicado es una ventana propia que deja abrir la ficha que ya existe.
// Con el código de antes: el proveedor solo hacía `router.refresh()` (la lista, que pide sus filas desde el
// navegador, no se enteraba) y el duplicado se preguntaba con `window.confirm`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alCrearsePaciente, avisarPacienteCreado, EVENTO_PACIENTE_CREADO } from "../evento-paciente-creado";
import { leerDuplicado, textosDuplicado } from "../paciente-duplicado";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("E1 · el aviso «se creó un paciente» llega a quien escucha, y deja de llegar al soltarlo", () => {
  const destino = new EventTarget();
  (globalThis as { window?: unknown }).window = destino;
  try {
    const recibidos: string[] = [];
    const soltar = alCrearsePaciente((d) => recibidos.push(d.id));
    avisarPacienteCreado({ id: "pac_nuevo" });
    soltar();
    avisarPacienteCreado({ id: "pac_otro" });
    assert.deepEqual(recibidos, ["pac_nuevo"]);
    assert.equal(EVENTO_PACIENTE_CREADO, "dalecontrol:paciente-creado");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("E1 · sin window (servidor) no hace nada ni lanza", () => {
  assert.doesNotThrow(() => avisarPacienteCreado({ id: "x" }));
  assert.doesNotThrow(() => alCrearsePaciente(() => {})());
});

test("E1 · el proveedor general avisa y cierra; la lista de Pacientes se recarga al oírlo", () => {
  const proveedor = leer("components/dashboard/new-patient/new-patient-provider.tsx");
  assert.match(proveedor, /avisarPacienteCreado\(\{ id: patient\.id \}\)/);
  assert.match(proveedor, /setState\(\(s\) => \(\{ \.\.\.s, isOpen: false \}\)\)/);
  const lista = leer("app/dashboard/patients/patients-client.tsx");
  assert.match(lista, /useEffect\(\(\) => alCrearsePaciente\(\(\) => reload\(\)\), \[reload\]\)/);
});

test("E2 · lee el 409 DUPLICATE_PATIENT con sus gemelos visibles", () => {
  const d = leerDuplicado({
    error: 'Ya existe un paciente con nombre "Ana García".',
    code: "DUPLICATE_PATIENT",
    duplicates: [
      { id: "pac_1", patientNumber: "P0012", fullName: "Ana García", phone: "5512345678" },
      { id: "", fullName: "sin id" },
      null,
    ],
    hasHiddenDuplicates: false,
  });
  assert.deepEqual(d, {
    gemelos: [{ id: "pac_1", patientNumber: "P0012", fullName: "Ana García", phone: "5512345678" }],
    hayOcultos: false,
    mensaje: 'Ya existe un paciente con nombre "Ana García".',
  });
});

test("E2 · solo gemelos fuera de alcance: sin nadie que nombrar", () => {
  const d = leerDuplicado({ code: "DUPLICATE_PATIENT", duplicates: [], hasHiddenDuplicates: true, error: "fuera" });
  assert.equal(d?.gemelos.length, 0);
  assert.equal(d?.hayOcultos, true);
});

test("E2 · cualquier otro error no es un duplicado", () => {
  assert.equal(leerDuplicado({ code: "PLAN_LIMIT_PATIENTS" }), null);
  assert.equal(leerDuplicado(null), null);
  assert.equal(leerDuplicado("texto"), null);
});

test("E2 · textos: «Abrir su ficha» y «Crear igual», en español y en inglés", () => {
  const es = textosDuplicado("es");
  assert.match(es.cuerpoVisible("Ana García", 1), /Ya existe un paciente con el nombre «Ana García»\. ¿Abrir su ficha o crear/);
  assert.equal(es.abrirFicha, "Abrir su ficha");
  assert.equal(es.crearIgual, "Crear igual");
  assert.match(textosDuplicado("en").cuerpoVisible("Ana", 2), /2 patients named «Ana» already exist/);
});

test("E2 · la ventana de alta ya no usa window.confirm: abre la ficha o crea igual", () => {
  const alta = leer("components/dashboard/new-patient-modal.tsx");
  assert.doesNotMatch(alta, /window\.confirm\(/);
  assert.match(alta, /router\.push\(`\/dashboard\/patients\/\$\{id\}`\)/);
  assert.match(alta, /onClick=\{\(\) => \{ void enviar\(true\); \}\}/);
  assert.match(alta, /data-aviso-duplicado/);
});
