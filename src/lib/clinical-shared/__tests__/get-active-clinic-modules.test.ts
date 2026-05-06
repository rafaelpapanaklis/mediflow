/**
 * Tests unitarios de deriveActiveClinicModuleKeys() — variante pura del
 * helper que se ejecuta sin Prisma. Cubre:
 *   - Trial vigente devuelve TODAS las SPECIALTY_MODULE_KEYS.
 *   - Post-trial filtra por status='active' AND currentPeriodEnd > now.
 *   - Estados cancelled / paused / period vencido quedan fuera.
 *   - Snapshot null devuelve [].
 *   - Keys que no son de especialidad se ignoran.
 *
 * Correr con:
 *   npx tsx --test src/lib/clinical-shared/__tests__/get-active-clinic-modules.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveActiveClinicModuleKeys,
  SPECIALTY_MODULE_KEYS,
  type ClinicModulesSnapshot,
} from "../get-active-clinic-modules";
import { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import {
  canSeePediatrics,
  DEFAULT_PEDIATRICS_CUTOFF_YEARS,
} from "@/lib/pediatrics/permissions";

const NOW_IN_TRIAL = new Date("2026-05-05T12:00:00Z");
const NOW_POST_TRIAL = new Date("2026-05-20T12:00:00Z");
const TRIAL_END = new Date("2026-05-15T12:00:00Z");
const PERIOD_FUTURE = new Date("2026-06-15T12:00:00Z");
const PERIOD_PAST = new Date("2026-05-10T12:00:00Z");

function snap(modules: ClinicModulesSnapshot["modules"]): ClinicModulesSnapshot {
  return { trialEndsAt: TRIAL_END, modules };
}

test("snapshot null → []", () => {
  assert.deepEqual(deriveActiveClinicModuleKeys(null, NOW_POST_TRIAL), []);
});

test("trial vigente → TODAS las SPECIALTY_MODULE_KEYS, ignora compras", () => {
  const keys = deriveActiveClinicModuleKeys(snap([]), NOW_IN_TRIAL);
  assert.deepEqual([...keys].sort(), [...SPECIALTY_MODULE_KEYS].sort());
});

test("post-trial sin compras → []", () => {
  assert.deepEqual(deriveActiveClinicModuleKeys(snap([]), NOW_POST_TRIAL), []);
});

test("post-trial con módulo activo → solo ese módulo", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: PERIODONTICS_MODULE_KEY, status: "active", currentPeriodEnd: PERIOD_FUTURE },
    ]),
    NOW_POST_TRIAL,
  );
  assert.deepEqual(keys, [PERIODONTICS_MODULE_KEY]);
});

test("post-trial con módulo cancelled / paused → fuera", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: PERIODONTICS_MODULE_KEY, status: "cancelled", currentPeriodEnd: PERIOD_FUTURE },
      { moduleKey: IMPLANTS_MODULE_KEY,     status: "paused",    currentPeriodEnd: PERIOD_FUTURE },
    ]),
    NOW_POST_TRIAL,
  );
  assert.deepEqual(keys, []);
});

test("post-trial con currentPeriodEnd vencido → fuera", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: PERIODONTICS_MODULE_KEY, status: "active", currentPeriodEnd: PERIOD_PAST },
    ]),
    NOW_POST_TRIAL,
  );
  assert.deepEqual(keys, []);
});

test("post-trial ignora keys que no son specialty (ej. add-ons)", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: "ai-coach",              status: "active", currentPeriodEnd: PERIOD_FUTURE },
      { moduleKey: PERIODONTICS_MODULE_KEY, status: "active", currentPeriodEnd: PERIOD_FUTURE },
    ]),
    NOW_POST_TRIAL,
  );
  assert.deepEqual(keys, [PERIODONTICS_MODULE_KEY]);
});

test("post-trial con varios specialty keys activos → todos", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: PERIODONTICS_MODULE_KEY, status: "active", currentPeriodEnd: PERIOD_FUTURE },
      { moduleKey: IMPLANTS_MODULE_KEY,     status: "active", currentPeriodEnd: PERIOD_FUTURE },
    ]),
    NOW_POST_TRIAL,
  );
  assert.deepEqual([...keys].sort(), [PERIODONTICS_MODULE_KEY, IMPLANTS_MODULE_KEY].sort());
});

// ── Integración con predicates de UI ─────────────────────────────────────
// El helper alimenta `clinicModules: string[]` que ingieren los predicates
// puros (canSeePediatrics, canSeeImplants, etc.). Verificamos el contrato
// extremo a extremo: la salida del helper produce el resultado correcto
// del predicado para los dos escenarios canónicos (trial / post-trial).

const ELEVEN_YEARS_AGO = new Date(NOW_POST_TRIAL);
ELEVEN_YEARS_AGO.setFullYear(ELEVEN_YEARS_AGO.getFullYear() - 11);

test("integración: trial vigente + DENTAL + DOB pediátrico → canSeePediatrics", () => {
  const keys = deriveActiveClinicModuleKeys(snap([]), NOW_IN_TRIAL);
  assert.equal(
    canSeePediatrics({
      clinicCategory: "DENTAL",
      clinicModules: keys,
      patientDob: ELEVEN_YEARS_AGO,
      cutoffYears: DEFAULT_PEDIATRICS_CUTOFF_YEARS,
    }),
    true,
  );
});

test("integración: post-trial sin pediatría comprada → !canSeePediatrics", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: IMPLANTS_MODULE_KEY, status: "active", currentPeriodEnd: PERIOD_FUTURE },
    ]),
    NOW_POST_TRIAL,
  );
  assert.equal(
    canSeePediatrics({
      clinicCategory: "DENTAL",
      clinicModules: keys,
      patientDob: ELEVEN_YEARS_AGO,
    }),
    false,
  );
});

test("integración: post-trial con pediatría comprada → canSeePediatrics", () => {
  const keys = deriveActiveClinicModuleKeys(
    snap([
      { moduleKey: PEDIATRICS_MODULE_KEY, status: "active", currentPeriodEnd: PERIOD_FUTURE },
    ]),
    NOW_POST_TRIAL,
  );
  assert.equal(
    canSeePediatrics({
      clinicCategory: "DENTAL",
      clinicModules: keys,
      patientDob: ELEVEN_YEARS_AGO,
    }),
    true,
  );
});
