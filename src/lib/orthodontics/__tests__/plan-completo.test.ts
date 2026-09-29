/**
 * ws1-t12 — el plan completo como objeto: `leerPlanCompleto` / `guardarPlanCompleto` / `vistaDeUnPlanCompleto`, el
 * enganche que ws1-t8 usa para las REEVALUACIONES (la ventana de 2 pasos precargada + guardar).
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/plan-completo.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { planDetalleVacio, type PlanDetalle } from "../plan-detalle";

const state = {
  fila: null as Record<string, unknown> | null,
  wheres: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ donde: Record<string, unknown>; datos: Record<string, unknown> }>,
  personas: null as string | null,
  aplicado: [] as Array<Record<string, unknown>>,
  nombres: [] as Array<string | null>,
  movimientos: [] as Array<Record<string, unknown>>,
  detalle: null as PlanDetalle | null,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findFirst: async (a: { where: Record<string, unknown> }) => { state.wheres.push(a.where); return state.fila; },
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { state.updates.push({ donde: a.where, datos: a.data }); return { count: 1 }; },
      },
    },
  },
});
mock.module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoDelPaciente: async (m: Record<string, unknown>) => { state.movimientos.push(m); } } });
mock.module("../tecnicas-de-la-clinica-db", {
  namedExports: {
    cargarNombreDeTecnica: async () => "Brackets de zafiro",
    guardarNombreDeTecnicaDelCaso: async (_c: string, _p: string, n: string | null) => { state.nombres.push(n); return true; },
  },
});
mock.module("../plan-detalle-db", { namedExports: { cargarPlanDetalle: async () => state.detalle } });
mock.module("../plan-detalle-guardar", { namedExports: { aplicarPlanDetalle: async (a: Record<string, unknown>) => { state.aplicado.push(a); return { ok: true, cambios: { campos: [], cambios: {}, secciones: [] } }; } } });
mock.module("../validar-personas-del-caso-db", { namedExports: { validarPersonasDelCaso: async () => state.personas } });

const lib = () => import("../plan-completo");

function reiniciar() {
  state.fila = { patientId: "pac-1", technique: "CERAMIC_BRACKETS", estimatedDurationMonths: 18, treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL", retentionPlanText: "Fijo inferior", iprRequired: true, extractionsTeethFdi: [14, 24], treatingDoctorId: "doc-1", responsibleGuardianId: null };
  state.wheres = [];
  state.updates = [];
  state.personas = null;
  state.aplicado = [];
  state.nombres = [];
  state.movimientos = [];
  state.detalle = { ...planDetalleVacio(), controlesPrevistos: 18, brackets: ["MBT"] };
}

test("leerPlanCompleto devuelve el plan como UN objeto y filtra por la clínica de la sesión", async () => {
  reiniciar();
  const { leerPlanCompleto } = await lib();
  const p = await leerPlanCompleto("clinic-1", "caso-1");
  assert.deepEqual(state.wheres[0], { id: "caso-1", clinicId: "clinic-1", deletedAt: null });
  assert.equal(p!.tecnica, "CERAMIC_BRACKETS");
  assert.equal(p!.tecnicaNombrePropio, "Brackets de zafiro");
  assert.equal(p!.doctorId, "doc-1");
  assert.deepEqual(p!.extraccionesIndicadas, [14, 24]);
  assert.equal(p!.detalle.controlesPrevistos, 18);
  // El objeto es serializable (una versión archivada lo guarda tal cual).
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  assert.equal(await leerPlanCompleto("", "caso-1"), null, "sin clínica no se consulta");
  state.fila = null;
  assert.equal(await leerPlanCompleto("clinic-1", "otro"), null);
});

test("guardarPlanCompleto: valida el plan, comprueba doctor y responsable, y guarda columnas + plan con la clínica de la sesión", async () => {
  reiniciar();
  const { leerPlanCompleto, guardarPlanCompleto } = await lib();
  const actual = (await leerPlanCompleto("clinic-1", "caso-1"))!;
  const r = await guardarPlanCompleto({
    ctx: { clinicId: "clinic-1", userId: "user-1" },
    plan: { ...actual, retencion: "Fijo inferior y removible", detalle: { controlesPrevistos: 20, brackets: ["MBT"] } },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(state.updates[0]!.donde, { id: "caso-1", clinicId: "clinic-1" });
  assert.equal(state.updates[0]!.datos.retentionPlanText, "Fijo inferior y removible");
  assert.deepEqual(state.nombres, ["Brackets de zafiro"]);
  assert.equal(state.aplicado.length, 1);
  assert.equal(state.aplicado[0]!.duracionMeses, 18);
  assert.equal((state.aplicado[0]!.plan as PlanDetalle).controlesPrevistos, 20);
});

test("guardarPlanCompleto rechaza lo que no sirve sin escribir nada: plan inválido, duración fuera de rango, doctor de otra clínica", async () => {
  reiniciar();
  const { leerPlanCompleto, guardarPlanCompleto } = await lib();
  const actual = (await leerPlanCompleto("clinic-1", "caso-1"))!;
  const ctx = { clinicId: "clinic-1", userId: "user-1" };
  const mal = await guardarPlanCompleto({ ctx, plan: { ...actual, detalle: { controlesPrevistos: 0 } } });
  assert.equal(mal.ok, false);
  const corto = await guardarPlanCompleto({ ctx, plan: { ...actual, duracionMeses: 2 } });
  assert.equal(corto.ok, false);
  state.personas = "Ese doctor no es de tu clínica.";
  const ajeno = await guardarPlanCompleto({ ctx, plan: { ...actual, doctorId: "doc-de-otra-clinica" } });
  assert.deepEqual(ajeno, { ok: false, error: "Ese doctor no es de tu clínica." });
  const sin = await guardarPlanCompleto({ ctx: { clinicId: "", userId: "u" }, plan: actual });
  assert.equal(sin.ok, false);
  assert.equal(state.updates.length, 0, "nada se escribió");
  assert.equal(state.aplicado.length, 0);
});

test("cambiar la técnica o el doctor deja su movimiento (con el paciente)", async () => {
  reiniciar();
  const { leerPlanCompleto, guardarPlanCompleto } = await lib();
  const actual = (await leerPlanCompleto("clinic-1", "caso-1"))!;
  await guardarPlanCompleto({ ctx: { clinicId: "clinic-1", userId: "user-1" }, plan: { ...actual, tecnica: "HYBRID", detalle: actual.detalle } });
  assert.equal(state.movimientos.length, 1);
  assert.equal(state.movimientos[0]!.patientId, "pac-1");
  assert.deepEqual(state.movimientos[0]!.campos, ["technique"]);
});

test("vistaDeUnPlanCompleto arma lo que la ventana pide para abrir PRECARGADA (reevaluación)", async () => {
  reiniciar();
  const { leerPlanCompleto, vistaDeUnPlanCompleto } = await lib();
  const p = (await leerPlanCompleto("clinic-1", "caso-1"))!;
  const v = vistaDeUnPlanCompleto(p, { tads: 2, billingMode: "PAGO_POR_CONTROL" });
  assert.equal(v.treatmentPlanId, "caso-1");
  assert.equal(v.caso.tecnicaVisible, "Brackets de zafiro");
  assert.equal(v.caso.iprRequerido, true);
  assert.equal(v.caso.billingMode, "PAGO_POR_CONTROL");
  assert.equal(v.tads, 2);
  assert.deepEqual(v.extraccionesIndicadas, [14, 24]);
  assert.equal(v.detalle.controlesPrevistos, 18);
  assert.equal(v.columna, true);
});
