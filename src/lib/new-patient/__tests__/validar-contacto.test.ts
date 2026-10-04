// ws1-t1 (ronda de arreglos de la auditoría de uso, C-88 y C-95) — teléfono, correo y avisos del alta.
// Con el código de antes: el servidor aceptaba phone «123», «abcdefghij» y un correo «ana@», la ventana
// avisaba «Completa los campos obligatorios marcados en rojo» sin nombrar el campo, un correo inválido no decía
// nada y el aviso de alta decía solo el nombre de pila («Paciente Audit creado»).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  correoValido,
  nombreParaAvisoDeAlta,
  telefonoValido,
  textoFaltanCampos,
} from "../validar-contacto";
import { validatePatientCreateBody } from "@/lib/patients/patient-create-core";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const alta = (extra: Record<string, unknown>) => validatePatientCreateBody({ firstName: "Ana", lastName: "López", ...extra });

test("teléfono: 10 dígitos o con lada; sin letras ni números cortos", () => {
  for (const ok of ["5512345678", "55 1234 5678", "(55) 1234-5678", "+52 55 1234 5678", "+1 (305) 555-0101", "999.123.4567"]) {
    assert.equal(telefonoValido(ok), true, ok);
  }
  for (const mal of ["123", "abcdefghij", "55-1234-567", "55 1234 5678 ext 2", "+52+5512345678", "1234567890123456"]) {
    assert.equal(telefonoValido(mal), false, mal);
  }
});

test("correo con forma de correo", () => {
  assert.equal(correoValido("ana@correo.com"), true);
  assert.equal(correoValido(" ana.lopez@clinica.com.mx "), true);
  for (const mal of ["ana", "ana@", "ana@correo", "ana correo@x.com", "@correo.com"]) assert.equal(correoValido(mal), false, mal);
});

test("🔴→🟢 el servidor rechaza «123» y «abcdefghij» (antes los guardaba: P0206, P0207)", () => {
  for (const phone of ["123", "abcdefghij"]) {
    const r = alta({ phone });
    assert.equal(r.ok, false, phone);
    assert.equal(r.ok === false && r.field, "phone");
    assert.match(r.ok === false ? r.error : "", /teléfono no es válido/);
  }
  assert.equal(alta({ phone: "+52 55 1234 5678" }).ok, true);
});

test("decisión 8 (como hoy): el servidor sigue aceptando el alta SIN teléfono (otras entradas la usan)", () => {
  assert.equal(alta({ phone: "" }).ok, true);
  assert.equal(alta({ phone: null }).ok, true);
  assert.equal(alta({}).ok, true);
});

test("🔴→🟢 el servidor rechaza un correo inválido y deja pasar el vacío", () => {
  const r = alta({ email: "ana@" });
  assert.equal(r.ok === false && r.field, "email");
  assert.equal(alta({ email: "" }).ok, true);
  assert.equal(alta({ email: "ana@correo.com" }).ok, true);
});

test("🔴→🟢 el aviso de obligatorios nombra los campos", () => {
  assert.equal(textoFaltanCampos(["Fecha de nacimiento"], "es"), "Falta: Fecha de nacimiento (marcado en rojo).");
  assert.equal(
    textoFaltanCampos(["Fecha de nacimiento", "Teléfono", "Alergias (separadas por coma)"], "es"),
    "Faltan: Fecha de nacimiento, Teléfono y Alergias (marcados en rojo).",
  );
  assert.equal(textoFaltanCampos(["Phone", "Gender"], "en"), "Missing: Phone and Gender (marked in red).");
});

test("🔴→🟢 el aviso de alta dice el nombre completo y el folio", () => {
  assert.equal(nombreParaAvisoDeAlta({ firstName: "Audit", lastName: "Recepcion Uno", patientNumber: "P0199" }), "Audit Recepcion Uno (P0199)");
  assert.equal(nombreParaAvisoDeAlta({ firstName: "Ana", lastName: "López" }), "Ana López");
});

test("la ventana usa las mismas reglas y avisa antes de enviar", () => {
  const v = leer("components/dashboard/new-patient-modal.tsx");
  assert.ok(!v.includes('toast.error(t("shell.newPatient.errRequiredFields"))'), "ya no el «marcados en rojo» a secas");
  assert.match(v, /toast\.error\(textoFaltanCampos\(faltan, locale\)\)/);
  assert.match(v, /if \(!telefonoValido\(form\.phone\)\)/);
  assert.match(v, /if \(form\.email\.trim\(\) && !correoValido\(form\.email\)\)/);
  assert.match(v, /data-campo="email"/);
  assert.match(v, /noValidate/);
  assert.match(v, /name: nombreParaAvisoDeAlta\(patient\)/);
});

// ws1-t1 (C-88 a medias, tercera ronda): `POST /api/patients` con el teléfono de emergencia «12» daba 201.
test("🔴→🟢 el teléfono de emergencia también se valida (si viene)", () => {
  const r = alta({ emergencyContactPhone: "12" });
  assert.equal(r.ok === false && r.field, "emergencyContactPhone");
  assert.match(r.ok === false ? r.error : "", /teléfono de emergencia no es válido/);
  assert.equal(alta({ emergencyContactPhone: "" }).ok, true);
  assert.equal(alta({ emergencyContactPhone: "55 1234 5678" }).ok, true);
  const v = leer("components/dashboard/new-patient-modal.tsx");
  assert.match(v, /if \(form\.emergencyContactPhone\.trim\(\) && !telefonoValido\(form\.emergencyContactPhone\)\)/);
  assert.match(v, /data-campo="emergencyContactPhone"/);
});
