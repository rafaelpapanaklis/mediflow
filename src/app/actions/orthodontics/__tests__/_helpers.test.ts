/**
 * `_helpers.ts` — candado de la revisión cruzada (Ola 1).
 *
 * Run: npm run test:orto-helpers
 *
 * Lo que fija:
 *  - Los 4 gates (getOrthoActionContext, getOrthoBillingActionContext,
 *    getOrthoConfigActionContext, getOrthoPlanActionContext) usan
 *    hasActiveOrthodonticsModule, NO canAccessModule (el atajo de trial que
 *    abría el módulo a CUALQUIER clínica dental en prueba — el caso que
 *    fallaba hoy antes de este arreglo).
 *  - getOrthoPlanActionContext (A11): un payload que SOLO toca
 *    responsibleGuardianId/newResponsibleGuardian pasa con billing.charge
 *    aunque falte medicalRecord.edit; cualquier otro campo clínico en el
 *    mismo payload sigue exigiendo medicalRecord.edit completo.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let moduloActivo = true;
let clinicIdRecibido: string | null = null;

const ctxBase = {
  userId: "u1",
  clinicId: "c1",
  clinicCategory: "DENTAL",
  color: "#000",
  clinic: {},
  user: {},
  isPlanExpired: false,
  isSuperAdmin: false,
  isAdmin: false,
  isDoctor: false,
  isReceptionist: false,
  canManageTeam: false,
};

let ctxActual: any = { ...ctxBase, role: "DOCTOR", permissionsOverride: [] };

(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ctxActual },
});
(mock as any).module("@/lib/orthodontics/access", {
  namedExports: {
    hasActiveOrthodonticsModule: async (clinicId: string) => {
      clinicIdRecibido = clinicId;
      return moduloActivo;
    },
  },
});

function reset(role: string, permissionsOverride: string[] = []) {
  moduloActivo = true;
  clinicIdRecibido = null;
  ctxActual = { ...ctxBase, role, permissionsOverride };
}

test("getOrthoActionContext: sin el módulo real activo, falla — usa hasActiveOrthodonticsModule (no canAccessModule)", async () => {
  reset("DOCTOR");
  moduloActivo = false;
  const { getOrthoActionContext } = await import("../_helpers");
  const res = await getOrthoActionContext();
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /no activo/i);
  assert.equal(clinicIdRecibido, "c1", "se consultó con el clinicId de la sesión");
});

test("getOrthoActionContext: DOCTOR (medicalRecord.edit) pasa con el módulo activo", async () => {
  reset("DOCTOR");
  const { getOrthoActionContext } = await import("../_helpers");
  const res = await getOrthoActionContext();
  assert.equal(res.ok, true);
});

test("getOrthoActionContext: RECEPTIONIST (sin medicalRecord.edit) NO pasa", async () => {
  reset("RECEPTIONIST");
  const { getOrthoActionContext } = await import("../_helpers");
  const res = await getOrthoActionContext();
  assert.equal(res.ok, false);
});

test("getOrthoBillingActionContext: sin el módulo real activo, falla", async () => {
  reset("RECEPTIONIST");
  moduloActivo = false;
  const { getOrthoBillingActionContext } = await import("../_helpers");
  const res = await getOrthoBillingActionContext("billing.charge");
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /no activo/i);
});

test("getOrthoBillingActionContext: acepta la key exacta (billing.view/create/edit/charge) — Cobro usa las 4", async () => {
  reset("RECEPTIONIST");
  const { getOrthoBillingActionContext } = await import("../_helpers");
  for (const key of ["billing.view", "billing.create", "billing.edit", "billing.charge"] as const) {
    const res = await getOrthoBillingActionContext(key);
    assert.equal(res.ok, true, `RECEPTIONIST debería tener ${key} por default`);
  }
  // DOCTOR no tiene billing.charge por default (P2: cotiza, no cobra).
  reset("DOCTOR");
  const { getOrthoBillingActionContext: fn2 } = await import("../_helpers");
  const negado = await fn2("billing.charge");
  assert.equal(negado.ok, false);
});

test("getOrthoConfigActionContext: sin el módulo real activo, falla", async () => {
  reset("ADMIN");
  moduloActivo = false;
  const { getOrthoConfigActionContext } = await import("../_helpers");
  const res = await getOrthoConfigActionContext();
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /no activo/i);
});

// ── A11: responsibleGuardianId con billing.* (revisión cruzada) ──────────

test("getOrthoPlanActionContext: RECEPTIONIST (billing.charge, sin medicalRecord.edit) SÍ puede tocar solo responsibleGuardianId", async () => {
  reset("RECEPTIONIST");
  const { getOrthoPlanActionContext } = await import("../_helpers");
  const res = await getOrthoPlanActionContext({
    treatmentPlanId: "p1",
    responsibleGuardianId: "g1",
  });
  assert.equal(res.ok, true, "esto fallaba hoy antes del arreglo: recepción no tiene medicalRecord.edit");
});

test("getOrthoPlanActionContext: RECEPTIONIST también puede con newResponsibleGuardian (crear responsable nuevo)", async () => {
  reset("RECEPTIONIST");
  const { getOrthoPlanActionContext } = await import("../_helpers");
  const res = await getOrthoPlanActionContext({
    treatmentPlanId: "p1",
    newResponsibleGuardian: { fullName: "X", phone: "555", parentesco: "padre" },
  });
  assert.equal(res.ok, true);
});

test("getOrthoPlanActionContext: RECEPTIONIST NO puede si el payload trae CUALQUIER otro campo clínico junto al responsable", async () => {
  reset("RECEPTIONIST");
  const { getOrthoPlanActionContext } = await import("../_helpers");
  const res = await getOrthoPlanActionContext({
    treatmentPlanId: "p1",
    responsibleGuardianId: "g1",
    status: "IN_PROGRESS", // campo clínico
  });
  assert.equal(res.ok, false, "un campo clínico en el mismo payload sigue exigiendo medicalRecord.edit");
});

test("getOrthoPlanActionContext: DOCTOR (medicalRecord.edit) puede con cualquier campo, incluido technique", async () => {
  reset("DOCTOR");
  const { getOrthoPlanActionContext } = await import("../_helpers");
  const res = await getOrthoPlanActionContext({
    treatmentPlanId: "p1",
    technique: "METAL_BRACKETS",
    responsibleGuardianId: "g1",
  });
  assert.equal(res.ok, true);
});

test("getOrthoPlanActionContext: sin el módulo real activo, falla incluso para el caso solo-responsable", async () => {
  reset("RECEPTIONIST");
  moduloActivo = false;
  const { getOrthoPlanActionContext } = await import("../_helpers");
  const res = await getOrthoPlanActionContext({ treatmentPlanId: "p1", responsibleGuardianId: "g1" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /no activo/i);
});
