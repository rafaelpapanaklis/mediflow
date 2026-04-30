/**
 * Tests unitarios de evaluateAccess() (Sprint 1).
 *
 * Usa el test runner de Node 20+ (`node:test`). Correr con:
 *   npm run test:marketplace
 *   # o:
 *   npx tsx --test src/lib/marketplace/access-control.test.ts
 *
 * No toca Prisma — la lógica está en evaluateAccess() (pura) y
 * canAccessModule() es un wrapper trivial que solo trae datos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess, type ClinicAccessSnapshot } from "./access-control-core";

const ORTHO = "orthodontics";
const PEDIA = "pediatrics";

// Fechas de referencia para los escenarios:
//   Trial activo: now=2026-05-05, trialEndsAt=2026-05-15  → 10 días restantes
//   Post-trial:   now=2026-05-20, trialEndsAt=2026-05-15  → 5 días pasados
const NOW_IN_TRIAL = new Date("2026-05-05T12:00:00Z");
const NOW_POST_TRIAL = new Date("2026-05-20T12:00:00Z");
const TRIAL_END = new Date("2026-05-15T12:00:00Z");
const PERIOD_END_FUTURE = new Date("2026-06-15T12:00:00Z");
const PERIOD_END_PAST = new Date("2026-05-10T12:00:00Z");

function snap(modules: ClinicAccessSnapshot["modules"]): ClinicAccessSnapshot {
  return { trialEndsAt: TRIAL_END, modules };
}

test("clínica en trial → acceso a CUALQUIER módulo (incluso sin compras)", () => {
  const result = evaluateAccess(snap([]), ORTHO, NOW_IN_TRIAL);
  assert.equal(result.hasAccess, true);
  assert.equal(result.reason, "trial");

  // Acceso también a un módulo random que no existe en el snapshot
  const r2 = evaluateAccess(snap([]), "any-other-module-key", NOW_IN_TRIAL);
  assert.equal(r2.hasAccess, true);
  assert.equal(r2.reason, "trial");
});

test("trial expirado, sin módulos comprados → sin acceso", () => {
  const result = evaluateAccess(snap([]), ORTHO, NOW_POST_TRIAL);
  assert.equal(result.hasAccess, false);
  assert.equal(result.reason, "not_purchased");
});

test("trial expirado, con módulo activo → acceso a ese módulo, NO a otros", () => {
  const snapshot = snap([
    {
      moduleKey: ORTHO,
      status: "active",
      currentPeriodEnd: PERIOD_END_FUTURE,
    },
  ]);

  const ortho = evaluateAccess(snapshot, ORTHO, NOW_POST_TRIAL);
  assert.equal(ortho.hasAccess, true);
  assert.equal(ortho.reason, "purchased");

  const pedia = evaluateAccess(snapshot, PEDIA, NOW_POST_TRIAL);
  assert.equal(pedia.hasAccess, false);
  assert.equal(pedia.reason, "not_purchased");
});

test("módulo cancelled → sin acceso (reason=expired)", () => {
  const snapshot = snap([
    {
      moduleKey: ORTHO,
      status: "cancelled",
      currentPeriodEnd: PERIOD_END_FUTURE,
    },
  ]);
  const result = evaluateAccess(snapshot, ORTHO, NOW_POST_TRIAL);
  assert.equal(result.hasAccess, false);
  assert.equal(result.reason, "expired");
});

test("módulo paused → sin acceso (reason=expired)", () => {
  const snapshot = snap([
    {
      moduleKey: ORTHO,
      status: "paused",
      currentPeriodEnd: PERIOD_END_FUTURE,
    },
  ]);
  const result = evaluateAccess(snapshot, ORTHO, NOW_POST_TRIAL);
  assert.equal(result.hasAccess, false);
  assert.equal(result.reason, "expired");
});

test("módulo activo pero currentPeriodEnd ya pasó → sin acceso (expired)", () => {
  const snapshot = snap([
    {
      moduleKey: ORTHO,
      status: "active",
      currentPeriodEnd: PERIOD_END_PAST,
    },
  ]);
  const result = evaluateAccess(snapshot, ORTHO, NOW_POST_TRIAL);
  assert.equal(result.hasAccess, false);
  assert.equal(result.reason, "expired");
});

test("clínica inexistente (snapshot=null) → sin acceso", () => {
  const result = evaluateAccess(null, ORTHO, NOW_POST_TRIAL);
  assert.equal(result.hasAccess, false);
  assert.equal(result.reason, "unknown_clinic");
});
