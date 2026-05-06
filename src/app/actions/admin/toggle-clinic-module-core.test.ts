/**
 * Tests unitarios de toggleClinicModuleCore. Sin mocks de módulos: el
 * core recibe sus deps por inyección, así que cada test arma stubs
 * a mano. Sigue el patrón de evaluateAccess/access-control.test.ts.
 *
 *   npx tsx --test src/app/actions/admin/toggle-clinic-module-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toggleClinicModuleCore,
  type ToggleAuditEntry,
  type ToggleDeps,
  type ExistingClinicModule,
} from "./toggle-clinic-module-core";

const FIXED_NOW = new Date("2026-05-05T12:00:00Z");

interface StubState {
  clinic:           { id: string } | null;
  mod:              { id: string; key: string; isActive: boolean } | null;
  existing:         ExistingClinicModule | null;
  upsertCalls:      Array<{ clinicId: string; moduleId: string }>;
  cancelCalls:      Array<{ clinicModuleId: string }>;
  logEntries:       ToggleAuditEntry[];
  revalidatedPaths: string[];
  authed:           boolean;
}

function makeDeps(state: StubState): ToggleDeps {
  return {
    isAuthed: () => state.authed,
    findClinic: async (id) => (state.clinic && state.clinic.id === id ? state.clinic : null),
    findModule: async (key) => (state.mod && state.mod.key === key ? state.mod : null),
    findExistingClinicModule: async () => state.existing,
    upsertActive: async (args) => {
      state.upsertCalls.push({ clinicId: args.clinicId, moduleId: args.moduleId });
    },
    cancel: async (args) => {
      state.cancelCalls.push({ clinicModuleId: args.clinicModuleId });
    },
    log: (entry) => state.logEntries.push(entry),
    revalidate: (path) => state.revalidatedPaths.push(path),
    now: () => FIXED_NOW,
  };
}

function freshState(overrides: Partial<StubState> = {}): StubState {
  return {
    clinic:           { id: "clinic_1" },
    mod:              { id: "mod_1", key: "endodontics", isActive: true },
    existing:         null,
    upsertCalls:      [],
    cancelCalls:      [],
    logEntries:       [],
    revalidatedPaths: [],
    authed:           true,
    ...overrides,
  };
}

test("rechaza si el admin no está autenticado", async () => {
  const state = freshState({ authed: false });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Unauthorized");
  assert.equal(state.upsertCalls.length, 0);
  assert.equal(state.logEntries.length, 0);
});

test("rechaza input inválido (clinicId vacío)", async () => {
  const state = freshState();
  const result = await toggleClinicModuleCore(
    { clinicId: "", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /clinicId/);
});

test("rechaza input inválido (moduleKey faltante)", async () => {
  const state = freshState();
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
});

test("rechaza si la clínica no existe", async () => {
  const state = freshState({ clinic: null });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_missing", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Clínica no encontrada");
});

test("rechaza si el módulo no existe", async () => {
  const state = freshState({ mod: null });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "nonexistent", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Módulo no disponible");
});

test("rechaza si el módulo está marcado inactivo en el catálogo", async () => {
  const state = freshState({
    mod: { id: "mod_1", key: "endodontics", isActive: false },
  });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Módulo no disponible");
});

test("activa un módulo nuevo: llama upsertActive y registra audit", async () => {
  const state = freshState();
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "active");
  assert.equal(result.paymentMethod, "admin");

  assert.equal(state.upsertCalls.length, 1);
  assert.deepEqual(state.upsertCalls[0], { clinicId: "clinic_1", moduleId: "mod_1" });

  assert.equal(state.cancelCalls.length, 0);

  assert.equal(state.logEntries.length, 1);
  const entry = state.logEntries[0]!;
  assert.equal(entry.type, "admin.clinic.module.toggled");
  assert.equal(entry.clinicId, "clinic_1");
  assert.equal(entry.moduleKey, "endodontics");
  assert.equal(entry.enabled, true);
  assert.equal(entry.previousStatus, null);
  assert.equal(entry.previousPaymentMethod, null);
  assert.equal(entry.by, "admin");
  assert.equal(entry.at, FIXED_NOW.toISOString());

  assert.deepEqual(state.revalidatedPaths, ["/admin/clinics/clinic_1", "/dashboard"]);
});

test("reactiva un módulo previamente cancelado: incluye previousStatus en el audit", async () => {
  const state = freshState({
    existing: { id: "cm_42", status: "cancelled", paymentMethod: "stripe" },
  });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );

  assert.equal(result.ok, true);
  assert.equal(state.upsertCalls.length, 1);
  assert.equal(state.logEntries[0]?.previousStatus, "cancelled");
  assert.equal(state.logEntries[0]?.previousPaymentMethod, "stripe");
});

test("desactiva un módulo activo: llama cancel y NO upsert", async () => {
  const state = freshState({
    existing: { id: "cm_42", status: "active", paymentMethod: "admin" },
  });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false },
    makeDeps(state),
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "cancelled");
  assert.equal(result.paymentMethod, undefined);

  assert.equal(state.cancelCalls.length, 1);
  assert.equal(state.cancelCalls[0]?.clinicModuleId, "cm_42");
  assert.equal(state.upsertCalls.length, 0);

  assert.equal(state.logEntries.length, 1);
  assert.equal(state.logEntries[0]?.enabled, false);
  assert.equal(state.logEntries[0]?.previousStatus, "active");
  assert.equal(state.logEntries[0]?.previousPaymentMethod, "admin");

  assert.deepEqual(state.revalidatedPaths, ["/admin/clinics/clinic_1", "/dashboard"]);
});

test("desactivar sin ClinicModule previo retorna error claro", async () => {
  const state = freshState({ existing: null });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "El módulo no está activo en esta clínica");
  assert.equal(state.cancelCalls.length, 0);
  assert.equal(state.logEntries.length, 0);
});

test("desactivar un módulo ya cancelado es idempotente: no muta ni audita", async () => {
  const state = freshState({
    existing: { id: "cm_42", status: "cancelled", paymentMethod: "stripe" },
  });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "cancelled");
  assert.equal(state.cancelCalls.length, 0);
  assert.equal(state.upsertCalls.length, 0);
  assert.equal(state.logEntries.length, 0, "idempotente: no se loguea");
  assert.equal(state.revalidatedPaths.length, 0);
});
