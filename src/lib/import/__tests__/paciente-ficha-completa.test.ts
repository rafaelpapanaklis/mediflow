/**
 * ws1-t12 — FICHA COMPLETA DEL PACIENTE: «pacientes» no es solo nombre y teléfono. Con los encabezados REALES de
 * BEVADENT (01_Pacientes de Dentalink, 22 columnas) y filas inventadas:
 *   · cada columna con campo en Patient entra a su campo (CURP, etiquetas, convenio, «cómo nos conoció», alergias…);
 *   · lo que NO tiene campo no se pierde: va a las notas como «Dato de Dentalink: <columna>: <valor>»;
 *   · los rellenos del origen («-», «Sin convenio», «Sin Tipo») no son datos.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/paciente-ficha-completa.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica de prueba", timezone: "America/Mexico_City" }],
    user: [{ id: IMPORTA, clinicId: CLINICA, firstName: "Ana", lastName: "Prueba", isActive: true }],
    patient: [],
    importExternalIds: [],
  };
}
let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });

const engine = () => import("../engine");
const entidades = () => import("../entities");

const CABECERAS = ["# Paciente", "# Interno", "Cédula identidad / DNI", "Nombre", "Apellidos", "Fecha de nac.", "Edad", "Teléfono", "Celular", "Ciudad", "Comuna", "Dirección", "E-Mail", "Alertas", "Observaciones", "Sexo", "Tipo Paciente", "# Apoderado", "Convenio", "Nombre Empresa Convenio", "Empleador", "Referencia"];
const CURP = "PEPJ900517MMNRRN09";

const FILA_COMPLETA: Record<string, string> = {
  "# Paciente": "901", "# Interno": "INT-7", "Cédula identidad / DNI": CURP, Nombre: "Lucía", Apellidos: "Prueba Uno",
  "Fecha de nac.": "1990-05-17", Edad: "36", Teléfono: "4525550101", Celular: "+524525550102", Ciudad: "Uruapan", Comuna: "Centro",
  Dirección: "Calle Falsa 123", "E-Mail": "lucia@ejemplo.test", Alertas: "Hipertensión, alergia a penicilina", Observaciones: "Prefiere tardes",
  Sexo: "F", "Tipo Paciente": "URUAPAN", "# Apoderado": "Ana Prueba", Convenio: "Sin convenio", "Nombre Empresa Convenio": "Sin Convenio",
  Empleador: "Taller Prueba", Referencia: "redes sociales",
};

function csv(filas: Record<string, string>[], cabeceras = CABECERAS): File {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lineas = [cabeceras.map(esc).join(","), ...filas.map((f) => cabeceras.map((h) => esc(f[h] ?? "")).join(","))];
  return new File(["﻿" + lineas.join("\n") + "\n"], "01_Pacientes.csv", { type: "text/csv" });
}
async function correr(file: File, opts: { dryRun?: boolean; origin?: string | null } = {}): Promise<any> {
  const { runImport } = await engine();
  const { patientsHandler } = await entidades();
  return runImport(patientsHandler, { file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN", dryRun: opts.dryRun ?? true, skipDuplicates: true, origin: opts.origin === undefined ? "dentalink" : opts.origin });
}
const lineas = (notes: string) => notes.split("\n");

test("cada columna con campo en Patient entra a su campo", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([FILA_COMPLETA]));
  assert.equal(r.validos, 1);
  const d = r.preview[0].data;
  assert.equal(d.externalId, "901");
  assert.equal(d.firstName, "Lucía");
  assert.equal(d.lastName, "Prueba Uno");
  assert.equal(d.curp, CURP, "«Cédula identidad / DNI» con un CURP válido va a curp");
  assert.equal(d.phone, "+524525550102", "el celular es el principal");
  assert.equal(d.email, "lucia@ejemplo.test");
  assert.equal(d.gender, "F");
  assert.equal(d.address, "Calle Falsa 123, Centro, Uruapan", "dirección + comuna + ciudad, en la única dirección de Patient");
  assert.deepEqual(d.tags, ["URUAPAN"], "«Tipo Paciente» (la sucursal) → etiquetas");
  assert.equal(d.source, "redes sociales", "«Referencia» → cómo nos conoció");
  assert.deepEqual(d.allergies, ["alergia a penicilina"]);
  assert.deepEqual(d.chronicConditions, ["Hipertensión"]);
  assert.equal(d.insuranceProvider, undefined, "«Sin convenio» es relleno, no un convenio");
  assert.equal(d.dob.getFullYear(), 1990);
});

test("lo que no tiene campo NO se pierde: va a las notas como «Dato de Dentalink: <columna>: <valor>»", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([FILA_COMPLETA]));
  const l = lineas(r.preview[0].data.notes);
  assert.equal(l[0], "Prefiere tardes", "«Observaciones» sigue siendo el arranque de las notas");
  assert.ok(l.includes("Dato de Dentalink: # Interno: INT-7"));
  assert.ok(l.includes("Dato de Dentalink: # Apoderado: Ana Prueba"));
  assert.ok(l.includes("Dato de Dentalink: Empleador: Taller Prueba"));
  assert.ok(l.includes("Dato de Dentalink: Teléfono: 4525550101"), "el segundo teléfono (otro número) no se pierde");
  assert.ok(l.includes("Dato de Dentalink: Alertas: Hipertensión, alergia a penicilina"), "el texto original de las alertas queda tal cual");
  const todo = l.join("\n");
  assert.ok(!/Edad/.test(todo), "la edad se calcula de la fecha de nacimiento: no hay nada que conservar");
  assert.ok(!/Convenio|Sin Tipo|Referencia|Cédula/.test(todo), "lo que ya entró a un campo, o es relleno, no se repite en notas");
});

test("los rellenos «-», «Sin Tipo» y «Sin convenio» no son datos: ni avisos, ni etiquetas, ni notas", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([{ "# Paciente": "902", Nombre: "Mario", Apellidos: "Prueba Dos", "Fecha de nac.": "-", Edad: "-", "Tipo Paciente": "Sin Tipo", Convenio: "Sin convenio", "Nombre Empresa Convenio": "Sin Convenio", Referencia: "-", "# Apoderado": "-", Celular: "+524525550103" }]));
  const fila = r.preview[0];
  assert.equal(fila.status, "ok");
  assert.deepEqual(fila.warnings, [], "«-» como fecha de nacimiento ya no avisa «Fecha inválida»");
  assert.equal(fila.data.tags, undefined);
  assert.equal(fila.data.source, undefined);
  assert.equal(fila.data.notes, undefined);
});

test("la edad SIN fecha de nacimiento sí se conserva (es lo único que se sabe)", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([{ "# Paciente": "903", Nombre: "Pedro", Apellidos: "Prueba Tres", "Fecha de nac.": "", Edad: "41", Celular: "+524525550104" }]));
  assert.equal(r.preview[0].data.notes, "Dato de Dentalink: Edad: 41");
});

test("un documento que no es CURP ni RFC (17 caracteres) no se inventa: va a las notas y avisa", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([{ ...FILA_COMPLETA, "Cédula identidad / DNI": CURP.slice(1) }]));
  const fila = r.preview[0];
  assert.equal(fila.data.curp, undefined);
  assert.ok(lineas(fila.data.notes).includes(`Dato de Dentalink: Cédula identidad / DNI: ${CURP.slice(1)}`));
  assert.ok(fila.warnings.some((w: string) => /no es un CURP ni un RFC válido/.test(w)));
});

test("sin celular, el teléfono fijo ocupa su lugar y no se duplica en notas", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([{ "# Paciente": "904", Nombre: "Rosa", Apellidos: "Prueba Cuatro", Teléfono: "4525550105" }]));
  assert.equal(r.preview[0].data.phone, "4525550105");
  assert.equal(r.preview[0].data.notes, undefined);
});

test("sin un sistema de origen («Mi Excel») las columnas sin campo NO se mandan a las notas", async () => {
  base = crearBase(semilla());
  const r = await correr(csv([FILA_COMPLETA], ["Nombre", "Apellidos", "Empleador"]), { origin: null });
  assert.equal(r.validos, 1);
  assert.equal(r.preview[0].data.notes, undefined);
});

test("al importar de verdad, la ficha completa queda guardada en Patient (curp, etiquetas, alergias, fuente, notas)", async () => {
  base = crearBase(semilla());
  const res = await correr(csv([FILA_COMPLETA]), { dryRun: false });
  assert.equal(res.created, 1);
  const p = (base.tablas["patient"] ?? [])[0];
  assert.equal(p.curp, CURP);
  assert.deepEqual(p.tags, ["URUAPAN"]);
  assert.deepEqual(p.allergies, ["alergia a penicilina"]);
  assert.deepEqual(p.chronicConditions, ["Hipertensión"]);
  assert.equal(p.source, "redes sociales");
  assert.equal(p.address, "Calle Falsa 123, Centro, Uruapan");
  assert.match(p.notes, /Dato de Dentalink: Empleador: Taller Prueba/);
  assert.equal(p.insuranceProvider, null);
});
