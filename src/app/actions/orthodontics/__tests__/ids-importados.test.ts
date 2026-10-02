/**
 * Ortodoncia — las acciones aceptan los ids que de verdad hay en la base (ws1-t12, «Invalid uuid» de BEVADENT).
 *
 * El importador de Dentalink dejó casos, fases, diagnósticos y hojas con id cuid aunque el modelo diga
 * `@default(uuid())`; los pacientes son cuid en todas las clínicas; las siembras usan ids legibles. Antes 19 acciones
 * validaban con `z.string().uuid()` y rechazaban todo eso. Por cada acción y cada id:
 *   - cuid (como los de BEVADENT), uuid y de siembra: pasan la validación y la acción busca el registro CON el
 *     clinicId de la sesión (la autorización sigue igual);
 *   - basura: se rechaza con «Identificador inválido» sin preguntar nada a la base.
 * Y el caso exacto: firmar la hoja de control de un caso con id cuid.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npm run test:ids-de-la-base
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "clinica-de-la-sesion";
const ID_BEVADENT = "cmu8a1b2c3d4e5f6g7h8i9j0k"; // forma de los ids que dejó el importador: c + 24
const ID_UUID = "5b0c7a52-3f1e-4c8a-9d2b-6e4f1a0b9c3d";
const ID_SIEMBRA = "prueba-orto-plan-02";
const BASURA = ["", "   ", "abc def", "../x", "1;DROP TABLE x", "a'b", "x".repeat(65), "-empieza-con-guion", "con.punto"];

type Llamada = { donde: string; args: unknown };
const st = {
  llamadas: [] as Llamada[],
  /** Respuestas de una consulta concreta («modelo.metodo»); lo demás: null / [] / 0. */
  respuestas: new Map<string, (args: any) => unknown>(),
  pacientes: [] as string[],
  pacienteVisible: false,
};

function metodo(modelo: string, nombre: string) {
  return async (args: unknown) => {
    st.llamadas.push({ donde: `${modelo}.${nombre}`, args });
    const r = st.respuestas.get(`${modelo}.${nombre}`);
    if (r) return r(args);
    if (nombre === "findMany" || nombre === "groupBy") return [];
    if (nombre === "count") return 0;
    if (nombre.endsWith("Many")) return { count: 0 };
    return null;
  };
}
const crudo = (nombre: string) => async (...args: unknown[]) => {
  st.llamadas.push({ donde: nombre, args });
  return nombre === "$executeRaw" || nombre === "$executeRawUnsafe" ? 0 : [];
};
const prisma: any = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop === "$transaction") {
        return async (x: unknown) => (typeof x === "function" ? (x as (tx: unknown) => unknown)(prisma) : Promise.all(x as unknown[]));
      }
      if (prop.startsWith("$")) return crudo(prop);
      return new Proxy({}, { get: (_m, nombre: string) => metodo(prop, nombre) });
    },
  },
);

mock.module("@/lib/prisma", { namedExports: { prisma } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
// Al firmar puede salir la invitación a reseñar: aquí no sale nada a nadie (y el módulo trae «server-only»).
const invitaciones: unknown[] = [];
mock.module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async (a: unknown) => { invitaciones.push(a); return { ok: false }; } } });
const ctx = { ok: true, data: { ctx: { clinicId: CLINICA, userId: "doc-1", role: "OWNER" } } };
mock.module("../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ctx,
    getOrthoBillingActionContext: async () => ctx,
    getOrthoConfigActionContext: async () => ctx,
    getOrthoPlanActionContext: async () => ctx,
    loadPatientForOrtho: async (a: { ctx: { clinicId: string }; patientId: string }) => {
      st.pacientes.push(`${a.ctx.clinicId}|${a.patientId}`);
      return st.pacienteVisible ? { ok: true, data: { patient: { id: a.patientId } } } : { ok: false, error: "Paciente no encontrado" };
    },
    auditOrtho: async () => {},
  },
});

function reset() {
  st.llamadas = [];
  st.respuestas = new Map();
  st.pacientes = [];
  st.pacienteVisible = false;
}

/** Un control con lo mínimo para firmar (el Plan es lo único obligatorio). */
const hoja = (id: string) => ({
  cardId: id,
  treatmentPlanId: id,
  cardNumber: 3,
  visitDate: "2026-10-02",
  phaseKey: "ALIGNMENT",
  monthAt: 2,
  wireFromId: id,
  wireToId: id,
  photoSetId: id,
  soap: { s: "", o: "", a: "", p: "Control en 4 semanas" },
  hygiene: { plaquePct: null, gingivitis: null },
});

/** Cada acción que validaba con `.uuid()`, con una entrada válida en todo lo demás. */
const ACCIONES: Array<{ nombre: string; cargar: () => Promise<(i: unknown) => Promise<any>>; entrada: (id: string) => Record<string, unknown> }> = [
  { nombre: "signTreatmentCard", cargar: async () => (await import("../signTreatmentCard")).signTreatmentCard, entrada: hoja },
  { nombre: "saveTreatmentCardDraft", cargar: async () => (await import("../saveTreatmentCardDraft")).saveTreatmentCardDraft, entrada: hoja },
  {
    nombre: "addWireStep",
    cargar: async () => (await import("../addWireStep")).addWireStep,
    entrada: (id) => ({ treatmentPlanId: id, phase: "ALIGNMENT", material: "SS", shape: "ROUND", gauge: "0.014", archUpper: true, archLower: false, durationWeeks: 6 }),
  },
  { nombre: "confirmCollect", cargar: async () => (await import("../confirmCollect")).confirmCollect, entrada: (id) => ({ treatmentPlanId: id, installmentId: id, method: "efectivo" }) },
  {
    nombre: "updateFinancialPlan",
    cargar: async () => (await import("../updateFinancialPlan")).updateFinancialPlan,
    entrada: (id) => ({ treatmentPlanId: id, totalAmount: 30000, initialDownPayment: 5000, installmentCount: 12 }),
  },
  { nombre: "updateOrthoAppliances", cargar: async () => (await import("../updateOrthoAppliances")).updateOrthoAppliances, entrada: (id) => ({ treatmentPlanId: id, prescriptionNotes: "Roth .022" }) },
  {
    nombre: "createOrthoTAD",
    cargar: async () => (await import("../createOrthoTAD")).createOrthoTAD,
    entrada: (id) => ({ treatmentPlanId: id, brand: "DENTOS", size: "1.6x8", location: "Entre 13 y 14" }),
  },
  { nombre: "scheduleRetentionCheckups", cargar: async () => (await import("../scheduleRetentionCheckups")).scheduleRetentionCheckups, entrada: (id) => ({ treatmentPlanId: id }) },
  { nombre: "scheduleNpsTimeline", cargar: async () => (await import("../scheduleNpsTimeline")).scheduleNpsTimeline, entrada: (id) => ({ treatmentPlanId: id }) },
  { nombre: "scheduleG15Checkpoint", cargar: async () => (await import("../scheduleG15Checkpoint")).scheduleG15Checkpoint, entrada: (id) => ({ treatmentPlanId: id }) },
  { nombre: "createReferralCode", cargar: async () => (await import("../createReferralCode")).createReferralCode, entrada: (id) => ({ treatmentPlanId: id, code: "AMIGO" }) },
  { nombre: "selectQuoteScenario", cargar: async () => (await import("../selectQuoteScenario")).selectQuoteScenario, entrada: (id) => ({ treatmentPlanId: id, scenarioId: id }) },
  { nombre: "updateQuoteScenario", cargar: async () => (await import("../updateQuoteScenario")).updateQuoteScenario, entrada: (id) => ({ scenarioId: id, label: "Plan A" }) },
  { nombre: "sendSignAtHomeLink", cargar: async () => (await import("../sendSignAtHomeLink")).sendSignAtHomeLink, entrada: (id) => ({ treatmentPlanId: id, scenarioId: id }) },
  {
    nombre: "updateRetentionRegimenConfig",
    cargar: async () => (await import("../updateRetentionRegimenConfig")).updateRetentionRegimenConfig,
    entrada: (id) => ({ treatmentPlanId: id, regimenDescription: "Hawley de noche" }),
  },
  { nombre: "toggleRetentionPreSurvey", cargar: async () => (await import("../toggleRetentionPreSurvey")).toggleRetentionPreSurvey, entrada: (id) => ({ treatmentPlanId: id, enabled: true }) },
  { nombre: "updateNpsConfig", cargar: async () => (await import("../updateNpsConfig")).updateNpsConfig, entrada: (id) => ({ treatmentPlanId: id }) },
  { nombre: "recordNpsResponse", cargar: async () => (await import("../recordNpsResponse")).recordNpsResponse, entrada: (id) => ({ npsScheduleId: id, npsScore: 9 }) },
  {
    nombre: "createOrthoLabOrder",
    cargar: async () => (await import("../createOrthoLabOrder")).createOrthoLabOrder,
    entrada: (id) => ({ patientId: id, catalog: "Retenedor Hawley sup", description: "", lab: "", expectedDate: null }),
  },
];

/** La primera consulta que lleva el id: tiene que llevar también el clinicId de la sesión. */
function primeraConsultaCon(id: string): Llamada | undefined {
  return st.llamadas.find((l) => JSON.stringify(l.args ?? null).includes(id));
}

for (const a of ACCIONES) {
  for (const [tipo, id] of [["cuid (importado)", ID_BEVADENT], ["uuid", ID_UUID], ["de siembra", ID_SIEMBRA]] as const) {
    test(`${a.nombre}: un id ${tipo} pasa la validación y se busca con el clinicId de la sesión`, async () => {
      reset();
      const accion = await a.cargar();
      const r = await accion(a.entrada(id));
      assert.equal(r.ok, false, "con la base vacía la acción no encuentra el registro");
      assert.notEqual(r.error, "Identificador inválido");
      assert.doesNotMatch(String(r.error), /uuid/i);
      if (a.nombre === "createOrthoLabOrder") {
        assert.deepEqual(st.pacientes, [`${CLINICA}|${id}`], "el paciente se busca en la clínica de la sesión");
        return;
      }
      const primera = primeraConsultaCon(id);
      assert.ok(primera, `la acción no preguntó a la base por ${id}`);
      assert.ok(JSON.stringify(primera.args).includes(CLINICA), `${primera.donde} sin clinicId: ${JSON.stringify(primera.args)}`);
    });
  }

  test(`${a.nombre}: un id basura se rechaza sin preguntar a la base`, async () => {
    const accion = await a.cargar();
    for (const malo of BASURA) {
      reset();
      const r = await accion(a.entrada(malo));
      assert.equal(r.ok, false);
      assert.equal(r.error, "Identificador inválido", `aceptó ${JSON.stringify(malo)}`);
      assert.equal(st.llamadas.length, 0);
      assert.equal(st.pacientes.length, 0);
    }
  });
}

test("el caso de BEVADENT: firmar la hoja de control (id cuid) de un caso importado (id cuid)", async () => {
  reset();
  const HOJA = "cmu9z8y7x6w5v4u3t2s1r0qpo";
  st.respuestas.set("orthodonticTreatmentPlan.findFirst", (a) =>
    a.where.id === ID_BEVADENT && a.where.clinicId === CLINICA ? { id: ID_BEVADENT, clinicId: CLINICA, patientId: "cpacienteimportado0000001" } : null,
  );
  st.respuestas.set("orthoTreatmentCard.findFirst", (a) => (a.where.id === HOJA && a.where.treatmentPlanId === ID_BEVADENT ? { id: HOJA, status: "DRAFT" } : null));
  st.respuestas.set("orthoTreatmentCard.updateMany", () => ({ count: 1 }));
  st.respuestas.set("orthoTreatmentCard.update", (a) => ({ id: a.where.id }));
  st.pacienteVisible = true;
  const { signTreatmentCard } = await import("../signTreatmentCard");
  const r = await signTreatmentCard({ ...hoja(HOJA), treatmentPlanId: ID_BEVADENT, wireFromId: null, wireToId: null, photoSetId: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((r as { data: { cardId: string } }).data.cardId, HOJA);
  const plan = st.llamadas.find((l) => l.donde === "orthodonticTreatmentPlan.findFirst");
  assert.deepEqual((plan?.args as any).where, { id: ID_BEVADENT, clinicId: CLINICA, deletedAt: null });
  assert.deepEqual(st.pacientes, [`${CLINICA}|cpacienteimportado0000001`]);
  const firma = st.llamadas.find((l) => l.donde === "orthoTreatmentCard.updateMany");
  assert.deepEqual((firma?.args as any).where, { id: HOJA, treatmentPlanId: ID_BEVADENT, status: { not: "SIGNED" } });
});
