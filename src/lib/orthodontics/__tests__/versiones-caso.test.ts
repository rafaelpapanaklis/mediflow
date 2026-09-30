// ws1-t8 — REEVALUACIONES del caso: línea de tiempo, foto legible y «qué cambió». Puro.
// Correr: npm run test:orto-diagnostico
import { test } from "node:test";
import assert from "node:assert/strict";
import { etiquetaDeVersion, fechaDma, lineaDeTiempo, queCambio, validarMotivo, versionLegible } from "../versiones-caso";

const DX = {
  angleClassRight: "CLASS_II_DIV_1", angleClassLeft: "CLASS_I", overbiteMm: "5", overbitePercentage: 40, overjetMm: "6.5",
  midlineDeviationMm: null, crowdingUpperMm: "4", crowdingLowerMm: null, crossbite: false, crossbiteDetails: null,
  openBite: false, openBiteDetails: null, etiologySkeletal: true, etiologyDental: false, etiologyFunctional: false,
  etiologyNotes: null, habits: [], habitsDescription: null, dentalPhase: "PERMANENT", skeletalPattern: "DOLICOFACIAL",
  tmjPainPresent: false, tmjClickingPresent: false, tmjNotes: null, clinicalSummary: "Clase II división 1 con perfil convexo y overjet aumentado.",
};
const PLAN = { technique: "METAL_BRACKETS", estimatedDurationMonths: 24, anchorageType: "MAXIMUM", extractionsRequired: true, extractionsTeethFdi: [14, 24], retentionPlanText: "Retenedor fijo inferior" };

test("línea de tiempo: inicial, reevaluaciones y la actual al final", () => {
  const sola = lineaDeTiempo([], "2026-01-10T16:00:00.000Z");
  assert.deepEqual(sola.map((p) => [p.etiqueta, p.actual]), [["Inicial", true]]);
  const l = lineaDeTiempo(
    [
      { numero: 1, iniciadaEl: "2026-06-01T16:00:00.000Z", cerradaEl: "2026-09-29T16:00:00.000Z", motivo: "Control radiográfico" },
      { numero: 0, iniciadaEl: "2026-01-10T00:00:00.000Z", cerradaEl: "2026-06-01T16:00:00.000Z", motivo: "Cambio de anclaje" },
    ],
    "2026-01-10T00:00:00.000Z",
  );
  assert.deepEqual(l.map((p) => p.etiqueta), ["Inicial", "Reevaluación 1", "Reevaluación 2"]);
  assert.equal(l[0]!.motivo, null);
  assert.equal(l[1]!.motivo, "Cambio de anclaje", "la reevaluación 1 la abrió el motivo guardado en la versión 0");
  assert.equal(l[2]!.desde, "2026-09-29T16:00:00.000Z");
  assert.equal(l[2]!.actual, true);
  assert.equal(fechaDma(l[1]!.desde), "01/06/2026");
  assert.equal(etiquetaDeVersion(0), "Inicial");
});

test("motivo obligatorio y acotado", () => {
  assert.equal(validarMotivo("  ").ok, false);
  assert.equal(validarMotivo("abc").ok, false);
  assert.deepEqual(validarMotivo("  Cambio   de anclaje "), { ok: true, motivo: "Cambio de anclaje" });
  assert.equal(validarMotivo("x".repeat(501)).ok, false);
});

test("foto legible con la misma redacción que la ficha, y qué cambió", () => {
  const a = versionLegible({ diagnostico: DX, diagnosticoDetalle: null, plan: PLAN, planDetalle: null });
  assert.ok(a.diagnostico.find((s) => s.clave === "cefalometria")!.lineas.some((l) => l.valor === "Dolicofacial"));
  assert.equal(a.plan[0]!.etiqueta, "Técnica");
  assert.ok(a.plan.some((l) => l.clave === "retencion"));
  const b = versionLegible({
    diagnostico: { ...DX, overjetMm: "3" },
    diagnosticoDetalle: { facial: { cierreLabial: "competente" } },
    plan: { ...PLAN, estimatedDurationMonths: 30 },
    planDetalle: null,
  });
  const c = queCambio(a, b);
  const por = (et: string) => c.find((x) => x.etiqueta === et);
  assert.equal(por("Overjet")!.antes, "6.5 mm · aumentado");
  assert.equal(por("Overjet")!.despues, "3 mm · normal");
  assert.equal(por("Cierre labial")!.antes, null);
  assert.equal(por("Cierre labial")!.parte, "Diagnóstico");
  assert.equal(por("Duración estimada")!.parte, "Plan de tratamiento");
  assert.deepEqual(queCambio(a, a), []);
  // La línea media única que pasa a superior/inferior no es «un dato que se quitó».
  const conLinea = versionLegible({ diagnostico: { ...DX, midlineDeviationMm: "2" }, diagnosticoDetalle: null, plan: PLAN, planDetalle: null });
  const detallada = versionLegible({
    diagnostico: { ...DX, midlineDeviationMm: "2" },
    diagnosticoDetalle: { oclusal: { lineaMediaInferior: "izquierda", lineaMediaInferiorMm: 2 } },
    plan: PLAN,
    planDetalle: null,
  });
  const cl = queCambio(conLinea, detallada);
  assert.ok(!cl.some((x) => x.etiqueta === "Línea media" && x.despues === null));
  assert.ok(cl.some((x) => x.etiqueta === "Línea media inferior" && x.antes === null));
});

test("fechas en la zona de la clínica, no en UTC (6 p.m. de México del 29 no es el 30)", () => {
  assert.equal(fechaDma("2026-09-30T00:17:00.000Z"), "29/09/2026");
  assert.equal(fechaDma("2026-09-30T00:17:00.000Z", "America/Mexico_City"), "29/09/2026");
  assert.equal(fechaDma("2026-09-30T00:17:00.000Z", "Europe/Madrid"), "30/09/2026");
  assert.equal(fechaDma("2026-09-29"), "29/09/2026", "un día suelto no se corre");
  assert.equal(fechaDma("2026-09-30T00:17:00.000Z", "Zona/Inventada"), "29/09/2026", "zona inválida → la de México");
  assert.equal(fechaDma(null), "");
});
