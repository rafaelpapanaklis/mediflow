/**
 * X8 — distinguir una llamada caída (mostrar «Reintentar») de una respuesta
 * real del servidor (callar).
 *
 * Run: npx tsx --test src/components/specialties/orthodontics/agenda/__tests__/ranura-cita-caida.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esRespuestaCaida } from "../ranura-cita-estado";

test("undefined, null, texto o forma rara = caída", () => {
  for (const r of [undefined, null, "", "<html>502</html>", 0, {}, { ok: "sí" }, { ok: true }, { ok: true, data: null }]) {
    assert.equal(esRespuestaCaida(r), true, JSON.stringify(r));
  }
});

test("respuestas reales no son caída: con caso, sin caso o fail legítimo", () => {
  assert.equal(esRespuestaCaida({ ok: true, data: { treatmentPlanId: "t", canOpenClinicalCard: true } }), false);
  assert.equal(esRespuestaCaida({ ok: true, data: { treatmentPlanId: null, canOpenClinicalCard: false } }), false);
  assert.equal(esRespuestaCaida({ ok: false, error: "Sin permisos" }), false);
});
