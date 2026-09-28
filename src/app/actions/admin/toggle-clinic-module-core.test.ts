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

const EN_UN_MES = new Date("2026-06-05T12:00:00Z");

interface StubState {
  clinic:           { id: string } | null;
  mod:              { id: string; key: string; isActive: boolean } | null;
  existing:         ExistingClinicModule | null;
  upsertCalls:      Array<{ clinicId: string; moduleId: string }>;
  cancelCalls:      Array<{ clinicModuleId: string }>;
  /** Llamadas a Stripe, en orden: "programar:sub_1", "deshacer:sub_1", "cancelar:sub_1". */
  stripeCalls:      string[];
  /** Si está puesto, toda llamada a Stripe lanza con este mensaje. */
  stripeFalla:      string | null;
  avisos:           Array<{ clinicId: string; moduleKey: string }>;
  avisoFalla:       boolean;
  logEntries:       ToggleAuditEntry[];
  revalidatedPaths: string[];
  authed:           boolean;
}

/** Una fila de `clinic_modules` con lo mínimo; por defecto, una cortesía activa. */
function existente(over: Partial<ExistingClinicModule> = {}): ExistingClinicModule {
  return {
    id:                   "cm_42",
    status:               "active",
    paymentMethod:        "admin",
    stripeSubscriptionId: null,
    currentPeriodEnd:     new Date("2099-12-31T23:59:59.999Z"),
    bajaProgramada:       false,
    ...over,
  };
}

/** Una compra real con tarjeta, vigente. */
function conTarjeta(over: Partial<ExistingClinicModule> = {}): ExistingClinicModule {
  return existente({ paymentMethod: "card", stripeSubscriptionId: "sub_1", currentPeriodEnd: EN_UN_MES, ...over });
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
    programarBajaStripe: async (id) => {
      if (state.stripeFalla) throw new Error(state.stripeFalla);
      state.stripeCalls.push(`programar:${id}`);
    },
    deshacerBajaStripe: async (id) => {
      if (state.stripeFalla) throw new Error(state.stripeFalla);
      state.stripeCalls.push(`deshacer:${id}`);
    },
    cancelarStripeYa: async (id) => {
      if (state.stripeFalla) throw new Error(state.stripeFalla);
      state.stripeCalls.push(`cancelar:${id}`);
    },
    avisarActivacion: async (args) => {
      if (state.avisoFalla) throw new Error("correo caído");
      state.avisos.push({ clinicId: args.clinicId, moduleKey: args.moduleKey });
    },
    log: (entry) => {
      state.logEntries.push(entry);
    },
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
    stripeCalls:      [],
    stripeFalla:      null,
    avisos:           [],
    avisoFalla:       false,
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
    existing: existente({ status: "cancelled", paymentMethod: "stripe", stripeSubscriptionId: "sub_viejo" }),
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
    existing: existente(),
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
    existing: existente({ status: "cancelled", paymentMethod: "stripe", stripeSubscriptionId: "sub_viejo" }),
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

// ── Correo al activar ────────────────────────────────────────────────────────

test("activar de cortesía avisa a la clínica por correo", async () => {
  const state = freshState();
  await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.deepEqual(state.avisos, [{ clinicId: "clinic_1", moduleKey: "endodontics" }]);
  assert.equal(state.logEntries[0]?.action, "cortesia");
});

test("si el correo falla, el módulo queda activo igual", async () => {
  const state = freshState({ avisoFalla: true });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.equal(state.upsertCalls.length, 1);
  assert.equal(state.logEntries.length, 1);
});

test("reactivar sobre una suscripción vieja ya cancelada NO toca Stripe", async () => {
  const state = freshState({
    existing: existente({ status: "cancelled", paymentMethod: "card", stripeSubscriptionId: "sub_viejo" }),
  });
  await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.deepEqual(state.stripeCalls, []);
  assert.equal(state.upsertCalls.length, 1);
});

// ── Apagar un módulo pagado por Stripe (decisión del 28-sep-2026) ────────────

test("apagar uno pagado con tarjeta SIN confirmar: no cambia nada y dice qué pasaría", async () => {
  const state = freshState({ existing: conTarjeta() });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "requiere_confirmacion");
  assert.deepEqual(result.plan, { tipo: "fin-de-periodo", hasta: EN_UN_MES.toISOString(), yaProgramada: false });
  assert.deepEqual(state.stripeCalls, []);
  assert.equal(state.cancelCalls.length, 0);
  assert.equal(state.logEntries.length, 0);
  assert.equal(state.revalidatedPaths.length, 0);
});

test("apagar uno pagado con tarjeta, confirmado: baja al fin del periodo y la fila sigue activa", async () => {
  const state = freshState({ existing: conTarjeta() });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false, confirmado: true },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "cancel_scheduled");
  assert.equal(result.hasta, EN_UN_MES.toISOString());
  assert.deepEqual(state.stripeCalls, ["programar:sub_1"]);
  // La baja real la marca el webhook cuando Stripe cierra el periodo.
  assert.equal(state.cancelCalls.length, 0, "la fila no se apaga hoy");

  const entry = state.logEntries[0]!;
  assert.equal(entry.action, "cancel_at_period_end");
  assert.equal(entry.stripeSubscriptionId, "sub_1");
  assert.equal(entry.hasta, EN_UN_MES.toISOString());
  assert.equal(entry.previousPaymentMethod, "card");
  assert.deepEqual(state.revalidatedPaths, ["/admin/clinics/clinic_1", "/dashboard"]);
});

test("si Stripe rechaza la baja, no se cambia nada ni se registra como hecha", async () => {
  const state = freshState({ existing: conTarjeta(), stripeFalla: "No such subscription" });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false, confirmado: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "stripe");
  assert.match(result.error ?? "", /No such subscription/);
  assert.match(result.error ?? "", /No se cambió nada/);
  assert.equal(state.cancelCalls.length, 0);
  assert.equal(state.logEntries.length, 0);
});

test("tarjeta con cobro fallido: cancela la suscripción ya y apaga la fila", async () => {
  const state = freshState({ existing: conTarjeta({ status: "paused" }) });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false, confirmado: true },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "cancelled");
  assert.deepEqual(state.stripeCalls, ["cancelar:sub_1"]);
  assert.equal(state.cancelCalls.length, 1);
  assert.equal(state.logEntries[0]?.action, "suscripcion_cancelada");
});

test("cobro fallido: si Stripe no cancela, la fila tampoco se apaga", async () => {
  const state = freshState({ existing: conTarjeta({ status: "paused" }), stripeFalla: "timeout" });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false, confirmado: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(state.cancelCalls.length, 0);
});

test("pago único (SPEI/OXXO): pide confirmación y, confirmado, apaga sin tocar Stripe", async () => {
  const pagoUnico = existente({ paymentMethod: "spei", stripeSubscriptionId: null, currentPeriodEnd: EN_UN_MES });
  const sin = freshState({ existing: pagoUnico });
  const r1 = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false },
    makeDeps(sin),
  );
  assert.equal(r1.code, "requiere_confirmacion");
  assert.equal(sin.cancelCalls.length, 0);

  const con = freshState({ existing: pagoUnico });
  const r2 = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false, confirmado: true },
    makeDeps(con),
  );
  assert.equal(r2.ok, true);
  assert.equal(r2.status, "cancelled");
  assert.deepEqual(con.stripeCalls, []);
  assert.equal(con.cancelCalls.length, 1);
  assert.equal(con.logEntries[0]?.action, "apagado");
});

test("una cortesía se apaga sin pedir confirmación ni tocar Stripe", async () => {
  const state = freshState({ existing: existente({ stripeSubscriptionId: "sub_viejo" }) });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(state.stripeCalls, []);
  assert.equal(state.cancelCalls.length, 1);
});

// ── Encender sobre una suscripción viva ──────────────────────────────────────

test("encender con la baja programada: deshace la baja en Stripe y NO lo convierte en cortesía", async () => {
  const state = freshState({ existing: conTarjeta({ bajaProgramada: true }) });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "active");
  assert.equal(result.paymentMethod, "card");
  assert.deepEqual(state.stripeCalls, ["deshacer:sub_1"]);
  assert.equal(state.upsertCalls.length, 0);
  assert.equal(state.avisos.length, 0, "no es una activación nueva: sin correo");
  assert.equal(state.logEntries[0]?.action, "resume");
});

test("encender uno ya activo y pagado: no hace nada (no pisa la suscripción)", async () => {
  const state = freshState({ existing: conTarjeta() });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, true);
  assert.equal(result.paymentMethod, "card");
  assert.equal(state.upsertCalls.length, 0);
  assert.deepEqual(state.stripeCalls, []);
  assert.equal(state.logEntries.length, 0);
});

test("encender con cobro fallido y suscripción viva: se rechaza con el porqué", async () => {
  const state = freshState({ existing: conTarjeta({ status: "paused" }) });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: true },
    makeDeps(state),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "bloqueado");
  assert.match(result.error ?? "", /Cancela primero esa suscripción/);
  assert.equal(state.upsertCalls.length, 0);
});

test("sin sesión de admin no se llega a Stripe", async () => {
  const state = freshState({ authed: false, existing: conTarjeta() });
  const result = await toggleClinicModuleCore(
    { clinicId: "clinic_1", moduleKey: "endodontics", enabled: false, confirmado: true },
    makeDeps(state),
  );
  assert.equal(result.error, "Unauthorized");
  assert.deepEqual(state.stripeCalls, []);
});
