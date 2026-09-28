// ws1-t1 ronda 2 — solo lo puro de clinic-settings-db.ts (lo demás es I/O
// contra Prisma). Run: npm run test:orto-clinic-settings-puro
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ORTHO_APPOINTMENT_TYPES,
  normalizarProximoControlBotEnabled,
} from "../clinic-settings-db";

test("proximoControlBotEnabled: null (columna sin pegar, o fila nueva) es ENCENDIDO", () => {
  assert.equal(normalizarProximoControlBotEnabled(null), true);
  assert.equal(normalizarProximoControlBotEnabled(undefined), true);
});

test("proximoControlBotEnabled: solo `false` explícito lo apaga", () => {
  assert.equal(normalizarProximoControlBotEnabled(false), false);
  assert.equal(normalizarProximoControlBotEnabled(true), true);
  // cualquier basura que no sea el booleano false se trata como "encendido":
  // más seguro fallar hacia el default de fábrica que hacia "apagado".
  assert.equal(normalizarProximoControlBotEnabled("false"), true);
  assert.equal(normalizarProximoControlBotEnabled(0), true);
});

test("el catálogo de fábrica trae duración propia SOLO en control y valoración", () => {
  const conDuracion = DEFAULT_ORTHO_APPOINTMENT_TYPES.filter((t) => t.durationMin != null);
  assert.deepEqual(
    conDuracion.map((t) => t.id).sort(),
    ["control", "valoracion"],
  );
});
