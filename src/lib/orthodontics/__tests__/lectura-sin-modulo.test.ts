/**
 * Decisión 3 del gerente (ws1-t10, punto 12): si la clínica deja de pagar el
 * módulo de Ortodoncia conserva la LECTURA de sus casos (NOM-004: el
 * expediente no se oculta), sin poder crear ni cobrar.
 *
 * Run: npm run test:orto-lectura-sin-modulo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accesoDeOrtodonciaEnLaFicha } from "../pestana-ficha";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("con módulo: la pestaña completa, haya tenido caso o no", () => {
  assert.equal(accesoDeOrtodonciaEnLaFicha({ moduloActivo: true, tuvoCaso: true }), "completo");
  assert.equal(accesoDeOrtodonciaEnLaFicha({ moduloActivo: true, tuvoCaso: false }), "completo");
});

test("sin módulo y con un caso que conservar: solo lectura", () => {
  assert.equal(accesoDeOrtodonciaEnLaFicha({ moduloActivo: false, tuvoCaso: true }), "solo-lectura");
});

test("sin módulo y sin caso: no hay pestaña (la sede sin el módulo no la ve, como siempre)", () => {
  assert.equal(accesoDeOrtodonciaEnLaFicha({ moduloActivo: false, tuvoCaso: false }), "oculto");
});

test("la ficha decide con la regla y solo pregunta por el caso cuando falta el módulo", () => {
  const src = leer("app/dashboard/patients/[id]/page.tsx");
  assert.match(src, /accesoDeOrtodonciaEnLaFicha\(/);
  assert.match(src, /orthoModuloActivo \? false : await pacienteTuvoCasoDeOrtodoncia\(user\.clinicId, patient\.id\)/);
  assert.match(src, /orthoSoloLectura=\{orthoSoloLectura\}/);
});

test("en solo lectura no se ofrece «Ortodoncia» como tipo de consulta nueva", () => {
  const src = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(src, /moduloOrtodoncia: showOrthodontics && !orthoSoloLectura/);
  assert.match(src, /soloLectura=\{orthoSoloLectura\}/);
});

test("la pestaña avisa «Solo lectura» y no ofrece abrir otro caso", () => {
  const src = leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(src, /\{soloLectura && \(/);
  assert.match(src, /<strong>Solo lectura\.<\/strong>/);
  assert.match(src, /\{!soloLectura && \(orthoData\?\.plan\?\.status === "COMPLETED"/);
});

test("crear y cobrar siguen exigiendo el módulo ACTIVO en el servidor (los 4 contextos)", () => {
  const src = leer("app/actions/orthodontics/_helpers.ts");
  const guardias = src.match(/await hasActiveOrthodonticsModule\(ctx\.clinicId\)/g) ?? [];
  assert.equal(guardias.length, 4);
});

test("el caso por paciente se consulta con el clinicId de la sesión, nunca sin él", () => {
  const src = leer("lib/orthodontics/tuvo-caso.ts");
  assert.match(src, /if \(!clinicId \|\| !patientId\) return false;/);
  assert.match(src, /const where = \{ clinicId, patientId, deletedAt: null \}/);
});
