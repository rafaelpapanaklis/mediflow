/**
 * ws1-t12 — guardar el plan de tratamiento completo (`aplicarPlanDetalle`): clínica de la sesión, la aparatología
 * tiene que cuadrar con la técnica, el total de alineadores es UN dato (el seguimiento manda), y las columnas de
 * siempre se DERIVAN del plan (TADs, anclaje general, prescripción, extracciones) en la misma transacción.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/plan-detalle-guardar.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { planDetalleVacio, type PlanDetalle } from "../plan-detalle";

const state = {
  consultas: [] as Array<Record<string, unknown>>,
  columnas: { estimatedDurationMonths: 18, extractionsTeethFdi: [] as number[], extractionsRequired: false, tadsRequired: false, anchorageType: "MODERATE", technique: "METAL_BRACKETS", prescriptionSlot: null as string | null, bondingType: null as string | null } as Record<string, unknown> | null,
  tads: 0,
  aligner: null as { id: string; totalTrays: number; currentTray: number } | null,
  escrituras: [] as Array<{ tabla: string; donde: Record<string, unknown>; datos: Record<string, unknown> }>,
  guardado: null as PlanDetalle | null,
  movimientos: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: { findFirst: async (a: { where: Record<string, unknown> }) => { state.consultas.push(a.where); return state.columnas; } },
      orthoTAD: { count: async () => state.tads },
      orthodonticAligner: { findFirst: async () => state.aligner },
    },
  },
});
mock.module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoDelPaciente: async (m: Record<string, unknown>) => { state.movimientos.push(m); } } });
mock.module("../plan-detalle-db", {
  namedExports: {
    actualizarPlanDetalle: async (
      clinicId: string,
      planId: string,
      transformar: (a: PlanDetalle) => PlanDetalle,
      alTerminar?: (tx: unknown, antes: PlanDetalle, despues: PlanDetalle) => Promise<void>,
    ) => {
      assert.equal(clinicId, "clinic-1");
      const antes = planDetalleVacio();
      const despues = transformar(antes);
      state.guardado = despues;
      const tx = {
        orthodonticAligner: { updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { state.escrituras.push({ tabla: "aligner", donde: a.where, datos: a.data }); } },
        orthodonticTreatmentPlan: { updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { state.escrituras.push({ tabla: "plan", donde: a.where, datos: a.data }); } },
      };
      if (alTerminar) await alTerminar(tx, antes, despues);
      return { ok: true, antes, despues };
    },
  },
});

// Cargado en diferido: los mocks de arriba tienen que estar puestos antes de importar el módulo.
const cargar = () => import("../plan-detalle-guardar");
const aplicarPlanDetalle: typeof import("../plan-detalle-guardar").aplicarPlanDetalle = async (a) => (await cargar()).aplicarPlanDetalle(a);
const marcarExtraccionesDesdeLaHoja: typeof import("../plan-detalle-guardar").marcarExtraccionesDesdeLaHoja = async (a) => (await cargar()).marcarExtraccionesDesdeLaHoja(a);

const CTX = { clinicId: "clinic-1", userId: "user-1" };
const plan = (extra: Partial<PlanDetalle> = {}): PlanDetalle => ({ ...planDetalleVacio(), ...extra });
const args = (p: PlanDetalle, extra: Record<string, unknown> = {}) => ({ ctx: CTX, treatmentPlanId: "caso-1", patientId: "pac-1", plan: p, ...extra });

function reiniciar() {
  state.consultas = [];
  state.columnas = { estimatedDurationMonths: 18, extractionsTeethFdi: [], extractionsRequired: false, tadsRequired: false, anchorageType: "MODERATE", technique: "METAL_BRACKETS", prescriptionSlot: null, bondingType: null };
  state.tads = 0;
  state.aligner = null;
  state.escrituras = [];
  state.guardado = null;
  state.movimientos = [];
}

test("todo sale de la clínica y del paciente de la sesión; sin clínica no se consulta ni se escribe nada", async () => {
  reiniciar();
  const r = await aplicarPlanDetalle({ ...args(plan({ controlesPrevistos: 12 })), ctx: { clinicId: "", userId: "u" } });
  assert.equal(r.ok, false);
  assert.equal(state.consultas.length, 0);
  assert.equal(state.guardado, null);
  const ok = await aplicarPlanDetalle(args(plan({ controlesPrevistos: 12 })));
  assert.equal(ok.ok, true);
  assert.deepEqual(state.consultas[0], { id: "caso-1", clinicId: "clinic-1", patientId: "pac-1", deletedAt: null });
});

test("la aparatología tiene que cuadrar con la técnica: alineadores con brackets no se guardan", async () => {
  reiniciar();
  const r = await aplicarPlanDetalle(args(plan({ alineadores: ["Invisalign lite dual"] })));
  assert.equal(r.ok, false);
  if (r.ok === false) assert.match(r.error, /Alineadores: no aplican/);
  assert.equal(state.guardado, null, "no escribió nada");
  reiniciar();
  state.columnas!.technique = "CLEAR_ALIGNERS";
  const b = await aplicarPlanDetalle(args(plan({ brackets: ["MBT"] })));
  assert.equal(b.ok, false);
  reiniciar();
  state.columnas!.technique = "HYBRID";
  assert.equal((await aplicarPlanDetalle(args(plan({ brackets: ["MBT"], alineadores: ["Invisalign first"] })))).ok, true);
});

test("«Requiere TADs» se DERIVA de Aditamentos y de los TAD registrados (se enciende y se apaga)", async () => {
  reiniciar();
  await aplicarPlanDetalle(args(plan({ aditamentos: ["Microtornillos"] })));
  assert.equal(state.escrituras.find((e) => e.tabla === "plan")!.datos.tadsRequired, true);
  reiniciar();
  state.columnas!.tadsRequired = true;
  await aplicarPlanDetalle(args(plan({ aditamentos: ["Topes"] })));
  assert.equal(state.escrituras.find((e) => e.tabla === "plan")!.datos.tadsRequired, false, "sin microtornillos ni TAD, se apaga");
  reiniciar();
  state.columnas!.tadsRequired = true;
  state.tads = 2;
  await aplicarPlanDetalle(args(plan({ aditamentos: [] })));
  assert.equal(state.escrituras.find((e) => e.tabla === "plan"), undefined, "con TAD registrados sigue en «sí»: no hay nada que cambiar");
});

test("el anclaje general y las extracciones se derivan del plan; la prescripción y el cementado NO se escriben en el caso", async () => {
  reiniciar();
  await aplicarPlanDetalle(
    args(plan({ anclajeSuperior: "MAXIMO", anclajeInferior: "MEDIO", tubosSuperiores: "Roth", cementacionSuperiorAnterior: "Indirecto" }), { extraccionesIndicadas: [24, 14], duracionMeses: 20 }),
  );
  const d = state.escrituras.find((e) => e.tabla === "plan")!.datos;
  assert.equal(d.anchorageType, "COMPOUND", "distintos por arcada = «ver por arcada»");
  // La fuente de la prescripción es el plan mismo: nada se deduce ni se guarda encima en silencio (ws1-t12).
  assert.equal("prescriptionSlot" in d, false);
  assert.equal("bondingType" in d, false);
  assert.deepEqual(d.extractionsTeethFdi, [14, 24]);
  assert.equal(d.extractionsRequired, true);
  assert.equal(d.estimatedDurationMonths, 20);
  assert.deepEqual(state.escrituras.find((e) => e.tabla === "plan")!.donde, { id: "caso-1", clinicId: "clinic-1" }, "la escritura también filtra por clínica");
});

test("alineadores totales: UN dato. Con seguimiento manda el seguimiento y aquí queda null", async () => {
  reiniciar();
  state.aligner = { id: "al-1", totalTrays: 20, currentTray: 8 };
  const r = await aplicarPlanDetalle(args(plan({ alineadoresTotales: 26 })));
  assert.equal(r.ok, true);
  assert.equal(state.guardado!.alineadoresTotales, null, "no se duplica en el plan");
  const e = state.escrituras.find((x) => x.tabla === "aligner")!;
  assert.deepEqual(e.datos, { totalTrays: 26 });
  assert.deepEqual(e.donde, { id: "al-1", clinicId: "clinic-1" });

  reiniciar();
  state.aligner = { id: "al-1", totalTrays: 20, currentTray: 8 };
  const menor = await aplicarPlanDetalle(args(plan({ alineadoresTotales: 6 })));
  assert.equal(menor.ok, false);
  if (menor.ok === false) assert.match(menor.error, /va en el alineador 8/);
  const vacio = await aplicarPlanDetalle(args(plan({ alineadoresTotales: null })));
  assert.equal(vacio.ok, false);
  assert.equal(state.escrituras.length, 0);

  reiniciar();
  await aplicarPlanDetalle(args(plan({ alineadoresTotales: 24 })));
  assert.equal(state.guardado!.alineadoresTotales, 24, "sin seguimiento, el total vive en el plan");
  assert.equal(state.escrituras.find((x) => x.tabla === "aligner"), undefined);
});

test("Movimientos: qué secciones cambiaron, sin datos clínicos en la frase, con el paciente como campo propio", async () => {
  reiniciar();
  await aplicarPlanDetalle(args(plan({ controlesPrevistos: 18, aditamentos: ["Microtornillos"], tubosSuperiores: "Roth" })));
  assert.equal(state.movimientos.length, 1);
  const m = state.movimientos[0]!;
  assert.equal(m.patientId, "pac-1");
  assert.equal(m.clinicId, "clinic-1");
  assert.equal(m.entityType, "orthodontic-plan");
  assert.match(String(m.texto), /^Actualizó el plan de tratamiento de ortodoncia: /);
  assert.ok(!/18|Roth|Microtornillos/.test(String(m.texto)));
  reiniciar();
  await aplicarPlanDetalle(args(plan(), { creado: false }));
  assert.equal(state.movimientos.length, 0, "sin cambios no hay movimiento");
  reiniciar();
  await aplicarPlanDetalle(args(plan({ controlesPrevistos: 12 }), { creado: true }));
  assert.match(String(state.movimientos[0]!.texto), /^Completó el plan de tratamiento/);
});

test("extracciones desde la hoja: solo cuentan las que el plan tiene indicadas", async () => {
  reiniciar();
  state.columnas = { extractionsTeethFdi: [14, 24] };
  const r = await marcarExtraccionesDesdeLaHoja({ ctx: CTX, treatmentPlanId: "caso-1", patientId: "pac-1", piezas: [24, 36, 99] });
  assert.deepEqual(r, { ok: true, marcadas: [24] });
  assert.deepEqual(state.guardado!.extraccionesRealizadas, [24]);
  assert.equal(state.movimientos.length, 1);
  reiniciar();
  state.columnas = { extractionsTeethFdi: [14] };
  const nada = await marcarExtraccionesDesdeLaHoja({ ctx: CTX, treatmentPlanId: "caso-1", patientId: "pac-1", piezas: [36] });
  assert.deepEqual(nada, { ok: true, marcadas: [] });
  assert.equal(state.guardado, null);
});

test("guardado único: lo que pide `enLaTransaccion` corre DENTRO de la transacción del plan, con el mismo `tx`", async () => {
  reiniciar();
  let recibido: unknown = null;
  const r = await aplicarPlanDetalle(args(plan({ controlesPrevistos: 12 }), { enLaTransaccion: async (tx: unknown) => { recibido = tx; } }));
  assert.equal(r.ok, true);
  assert.ok(recibido && typeof recibido === "object", "recibió la transacción");
  assert.ok("orthodonticTreatmentPlan" in (recibido as object), "es el mismo cliente transaccional que usa el plan");
});

test("guardado único: si lo de `enLaTransaccion` falla, el error sube (la transacción entera se deshace) y no se registra el movimiento", async () => {
  reiniciar();
  await assert.rejects(
    aplicarPlanDetalle(args(plan({ controlesPrevistos: 12 }), { enLaTransaccion: async () => { throw new Error("falló el diagnóstico"); } })),
    /falló el diagnóstico/,
  );
  assert.equal(state.movimientos.length, 0, "sin transacción confirmada no hay movimiento");
});

test("(ws1-t12) si esta llamada trae la duración, la marca «sin capturar» de la duración se cae; sin duración se conserva", async () => {
  reiniciar();
  await aplicarPlanDetalle(args(plan({ sinCapturar: ["duracion", "objetivos"] }), { duracionMeses: 24 }));
  assert.deepEqual(state.guardado!.sinCapturar, ["objetivos"], "la duración ya se capturó; los objetivos no");
  assert.equal(state.escrituras.find((e) => e.tabla === "plan")!.datos.estimatedDurationMonths, 24);
  reiniciar();
  await aplicarPlanDetalle(args(plan({ sinCapturar: ["duracion", "objetivos"] })));
  assert.deepEqual(state.guardado!.sinCapturar, ["duracion", "objetivos"]);
  assert.equal("estimatedDurationMonths" in (state.escrituras.find((e) => e.tabla === "plan")?.datos ?? {}), false, "sin duración no se toca la columna");
});

test("(ws1-t12) un plan con solo marcas se registra sin fila de movimientos (no hay dato clínico que decir)", async () => {
  reiniciar();
  await aplicarPlanDetalle(args(plan({ sinCapturar: ["duracion", "objetivos"] }), { creado: true }));
  assert.equal(state.movimientos.length, 0);
});
