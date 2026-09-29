// Ortodoncia — quién sale en las listas de «doctor tratante» y con cuál
// arranca el alta (ws1-t5, ronda 6 · filas 29 y 30 de la revisión de uso).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atiendePacientes,
  doctorPropuestoParaElAlta,
  esOrtodoncista,
  etiquetaDeDoctor,
  opcionesDeDoctorTratante,
  type UsuarioCandidato,
} from "../doctores-tratantes";

function usuario(parcial: Partial<UsuarioCandidato> & { id: string }): UsuarioCandidato {
  return { firstName: "Nombre", lastName: parcial.id, role: "DOCTOR", ...parcial };
}

test("el dueño que atiende (SUPER_ADMIN en la agenda) sale en la lista", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "dueno", firstName: "Rafael", lastName: "Soto", role: "SUPER_ADMIN", agendaActive: true }),
  ]);
  assert.deepEqual(opciones.map((o) => o.id), ["dueno"]);
});

test("recepción y solo lectura nunca salen, aunque marquen especialidad", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "recep", role: "RECEPTIONIST", specialty: "Ortodoncia" }),
    usuario({ id: "lector", role: "READONLY" }),
  ]);
  assert.equal(opciones.length, 0);
});

test("la administradora fuera de la agenda no sale; si es ortodoncista, sí", () => {
  assert.equal(atiendePacientes(usuario({ id: "a", role: "ADMIN", agendaActive: false })), false);
  assert.equal(
    atiendePacientes(usuario({ id: "b", role: "ADMIN", agendaActive: false, specialty: "Ortodoncia" })),
    true,
  );
});

test("un usuario dado de baja no sale", () => {
  assert.equal(atiendePacientes(usuario({ id: "x", isActive: false })), false);
});

test("un doctor sale aunque esté fuera de la agenda", () => {
  assert.equal(atiendePacientes(usuario({ id: "d", role: "DOCTOR", agendaActive: false })), true);
});

test("reconoce la especialidad con o sin acentos y en la de la cédula", () => {
  assert.equal(esOrtodoncista({ specialty: "Ortodoncia" }), true);
  assert.equal(esOrtodoncista({ specialty: null, especialidad: "ORTODONCIA Y ORTOPEDIA MAXILAR" }), true);
  assert.equal(esOrtodoncista({ specialty: "Ortodoncista" }), true);
  assert.equal(esOrtodoncista({ specialty: "Endodoncia" }), false);
  assert.equal(esOrtodoncista({ specialty: null, especialidad: null }), false);
});

test("los ortodoncistas van primero y dentro se ordena por nombre", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "1", firstName: "Zoe", lastName: "Alba", specialty: "Endodoncia" }),
    usuario({ id: "2", firstName: "Bruno", lastName: "Díaz", specialty: "Ortodoncia" }),
    usuario({ id: "3", firstName: "Ana", lastName: "Paz" }),
    usuario({ id: "4", firstName: "Álvaro", lastName: "Ríos", role: "ADMIN", especialidad: "Ortodoncia" }),
  ]);
  assert.deepEqual(opciones.map((o) => o.id), ["4", "2", "3", "1"]);
  assert.equal(etiquetaDeDoctor(opciones[0]), "Álvaro Ríos · Ortodoncia");
  assert.equal(etiquetaDeDoctor(opciones[2]), "Ana Paz");
});

test("el alta arranca con el doctor por defecto de Configuración", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "1", specialty: "Ortodoncia" }),
    usuario({ id: "2" }),
  ]);
  assert.equal(doctorPropuestoParaElAlta({ porDefecto: "2", opciones }), "2");
});

test("si el doctor por defecto ya no está en la lista, no se propone", () => {
  const opciones = opcionesDeDoctorTratante([usuario({ id: "1" }), usuario({ id: "2" })]);
  assert.equal(doctorPropuestoParaElAlta({ porDefecto: "dado-de-baja", opciones }), "");
});

test("sin doctor por defecto, propone al único ortodoncista", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "1" }),
    usuario({ id: "2", specialty: "Ortodoncia" }),
    usuario({ id: "3" }),
  ]);
  assert.equal(doctorPropuestoParaElAlta({ porDefecto: null, opciones }), "2");
});

test("con dos ortodoncistas y sin doctor por defecto, no adivina", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "1", specialty: "Ortodoncia" }),
    usuario({ id: "2", specialty: "Ortodoncia" }),
  ]);
  assert.equal(doctorPropuestoParaElAlta({ porDefecto: null, opciones }), "");
});

test("con un solo doctor en la clínica, propone a ese", () => {
  const opciones = opcionesDeDoctorTratante([usuario({ id: "unico", role: "SUPER_ADMIN" })]);
  assert.equal(doctorPropuestoParaElAlta({ porDefecto: undefined, opciones }), "unico");
});

test("sin nadie que atienda, el alta queda sin asignar", () => {
  assert.equal(doctorPropuestoParaElAlta({ porDefecto: "x", opciones: [] }), "");
});

test("H4: quien no tiene acceso al módulo de Ortodoncia no se ofrece como doctor tratante", () => {
  const conAcceso = { id: "a", firstName: "Con", lastName: "Acceso", role: "DOCTOR", permissionsOverride: [] };
  const sinAcceso = { id: "b", firstName: "Solo", lastName: "Dental", role: "DOCTOR", permissionsOverride: ["patients.view"] };
  const ids = opcionesDeDoctorTratante([conAcceso, sinAcceso]).map((o) => o.id);
  assert.deepEqual(ids, ["a"]);
  assert.equal(atiendePacientes(sinAcceso), false);
});
test("H4: un override que sí trae el permiso deja pasar", () => {
  const u = { id: "c", firstName: "Con", lastName: "Override", role: "DOCTOR", permissionsOverride: ["specialties.orthodontics"] };
  assert.equal(atiendePacientes(u), true);
});
