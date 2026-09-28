// H23 (QA ws1-t9): `RanuraCita` truena si la action de la cita falla a medio
// vuelo — "Abrir la cita justo cuando dev.108 dio 502" produjo
// `TypeError: Cannot read properties of undefined (reading 'ok')` dentro de
// `isFailure(res)`. Ver resolverEstadoRanuraCita en ../RanuraCita.tsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverEstadoRanuraCita } from "../ranura-cita-estado";

test("EL CASO QUE FALLABA HOY: la action resuelve undefined (502 a medio vuelo) — no truena, cae al estado vacío", () => {
  const estado = resolverEstadoRanuraCita(undefined);
  assert.deepEqual(estado, { treatmentPlanId: null, canOpenClinicalCard: false });
});

test("la action resuelve null: mismo estado vacío, sin excepción", () => {
  const estado = resolverEstadoRanuraCita(null);
  assert.deepEqual(estado, { treatmentPlanId: null, canOpenClinicalCard: false });
});

test("fallo explícito (ok: false): estado vacío", () => {
  const estado = resolverEstadoRanuraCita({ ok: false, error: "sin permiso" });
  assert.deepEqual(estado, { treatmentPlanId: null, canOpenClinicalCard: false });
});

test("éxito: se queda con treatmentPlanId y canOpenClinicalCard de la respuesta", () => {
  const estado = resolverEstadoRanuraCita({
    ok: true,
    data: { treatmentPlanId: "plan_1", canOpenClinicalCard: true },
  });
  assert.deepEqual(estado, { treatmentPlanId: "plan_1", canOpenClinicalCard: true });
});
