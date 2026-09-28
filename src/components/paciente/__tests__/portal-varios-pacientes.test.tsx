/**
 * Portal del paciente — una cuenta con varios pacientes en la MISMA clínica
 * (la mamá con dos hijos) no es una cuenta con varias clínicas (ws1-t5,
 * hallazgo 93 de la revisión de lógica de uso).
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/paciente/__tests__/portal-varios-pacientes.test.tsx
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClinicFilterChips, clinicasDistintas } from "../ui";
import type { PacienteClinica } from "../../../lib/patient-portal/types";

function clinica(clinicId: string, clinicName: string, patientId: string): PacienteClinica {
  return {
    clinicId,
    clinicName,
    clinicSlug: clinicId,
    logoUrl: null,
    city: null,
    phone: null,
    patientId,
    patientNumber: `P-${patientId}`,
  };
}

const DOS_HIJOS = [clinica("norte", "Clínica Sonrisa", "ana"), clinica("norte", "Clínica Sonrisa", "luis")];

test("93 · dos hijos en la misma clínica son UNA clínica", () => {
  assert.deepEqual(
    clinicasDistintas(DOS_HIJOS).map((c) => c.clinicId),
    ["norte"],
  );
  assert.deepEqual(clinicasDistintas(null), []);
});

test("93 · con una sola clínica no salen chips (antes salían dos «Clínica Sonrisa» iguales)", () => {
  const html = renderToStaticMarkup(<ClinicFilterChips clinics={DOS_HIJOS} value={null} onChange={() => {}} />);
  assert.equal(html, "");
});

test("93 · con dos clínicas de verdad salen «Todas» y una vez cada clínica", () => {
  const clinics = [...DOS_HIJOS, clinica("sur", "Dental Sur", "ana-sur")];
  const html = renderToStaticMarkup(<ClinicFilterChips clinics={clinics} value={null} onChange={() => {}} />);
  assert.equal(html.match(/Clínica Sonrisa/g)?.length, 1);
  assert.equal(html.match(/Dental Sur/g)?.length, 1);
  assert.match(html, /Todas/);
});
