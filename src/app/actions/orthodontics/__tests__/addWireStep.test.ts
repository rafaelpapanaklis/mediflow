/**
 * Ortodoncia — addWireStep guarda el material que eligió el doctor y la arcada (ws1-t12, ticket BEVADENT 4c/4d).
 * Antes «Cr-Co (Elgiloy)» y «Multi-stranded» se escribían como 'SS'. Con la base sin los valores nuevos
 * (sql/ws1-t12-material-de-arco.sql sin pegar) no se escribe nada falso: se rechaza con un mensaje.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npm run test:orto-arcos-y-controles
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "clinic-1";
const PLAN = "11111111-1111-4111-8111-111111111111";
const state = {
  enLaBase: true,
  preguntasALaBase: 0,
  creadas: [] as Array<Record<string, unknown>>,
  wheresPlan: [] as Array<Record<string, unknown>>,
  auditorias: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findFirst: async (a: { where: Record<string, unknown> }) => {
          state.wheresPlan.push(a.where);
          return { id: PLAN, clinicId: CLINICA, patientId: "pac-1" };
        },
      },
      orthoWireStep: {
        findFirst: async () => ({ orderIndex: 2 }),
        create: async (a: { data: Record<string, unknown> }) => {
          state.creadas.push(a.data);
          return {
            id: "paso-nuevo",
            orderIndex: a.data.orderIndex,
            phaseKey: a.data.phaseKey,
            material: a.data.material,
            shape: a.data.shape,
            gauge: a.data.gauge,
            purpose: null,
            archUpper: a.data.archUpper,
            archLower: a.data.archLower,
            durationWeeks: a.data.durationWeeks,
            auxiliaries: [],
            notes: null,
            status: "PLANNED",
            plannedDate: null,
            appliedDate: null,
            completedDate: null,
          };
        },
      },
    },
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/orthodontics/material-de-arco-db", {
  namedExports: {
    materialesNuevosEnLaBase: async () => {
      state.preguntasALaBase += 1;
      return state.enLaBase;
    },
  },
});
mock.module("../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ({ ok: true, data: { ctx: { clinicId: CLINICA, userId: "doc-1", role: "DOCTOR" } } }),
    auditOrtho: async (a: Record<string, unknown>) => {
      state.auditorias.push(a);
    },
  },
});

function reset(enLaBase: boolean) {
  state.enLaBase = enLaBase;
  state.preguntasALaBase = 0;
  state.creadas = [];
  state.wheresPlan = [];
  state.auditorias = [];
}

const arco = (material: string, arcada: { archUpper: boolean; archLower: boolean } = { archUpper: true, archLower: true }) => ({
  treatmentPlanId: PLAN,
  phase: "ALIGNMENT",
  material,
  shape: "ROUND",
  gauge: "016",
  ...arcada,
  durationWeeks: 6,
  auxiliaries: [],
});

test("Cr-Co se guarda como CR_CO (antes 'SS') y la fila devuelta lo dice", async () => {
  reset(true);
  const { addWireStep } = await import("../addWireStep");
  const r = await addWireStep(arco("CRCO"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(state.creadas[0]!.material, "CR_CO");
  assert.equal(r.data.paso.material, "CR_CO");
  assert.equal(state.creadas[0]!.clinicId, CLINICA, "la clínica sale del plan de la sesión");
  assert.equal(state.wheresPlan[0]!.clinicId, CLINICA);
  const despues = (state.auditorias[0]!.after ?? {}) as Record<string, unknown>;
  assert.equal(despues.material, "CRCO", "la bitácora conserva lo que se eligió");
  assert.equal(despues.materialGuardado, "CR_CO");
});

test("Multi-stranded y los NiTi con su variante, con la base al día", async () => {
  const { addWireStep } = await import("../addWireStep");
  for (const [clave, guardado] of [
    ["MULTI", "MULTISTRANDED"],
    ["NITI_SUPER", "NITI_SUPERELASTIC"],
    ["NITI_THERMO", "NITI_THERMAL"],
    ["NITI_CONV", "NITI"],
  ] as const) {
    reset(true);
    const r = await addWireStep(arco(clave));
    assert.equal(r.ok, true, clave);
    assert.equal(state.creadas[0]!.material, guardado, clave);
    assert.equal(r.ok ? r.data.aviso : "falló", null, `${clave}: con la base al día no hay nada que avisar`);
  }
});

test("sin el SQL: Cr-Co no se escribe (ni como acero) y se dice por qué", async () => {
  reset(false);
  const { addWireStep } = await import("../addWireStep");
  const r = await addWireStep(arco("CRCO"));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /Cr-Co.*aún no está disponible/);
  assert.equal(state.creadas.length, 0);
});

test("sin el SQL: un NiTi termoactivado se guarda como NiTi; acero no pregunta a la base", async () => {
  const { addWireStep } = await import("../addWireStep");
  reset(false);
  const termo = await addWireStep(arco("NITI_THERMO"));
  assert.equal(termo.ok, true);
  assert.equal(state.creadas[0]!.material, "NITI");
  // Revisión en panel.108 (fallo 5): antes se perdía la variante sin decir nada.
  assert.match(termo.ok ? (termo.data.aviso ?? "") : "", /«NiTi termoactivado» aún no está disponible: se guardó como «NiTi»/);
  reset(false);
  assert.equal((await addWireStep(arco("SS"))).ok, true);
  assert.equal(state.creadas[0]!.material, "SS");
  assert.equal(state.preguntasALaBase, 0);
});

test("4c: la arcada que se manda es la que se guarda; sin ninguna, no se crea", async () => {
  const { addWireStep } = await import("../addWireStep");
  reset(true);
  const r = await addWireStep(arco("SS", { archUpper: false, archLower: true }));
  assert.equal(r.ok, true);
  assert.deepEqual([state.creadas[0]!.archUpper, state.creadas[0]!.archLower], [false, true]);
  reset(true);
  const nada = await addWireStep(arco("SS", { archUpper: false, archLower: false }));
  assert.equal(nada.ok, false);
  assert.equal(state.creadas.length, 0);
});
