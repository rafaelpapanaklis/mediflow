// ws1-t12 — «Plan de tratamiento» completo del caso (como Dentalink): validación, listas por clínica,
// resumen legible, qué cambió, progreso «Control X de N», estimado por controles, reevaluación radiográfica y
// procedimientos que el plan propone. Puro.
// Correr: npm run test:orto-plan-detalle
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANCLAJES,
  OPCIONES_DE_EJEMPLO,
  LISTAS_DEL_PLAN,
  aparatologiaElegida,
  anclajeGeneralDerivado,
  cambiosDelPlan,
  estimadoPorControles,
  extraccionesPendientes,
  faltanDeEjemplo,
  fechaIsoValida,
  leerFdi,
  lineasDelPlan,
  marcarExtraccionesRealizadas,
  normalizarOpciones,
  normalizarPlanDetalle,
  opcionesParaElegir,
  ordenarConSugeridosPrimero,
  planDetalleVacio,
  planPideTads,
  procedimientosSugeridos,
  procedimientosQueFaltanEnElCatalogo,
  avisoDeProcedimientoFaltante,
  progresoDeControles,
  reevaluacionesPendientes,
  restaurarDeEjemplo,
  sumarMeses,
  textoControlQueSigue,
  textoControlesHechos,
  textoDeMovimientoDelPlan,
  textoDelEstimado,
  validarContraOpciones,
  validarOpciones,
  validarPlanDetalle,
  esPlanDetalleVacio,
  esFdiValido,
  type PlanDetalle,
} from "../plan-detalle";

const completo = (extra: Partial<PlanDetalle> = {}): PlanDetalle => ({ ...planDetalleVacio(), ...extra });

// ─── Las listas de ejemplo son las de Dentalink ─────────────────────────

test("las listas de ejemplo traen lo de Dentalink", () => {
  assert.deepEqual(OPCIONES_DE_EJEMPLO.aditamentos, ["Microtornillos", "Miniplacas", "IZG", "Bucal Shelf", "Barra Palatina", "SPP inferior", "Topes"]);
  assert.equal(OPCIONES_DE_EJEMPLO.brackets.length, 11);
  assert.ok(OPCIONES_DE_EJEMPLO.brackets.includes("Inovation Roth"));
  assert.ok(OPCIONES_DE_EJEMPLO.brackets.includes("Mini implante"));
  assert.equal(OPCIONES_DE_EJEMPLO.alineadores.length, 8);
  assert.ok(OPCIONES_DE_EJEMPLO.alineadores.includes("Invisalign Vivera"));
  assert.equal(OPCIONES_DE_EJEMPLO.placas.length, 8);
  assert.ok(OPCIONES_DE_EJEMPLO.placas.includes("Disyuntor Moon"));
  assert.ok(OPCIONES_DE_EJEMPLO.prescripciones.includes("Roth") && OPCIONES_DE_EJEMPLO.prescripciones.includes("MBT"));
  assert.deepEqual(OPCIONES_DE_EJEMPLO.cementaciones, ["Corona clínica"]);
  assert.deepEqual(
    ANCLAJES.map((a) => a.label),
    ["Absoluto", "Máximo", "Medio", "Mínimo", "Mínimo absoluto"],
  );
});

test("normalizarOpciones: sin nada siembra las de ejemplo; una lista guardada vacía se respeta", () => {
  const sembradas = normalizarOpciones(null);
  for (const l of LISTAS_DEL_PLAN) {
    assert.equal(sembradas[l].length, OPCIONES_DE_EJEMPLO[l].length);
    assert.ok(sembradas[l].every((o) => o.activa));
  }
  const propia = normalizarOpciones({ brackets: [], aditamentos: [{ id: "x1", nombre: "  Tornillo   propio ", activa: true }] });
  assert.deepEqual(propia.brackets, []);
  assert.equal(propia.aditamentos[0]!.nombre, "Tornillo propio");
  assert.equal(propia.placas.length, OPCIONES_DE_EJEMPLO.placas.length, "las listas que faltan se siembran");
});

test("normalizarOpciones descarta vacías y repetidas (sin mirar mayúsculas ni acentos) y arregla ids", () => {
  const l = normalizarOpciones({
    placas: [
      { id: "a", nombre: "Placa Hawley", activa: true },
      { id: "a", nombre: "PLACA HAWLEY", activa: true },
      { id: "b", nombre: "   ", activa: true },
      { id: "c", nombre: "Placa Ésix", activa: false },
      { id: "!!!", nombre: "Placa Esix", activa: true },
    ],
  }).placas;
  assert.deepEqual(l.map((o) => o.nombre), ["Placa Hawley", "Placa Ésix"]);
  assert.equal(l[1]!.activa, false);
  assert.equal(new Set(l.map((o) => o.id)).size, l.length);
});

test("validarOpciones: nombre vacío y repetido dicen en qué lista", () => {
  assert.match(validarOpciones({ brackets: [{ nombre: " " }] }) ?? "", /Brackets.*nombre/);
  assert.match(validarOpciones({ placas: [{ nombre: "Hawley" }, { nombre: "hawley" }] }) ?? "", /Placas.*repetida/);
  assert.equal(validarOpciones({ placas: [{ nombre: "Hawley" }, { nombre: "Essix" }] }), null);
});

test("restaurar y faltanDeEjemplo: reactiva las quitadas y conserva las propias", () => {
  const l = normalizarOpciones({
    aditamentos: [
      { id: "d-microtornillos", nombre: "Microtornillos", activa: false },
      { id: "c-1", nombre: "Propio", activa: true },
    ],
  }).aditamentos;
  assert.equal(faltanDeEjemplo("aditamentos", l), true);
  const r = restaurarDeEjemplo("aditamentos", l);
  assert.equal(faltanDeEjemplo("aditamentos", r), false);
  assert.ok(r.some((o) => o.nombre === "Propio"));
  assert.equal(r.find((o) => o.nombre === "Microtornillos")!.activa, true);
  assert.equal(r.length, OPCIONES_DE_EJEMPLO.aditamentos.length + 1);
});

test("opcionesParaElegir: lo ya elegido que la clínica quitó sigue saliendo, marcado como quitado", () => {
  const lista = normalizarOpciones({ brackets: [{ id: "a", nombre: "Damon", activa: true }, { id: "b", nombre: "MBT", activa: false }] }).brackets;
  assert.deepEqual(opcionesParaElegir(lista, ["MBT", "Damon"]), [
    { nombre: "Damon", quitada: false },
    { nombre: "MBT", quitada: true },
  ]);
  assert.deepEqual(opcionesParaElegir(lista, []), [{ nombre: "Damon", quitada: false }]);
});

// ─── Validación del plan ────────────────────────────────────────────────

test("validarPlanDetalle acepta un plan completo de Dentalink", () => {
  const r = validarPlanDetalle({
    controlesPrevistos: 18,
    alineadoresTotales: "24",
    anclajeSuperior: "MAXIMO",
    anclajeInferior: "MEDIO",
    aditamentos: ["Microtornillos", "Barra Palatina"],
    extraccionesRealizadas: [24, 14],
    controlRadiografico: ["TELE", "PANORAMICA"],
    periodicidadMeses: 12,
    reevaluacion: "2027-03-12",
    brackets: ["Inovation Roth"],
    alineadores: [],
    placas: ["Disyuntor Moon"],
    tubosSuperiores: "Roth",
    tubosInferiores: "Roth",
    bandasSuperiores: "MBT",
    bandasInferiores: "MBT",
    cementacionSuperiorAnterior: "Corona clínica",
    interconsultas: "con odontología general\npara exodoncia de premolares",
  });
  assert.ok(r.ok);
  assert.equal(r.plan.controlesPrevistos, 18);
  assert.equal(r.plan.alineadoresTotales, 24);
  assert.deepEqual(r.plan.extraccionesRealizadas, [14, 24], "en orden FDI");
  assert.deepEqual(r.plan.controlRadiografico, ["PANORAMICA", "TELE"], "en el orden de siempre");
  assert.equal(r.plan.interconsultas, "con odontología general\npara exodoncia de premolares", "conserva los saltos de línea");
  assert.equal(r.plan.tubosInferiores, "Roth");
});

test("validarPlanDetalle rechaza lo que no cabe, con su mensaje", () => {
  const malo = (raw: unknown) => {
    const r = validarPlanDetalle(raw);
    assert.equal(r.ok, false);
    return r.ok === false ? r.error : "";
  };
  assert.match(malo({ controlesPrevistos: 0 }), /Controles previstos/);
  assert.match(malo({ controlesPrevistos: 121 }), /Controles previstos/);
  assert.match(malo({ controlesPrevistos: 2.5 }), /Controles previstos/);
  assert.match(malo({ alineadoresTotales: -1 }), /Alineadores/);
  assert.match(malo({ periodicidadMeses: 61 }), /Periodicidad/);
  assert.match(malo({ anclajeSuperior: "ENORME" }), /Anclaje superior/);
  assert.match(malo({ anclajeInferior: 3 }), /Anclaje inferior/);
  assert.match(malo({ reevaluacion: "2027-02-31" }), /fecha de reevaluación/);
  assert.match(malo({ reevaluacion: "12/03/2027" }), /fecha de reevaluación/);
  assert.match(malo({ controlRadiografico: ["RESONANCIA"] }), /Control radiográfico/);
  assert.match(malo({ extraccionesRealizadas: [19] }), /FDI/);
  assert.match(malo({ extraccionesRealizadas: [56] }), /FDI/);
  assert.match(malo({ aditamentos: "Microtornillos" }), /Aditamentos/);
  assert.match(malo({ brackets: ["x".repeat(81)] }), /Brackets/);
  assert.match(malo({ tubosSuperiores: 7 }), /Tubos superiores/);
  assert.match(malo({ interconsultas: "x".repeat(1001) }), /Interconsultas/);
  assert.match(malo([]), /formato/);
  assert.match(malo("texto"), /formato/);
});

test("validarPlanDetalle: vacío o null es un plan vacío; los ausentes quedan vacíos", () => {
  for (const v of [null, undefined, {}]) {
    const r = validarPlanDetalle(v);
    assert.ok(r.ok === true && esPlanDetalleVacio(r.plan));
  }
});

test("normalizarPlanDetalle nunca lanza y descarta lo que no sirve", () => {
  for (const basura of [null, undefined, 7, "x", [], { controlesPrevistos: "abc", aditamentos: 3, anclajeSuperior: "X", reevaluacion: "ayer", extraccionesRealizadas: [11, 99, "14"] }]) {
    const p = normalizarPlanDetalle(basura);
    assert.equal(p.controlesPrevistos, null);
    assert.deepEqual(p.aditamentos, []);
    assert.equal(p.anclajeSuperior, null);
    assert.equal(p.reevaluacion, null);
  }
  assert.deepEqual(normalizarPlanDetalle({ extraccionesRealizadas: [11, 99, "14"] }).extraccionesRealizadas, [11]);
  const dup = normalizarPlanDetalle({ aditamentos: ["Topes", " topes ", "IZG", ""] });
  assert.deepEqual(dup.aditamentos, ["Topes", "IZG"]);
});

test("validarContraOpciones: una opción quitada no se agrega, pero la que el caso ya tenía se conserva", () => {
  const opciones = normalizarOpciones({
    aditamentos: [{ id: "a", nombre: "Microtornillos", activa: true }, { id: "b", nombre: "Topes", activa: false }],
    prescripciones: [{ id: "c", nombre: "Roth", activa: true }, { id: "d", nombre: "MBT", activa: false }],
  });
  const previo = completo({ aditamentos: ["Topes"], tubosSuperiores: "MBT" });
  // conserva lo que ya tenía
  assert.equal(validarContraOpciones(completo({ aditamentos: ["Topes", "Microtornillos"], tubosSuperiores: "MBT" }), previo, opciones), null);
  // agregar una quitada
  assert.match(validarContraOpciones(completo({ aditamentos: ["Topes"] }), null, opciones) ?? "", /Topes.*ya no se ofrece/);
  assert.match(validarContraOpciones(completo({ bandasSuperiores: "MBT" }), previo, opciones) ?? "", /Bandas superiores.*MBT/);
  // sin mirar mayúsculas
  assert.equal(validarContraOpciones(completo({ aditamentos: ["MICROTORNILLOS"] }), null, opciones), null);
});

// ─── FDI ────────────────────────────────────────────────────────────────

test("FDI: piezas válidas de leche y permanentes; leerFdi separa lo que no sirve", () => {
  for (const ok of [11, 18, 28, 38, 48, 51, 55, 85]) assert.ok(esFdiValido(ok), String(ok));
  for (const mal of [0, 10, 19, 29, 39, 49, 56, 86, 9, 100, 1.5, "14"]) assert.equal(esFdiValido(mal as never), false, String(mal));
  assert.deepEqual(leerFdi("14,24, 34;44 24"), { validos: [14, 24, 34, 44], invalidos: [] });
  assert.deepEqual(leerFdi("14, 99, abc"), { validos: [14], invalidos: ["99", "abc"] });
  assert.deepEqual(leerFdi(""), { validos: [], invalidos: [] });
});

test("extracciones pendientes y marcado como realizadas", () => {
  assert.deepEqual(extraccionesPendientes([14, 24, 34, 44], [24]), [14, 34, 44]);
  assert.deepEqual(marcarExtraccionesRealizadas([24], [14, 24, 99]), [14, 24]);
  assert.deepEqual(extraccionesPendientes([], [14]), []);
});

// ─── Anclaje ────────────────────────────────────────────────────────────

test("el anclaje general se deriva de los dos por arcada; distintos = compuesto (ver por arcada)", () => {
  assert.equal(anclajeGeneralDerivado("MAXIMO", "MAXIMO"), "MAXIMUM");
  assert.equal(anclajeGeneralDerivado("ABSOLUTO", "MAXIMO"), "MAXIMUM");
  assert.equal(anclajeGeneralDerivado("MEDIO", "MEDIO"), "MODERATE");
  assert.equal(anclajeGeneralDerivado("MINIMO", "MINIMO_ABSOLUTO"), "MINIMUM");
  assert.equal(anclajeGeneralDerivado("MAXIMO", "MEDIO"), "COMPOUND");
  assert.equal(anclajeGeneralDerivado("MAXIMO", null), "MAXIMUM");
  assert.equal(anclajeGeneralDerivado(null, "MEDIO"), "MODERATE");
  assert.equal(anclajeGeneralDerivado(null, null), null, "sin elegir no toca el general de siempre");
});

// ─── Microtornillos ↔ TADs ──────────────────────────────────────────────

test("microtornillos y miniplacas piden TADs", () => {
  assert.equal(planPideTads(["Microtornillos"]), true);
  assert.equal(planPideTads(["miniplacas"]), true);
  assert.equal(planPideTads(["Mini implante"]), true);
  assert.equal(planPideTads(["Topes", "IZG"]), false);
  assert.equal(planPideTads([]), false);
});

// ─── Resumen legible ────────────────────────────────────────────────────

test("lineasDelPlan: dice todo lo elegido y calla lo vacío", () => {
  const base = { estimatedDurationMonths: 18, anchorageType: "MODERATE", extractionsRequired: true, extractionsTeethFdi: [44, 14, 24, 34] };
  const vacias = lineasDelPlan(base, null);
  assert.deepEqual(vacias.map((l) => l.clave), ["duracion", "extraccionesIndicadas"], "el «Moderado» de arranque no es un dato");
  assert.equal(lineasDelPlan({ ...base, anchorageType: "MAXIMUM" }, null).find((l) => l.clave === "anclaje")!.valor, "Máximo", "un general distinto del de arranque sí se eligió");

  const l = lineasDelPlan(
    base,
    completo({
      controlesPrevistos: 18,
      alineadoresTotales: 24,
      anclajeSuperior: "MAXIMO",
      anclajeInferior: "MINIMO_ABSOLUTO",
      aditamentos: ["Barra Palatina"],
      extraccionesRealizadas: [14],
      controlRadiografico: ["PANORAMICA", "MANO"],
      periodicidadMeses: 12,
      reevaluacion: "2027-03-12",
      brackets: ["Inovation Roth", "MBT"],
      placas: ["Disyuntor Moon"],
      tubosSuperiores: "Roth",
      tubosInferiores: "Roth",
      bandasSuperiores: "MBT",
      cementacionSuperiorAnterior: "Corona clínica",
      cementacionInferiorPosterior: "Corona clínica",
      interconsultas: "con odontología general",
    }),
    2,
  );
  const por = Object.fromEntries(l.map((x) => [x.clave, x.valor]));
  assert.equal(por.duracion, "18 meses");
  assert.equal(por.controles, "18");
  assert.equal(por.alineadoresTotales, "24");
  assert.equal(por.anclaje, "Superior máximo · inferior mínimo absoluto");
  assert.equal(por.aditamentos, "Barra Palatina, Microtornillos (TAD)", "los TAD registrados aparecen como aditamento aunque no se marcaran");
  assert.equal(por.tads, "2");
  assert.equal(por.extraccionesIndicadas, "14, 24, 34, 44");
  assert.equal(por.extraccionesRealizadas, "14");
  assert.equal(por.radiografico, "Panorámica, Mano · cada 12 meses · reevaluación 12/03/2027");
  assert.equal(por.brackets, "Inovation Roth, MBT");
  assert.equal(por.placas, "Disyuntor Moon");
  assert.equal(por.tubos, "superiores: Roth · inferiores: Roth");
  assert.equal(por.bandas, "superiores: MBT");
  assert.equal(por.cementacion, "superior anterior: Corona clínica · inferior posterior: Corona clínica");
  assert.equal(por.interconsultas, "con odontología general");
  assert.equal(por.alineadores, undefined);
});

test("lineasDelPlan: con microtornillos marcados y TAD registrados no se repite el aditamento", () => {
  const l = lineasDelPlan({ estimatedDurationMonths: null, anchorageType: null, extractionsRequired: false, extractionsTeethFdi: [] }, completo({ aditamentos: ["Microtornillos"] }), 3);
  assert.equal(l.find((x) => x.clave === "aditamentos")!.valor, "Microtornillos");
  assert.equal(l.find((x) => x.clave === "tads")!.valor, "3");
});

test("aparatologiaElegida junta brackets, alineadores y placas", () => {
  assert.equal(aparatologiaElegida(null), null);
  assert.equal(aparatologiaElegida(completo()), null);
  assert.equal(aparatologiaElegida(completo({ brackets: ["Inovation Roth"], placas: ["Plano superior"] })), "Inovation Roth, Plano superior");
});

// ─── Movimientos ────────────────────────────────────────────────────────

test("cambiosDelPlan y su frase de Movimientos: dicen qué secciones, no qué contenían", () => {
  const antes = completo({ controlesPrevistos: 12, aditamentos: ["Topes"] });
  const despues = completo({ controlesPrevistos: 18, aditamentos: ["Topes", "IZG"], tubosSuperiores: "Roth", extraccionesRealizadas: [14] });
  const c = cambiosDelPlan({ detalle: antes, extraccionesIndicadas: [14] }, { detalle: despues, extraccionesIndicadas: [14, 24] });
  assert.deepEqual(new Set(c.campos), new Set(["controlesPrevistos", "aditamentos", "tubosSuperiores", "extraccionesRealizadas", "extraccionesIndicadas"]));
  assert.deepEqual(c.cambios.controlesPrevistos, { before: 12, after: 18 });
  const t = textoDeMovimientoDelPlan(c.secciones);
  assert.match(t, /^Actualizó el plan de tratamiento de ortodoncia: /);
  assert.ok(!/18|12|Roth|IZG/.test(t), "sin valores clínicos");
  assert.match(t, /controles previstos/);
});

test("cambiosDelPlan sin diferencias no inventa cambios", () => {
  const p = completo({ brackets: ["MBT"] });
  const c = cambiosDelPlan({ detalle: p }, { detalle: p });
  assert.deepEqual(c.campos, []);
  assert.equal(textoDeMovimientoDelPlan(c.secciones), "Actualizó el plan de tratamiento de ortodoncia");
  assert.equal(textoDeMovimientoDelPlan([], true), "Completó el plan de tratamiento de ortodoncia");
});

test("la frase de Movimientos resume cuando son muchas secciones", () => {
  const t = textoDeMovimientoDelPlan(["controles", "anclaje", "aditamentos", "extracciones", "interconsultas"]);
  assert.match(t, /controles previstos, anclaje, aditamentos y 2 más$/);
});

// ─── Progreso «Control X de N» ──────────────────────────────────────────

test("progreso de controles", () => {
  const p = progresoDeControles(5, 18);
  assert.deepEqual({ ...p }, { hechos: 5, previstos: 18, siguiente: 6, restantes: 13, pct: 28, excedido: false, completo: false });
  assert.equal(textoControlQueSigue(p), "Control 6 de 18");
  assert.equal(textoControlesHechos(p), "5 de 18 controles");
  const ya = progresoDeControles(18, 18);
  assert.equal(ya.completo, true);
  assert.equal(ya.excedido, false);
  assert.equal(textoControlQueSigue(ya), "Control 19 (previstos: 18)");
  const pasado = progresoDeControles(20, 18);
  assert.equal(pasado.excedido, true);
  assert.equal(pasado.restantes, 0);
  assert.equal(pasado.pct, 100);
  const sin = progresoDeControles(3, null);
  assert.equal(sin.previstos, null);
  assert.equal(sin.pct, null);
  assert.equal(textoControlQueSigue(sin), "Control 4");
  assert.equal(textoControlesHechos(sin), "3 controles");
  assert.equal(textoControlesHechos(progresoDeControles(1, null)), "1 control");
  assert.equal(progresoDeControles(-4, 0).hechos, 0);
  assert.equal(progresoDeControles(0, 18).siguiente, 1);
});

// ─── Estimado por controles ─────────────────────────────────────────────

test("controles previstos × precio del control = estimado, en centavos exactos", () => {
  const e = estimadoPorControles(18, 800);
  assert.deepEqual(e, { previstos: 18, precioPorControl: 800, total: 14400 });
  assert.equal(estimadoPorControles(3, 333.33)!.total, 999.99);
  assert.equal(estimadoPorControles(10, 0.1)!.total, 1);
  assert.equal(estimadoPorControles(null, 800), null);
  assert.equal(estimadoPorControles(0, 800), null);
  assert.equal(estimadoPorControles(18, null), null);
  assert.equal(estimadoPorControles(18, 0), null);
  assert.match(textoDelEstimado(e!), /18 controles × .*800.* = .*14,400.*estimado.*se cobra al atenderlo/);
});

// ─── Reevaluación radiográfica ──────────────────────────────────────────

test("sumarMeses no se pasa del fin de mes", () => {
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(sumarMeses("2028-01-31", 1), "2028-02-29");
  assert.equal(sumarMeses("2026-03-12", 12), "2027-03-12");
  assert.equal(sumarMeses("2026-11-15", 3), "2027-02-15");
  assert.equal(fechaIsoValida("2026-02-29"), null);
  assert.equal(fechaIsoValida("2028-02-29"), "2028-02-29");
});

const PLAN_RX = { controlRadiografico: ["PANORAMICA" as const, "TELE" as const], periodicidadMeses: 12, reevaluacion: null };

test("reevaluación por periodicidad: desde la última radiografía TIPIFICADA de ese tipo", () => {
  const r = reevaluacionesPendientes({
    plan: PLAN_RX,
    status: "IN_PROGRESS",
    inicio: "2025-01-10",
    radiografias: [
      { tipo: "PANORAMICA", fecha: "2025-06-01" },
      { tipo: "PANORAMICA", fecha: "2025-09-20" },
      { tipo: "TELE", fecha: "2026-08-01" },
    ],
    hoy: "2026-10-01",
  });
  assert.equal(r.length, 1, "la tele es de hace 2 meses: no toca");
  assert.equal(r[0]!.tipo, "PANORAMICA");
  assert.equal(r[0]!.vence, "2026-09-20", "12 meses desde la ÚLTIMA panorámica");
  assert.equal(r[0]!.diasVencida, 11);
  assert.equal(r[0]!.desdeInicio, false);
});

test("reevaluación: sin radiografía de ese tipo (o no tipificada) se cuenta desde el inicio", () => {
  const r = reevaluacionesPendientes({
    plan: { controlRadiografico: ["PANORAMICA", "MANO"], periodicidadMeses: 6, reevaluacion: null },
    status: "IN_PROGRESS",
    inicio: "2026-01-15",
    radiografias: [],
    hoy: "2026-10-01",
  });
  assert.deepEqual(r.map((x) => [x.tipo, x.vence, x.desdeInicio]), [
    ["PANORAMICA", "2026-07-15", true],
    ["MANO", "2026-07-15", true],
  ]);
  // Sin inicio y sin radiografía no hay desde dónde contar.
  assert.deepEqual(reevaluacionesPendientes({ plan: PLAN_RX, status: "IN_PROGRESS", inicio: null, radiografias: [], hoy: "2026-10-01" }), []);
});

test("reevaluación: «Mano» y «Scanner ATM» no se tipifican: una foto con otra categoría no las reinicia", () => {
  const r = reevaluacionesPendientes({
    plan: { controlRadiografico: ["MANO"], periodicidadMeses: 6, reevaluacion: null },
    status: "IN_PROGRESS",
    inicio: "2026-01-01",
    radiografias: [{ tipo: "MANO", fecha: "2026-09-30" }],
    hoy: "2026-10-01",
  });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.desdeInicio, true);
});

test("reevaluación por fecha: toca al llegar, y deja de tocar si ya hay una radiografía tipificada posterior", () => {
  const plan = { controlRadiografico: ["PANORAMICA" as const], periodicidadMeses: null, reevaluacion: "2026-09-01" };
  const toca = reevaluacionesPendientes({ plan, status: "IN_PROGRESS", inicio: "2026-01-01", radiografias: [], hoy: "2026-09-01" });
  assert.deepEqual(toca.map((x) => [x.tipo, x.motivo, x.diasVencida]), [[null, "fecha", 0]]);
  assert.equal(reevaluacionesPendientes({ plan, status: "IN_PROGRESS", inicio: "2026-01-01", radiografias: [], hoy: "2026-08-31" }).length, 0, "antes de la fecha no toca");
  const hecha = reevaluacionesPendientes({ plan, status: "IN_PROGRESS", inicio: "2026-01-01", radiografias: [{ tipo: "PANORAMICA", fecha: "2026-09-02" }], hoy: "2026-10-01" });
  assert.equal(hecha.length, 0);
  const antigua = reevaluacionesPendientes({ plan, status: "IN_PROGRESS", inicio: "2026-01-01", radiografias: [{ tipo: "PANORAMICA", fecha: "2026-08-30" }], hoy: "2026-10-01" });
  assert.equal(antigua.length, 1, "una radiografía anterior a la fecha no la cumple");
});

test("reevaluación: casos en pausa o cerrados no alertan; un caso por colocar solo por fecha", () => {
  const plan = { controlRadiografico: ["PANORAMICA" as const], periodicidadMeses: 6, reevaluacion: "2026-01-01" };
  for (const status of ["ON_HOLD", "COMPLETED", "DROPPED_OUT"]) {
    assert.deepEqual(reevaluacionesPendientes({ plan, status, inicio: "2025-01-01", radiografias: [], hoy: "2026-10-01" }), [], status);
  }
  const porColocar = reevaluacionesPendientes({ plan, status: "PLANNED", inicio: "2025-01-01", radiografias: [], hoy: "2026-10-01" });
  assert.deepEqual(porColocar.map((x) => x.motivo), ["fecha"]);
});

test("reevaluación: sin fecha ni periodicidad no hay nada que vigilar; la más vencida va primero", () => {
  assert.deepEqual(
    reevaluacionesPendientes({ plan: { controlRadiografico: ["PANORAMICA"], periodicidadMeses: null, reevaluacion: null }, status: "IN_PROGRESS", inicio: "2020-01-01", radiografias: [], hoy: "2026-10-01" }),
    [],
  );
  const r = reevaluacionesPendientes({
    plan: { controlRadiografico: ["PANORAMICA", "TELE"], periodicidadMeses: 12, reevaluacion: null },
    status: "IN_PROGRESS",
    inicio: "2024-01-01",
    radiografias: [{ tipo: "TELE", fecha: "2025-01-01" }, { tipo: "PANORAMICA", fecha: "2024-06-01" }],
    hoy: "2026-10-01",
  });
  assert.deepEqual(r.map((x) => x.tipo), ["PANORAMICA", "TELE"]);
});

// ─── Procedimientos que el plan propone ─────────────────────────────────

const CATALOGO = [
  { id: "p1", name: "Colocación de microtornillo" },
  { id: "p2", name: "Barra palatina" },
  { id: "p3", name: "Disyuntor cementado" },
  { id: "p4", name: "Placa de retención Hawley" },
  { id: "p5", name: "Limpieza dental" },
  { id: "p6", name: "Reposición de bracket" },
  { id: "p7", name: "Miniplaca de anclaje" },
];

test("el plan propone los procedimientos del catálogo que corresponden a lo elegido", () => {
  const s = procedimientosSugeridos(completo({ aditamentos: ["Microtornillos", "Barra Palatina"], placas: ["Disyuntor Moon", "Plano superior"] }), CATALOGO);
  assert.deepEqual(s.map((x) => x.procedureId), ["p1", "p2", "p3", "p4"]);
  assert.equal(s[0]!.motivo, "Del plan: Microtornillos");
  assert.equal(s[3]!.motivo, "Del plan: Plano superior", "un plano es una placa");
});

test("los brackets no proponen nada, ni se propone lo que no está en el plan", () => {
  assert.deepEqual(procedimientosSugeridos(completo({ brackets: ["Damon"] }), CATALOGO), []);
  assert.deepEqual(procedimientosSugeridos(null, CATALOGO), []);
  assert.deepEqual(procedimientosSugeridos(completo({ aditamentos: ["Topes"] }), CATALOGO), []);
  const m = procedimientosSugeridos(completo({ aditamentos: ["Miniplacas"] }), CATALOGO);
  assert.deepEqual(m.map((x) => x.procedureId), ["p7"], "miniplaca no arrastra a «placa de retención»");
});

test("el emparejamiento entiende sinónimos, guiones y mayúsculas del nombre que puso la clínica", () => {
  const catalogo = [
    { id: "a", name: "Mini-implante (TAD)" },
    { id: "b", name: "MICRO TORNILLO de anclaje" },
    { id: "c", name: "Minitornillo palatino" },
  ];
  const s = procedimientosSugeridos(completo({ aditamentos: ["Microtornillos"] }), catalogo);
  assert.deepEqual(s.map((x) => x.procedureId), ["a", "b", "c"]);
});

test("lo que el plan eligió y el catálogo no tiene se DICE (con su aviso), y lo que sí tiene no se avisa", () => {
  const sinMicro = CATALOGO.filter((c) => c.id !== "p1");
  const faltan = procedimientosQueFaltanEnElCatalogo(completo({ aditamentos: ["Microtornillos", "Barra Palatina"] }), sinMicro);
  assert.deepEqual(faltan, ["Microtornillos"]);
  assert.equal(avisoDeProcedimientoFaltante("Microtornillos"), "Tu plan incluye Microtornillos: agrega su procedimiento en Configuración → Procedimientos para cobrarlo.");
  assert.deepEqual(procedimientosQueFaltanEnElCatalogo(completo({ aditamentos: ["Microtornillos"] }), CATALOGO), []);
  // Lo que no es un procedimiento que se cobre (brackets, un aditamento sin grupo) ni se avisa; sin plan tampoco.
  assert.deepEqual(procedimientosQueFaltanEnElCatalogo(completo({ brackets: ["Damon"], aditamentos: ["Ancla QA"] }), []), []);
  assert.deepEqual(procedimientosQueFaltanEnElCatalogo(null, []), []);
  // Dos aditamentos del mismo grupo avisan una sola vez.
  assert.deepEqual(procedimientosQueFaltanEnElCatalogo(completo({ aditamentos: ["Microtornillos", "Mini implantes"] }), []), ["Microtornillos"]);
});

test("ordenarConSugeridosPrimero deja los sugeridos arriba y el resto como estaba", () => {
  const filas = CATALOGO.map((c) => ({ id: c.id, name: c.name }));
  const o = ordenarConSugeridosPrimero(filas, [{ procedureId: "p3", motivo: "" }, { procedureId: "p1", motivo: "" }]);
  assert.deepEqual(o.map((x) => x.id), ["p3", "p1", "p2", "p4", "p5", "p6", "p7"]);
  assert.deepEqual(ordenarConSugeridosPrimero(filas, []).map((x) => x.id), filas.map((x) => x.id));
});

// ─── El formulario ↔ el servidor ────────────────────────────────────────
import {
  alternar,
  formularioAPeticion,
  formularioDesdeLaVista,
  formularioTocado,
  formularioVacio,
} from "../plan-detalle-formulario";
import type { PlanDeTratamientoVista } from "../plan-detalle";

const vista = (extra: Partial<PlanDeTratamientoVista> = {}): PlanDeTratamientoVista => ({
  treatmentPlanId: "p1",
  detalle: planDetalleVacio(),
  columna: true,
  duracionMeses: 18,
  anchorageType: "MODERATE",
  extraccionesRequired: false,
  extraccionesIndicadas: [],
  tads: 0,
  controlesHechos: 0,
  conSeguimientoDeAlineadores: false,
  reevaluaciones: [],
  caso: { tecnica: "METAL_BRACKETS", tecnicaNombrePropio: null, tecnicaVisible: "Brackets metálicos", objetivos: "AESTHETIC_AND_FUNCTIONAL", retencion: "", doctorId: null, responsableId: null, colocadoEl: null, costoReferencia: 0, iprRequerido: false, billingMode: "PRECIO_TOTAL", factura: null },
  ...extra,
});

test("el formulario parte de lo que el caso ya tiene y vuelve igual al servidor", () => {
  const detalle = completo({
    controlesPrevistos: 18,
    anclajeSuperior: "MAXIMO",
    aditamentos: ["Topes"],
    extraccionesRealizadas: [24],
    controlRadiografico: ["PANORAMICA"],
    periodicidadMeses: 12,
    reevaluacion: "2027-03-12",
    tubosSuperiores: "Roth",
    interconsultas: "con odontología",
  });
  const f = formularioDesdeLaVista(vista({ detalle, extraccionesIndicadas: [14, 24], extraccionesRequired: true }));
  assert.equal(f.duracion, "18");
  assert.equal(f.extraccionesIndicadas, "14, 24");
  const r = formularioAPeticion(f);
  assert.ok(r.ok);
  assert.deepEqual(r.peticion.extraccionesIndicadas, [14, 24]);
  assert.equal(r.peticion.duracionMeses, 18);
  const v = validarPlanDetalle(r.peticion.plan);
  assert.ok(v.ok);
  assert.deepEqual(v.plan, { ...detalle });
});

test("formularioAPeticion dice qué corregir, en palabras de la clínica", () => {
  const con = (x: Partial<ReturnType<typeof formularioVacio>>) => formularioAPeticion({ ...formularioVacio(18), ...x });
  const error = (x: Partial<ReturnType<typeof formularioVacio>>) => {
    const r = con(x);
    assert.equal(r.ok, false);
    return r.ok === false ? r.error : "";
  };
  assert.match(error({ controles: "abc" }), /Cantidad de controles/);
  assert.match(error({ controles: "0" }), /Cantidad de controles/);
  assert.match(error({ alineadoresTotales: "500" }), /Alineadores totales/);
  assert.match(error({ periodicidad: "1.5" }), /Periodicidad/);
  assert.match(error({ duracion: "" }), /Tiempo de tratamiento/);
  assert.match(error({ duracion: "2" }), /Tiempo de tratamiento/);
  assert.match(error({ extraccionesIndicadas: "14, 99" }), /«99».*FDI/);
  assert.match(error({ extraccionesRealizadas: "xx" }), /Extracciones realizadas/);
  assert.match(error({ reevaluacion: "2027-13-01" }), /reevaluación/);
  assert.ok(con({}).ok);
});

test("en el alta la duración no se pide otra vez (ya está arriba)", () => {
  const r = formularioAPeticion({ ...formularioVacio(), controles: "12" }, { conDuracion: false });
  assert.ok(r.ok);
  if (r.ok === true) assert.equal(r.peticion.duracionMeses, undefined);
});

test("formularioTocado: la duración sola no cuenta; cualquier otra cosa sí", () => {
  assert.equal(formularioTocado(formularioVacio(18)), false);
  assert.equal(formularioTocado({ ...formularioVacio(18), interconsultas: "  " }), false);
  assert.equal(formularioTocado({ ...formularioVacio(18), aditamentos: ["Topes"] }), true);
  assert.equal(formularioTocado({ ...formularioVacio(), anclajeSuperior: "MEDIO" }), true);
});

test("alternar agrega y quita sin repetir", () => {
  assert.deepEqual(alternar(["a"], "b"), ["a", "b"]);
  assert.deepEqual(alternar(["a", "b"], "a"), ["b"]);
});

// ─── Importador de Dentalink: mapeo preparado ───────────────────────────
import { planDetalleDesdeDentalink } from "../../import/dentalink/plan-detalle-mapeo";

test("un export de Dentalink con los campos del plan se convierte a un plan válido", () => {
  const r = planDetalleDesdeDentalink({
    "Tiempo de tratamiento": "18 meses",
    "Cantidad controles": "18",
    "Anclaje Superior": "Máximo",
    "Anclaje inferior": "Mínimo Absoluto",
    Aditamentos: "Microtornillos; Barra Palatina",
    "Extracciones indicadas": "14,24,34,44",
    "Extracciones realizadas": "14",
    "Tipo control radiográfico": "Panorámica, Scanner ATM post Deprogramación, Radar",
    Periodicidad: "12 meses",
    Reevaluación: "12/03/2027",
    Brackets: "Inovation Roth",
    "Tubos superiores": "Roth",
    "Cementación Superior Anterior": "Corona Clínica",
    Interconsultas: "con odontología general para exodoncia premolares",
    "Columna ajena": "x",
  });
  assert.ok(r.traeCampos);
  assert.equal(r.duracionMeses, 18);
  assert.deepEqual(r.extraccionesIndicadas, [14, 24, 34, 44]);
  assert.equal(r.detalle.controlesPrevistos, 18);
  assert.equal(r.detalle.anclajeSuperior, "MAXIMO");
  assert.equal(r.detalle.anclajeInferior, "MINIMO_ABSOLUTO");
  assert.deepEqual(r.detalle.aditamentos, ["Microtornillos", "Barra Palatina"]);
  assert.deepEqual(r.detalle.controlRadiografico, ["PANORAMICA", "ATM_POST_DEPROGRAMACION"]);
  assert.equal(r.detalle.periodicidadMeses, 12);
  assert.equal(r.detalle.reevaluacion, "2027-03-12");
  assert.equal(r.detalle.tubosSuperiores, "Roth");
  assert.equal(r.detalle.cementacionSuperiorAnterior, "Corona Clínica");
  assert.match(r.avisos.join(" "), /«Radar»/);
  assert.ok(validarPlanDetalle(r.detalle).ok, "lo que sale pasa la validación del servidor");
});

test("un export sin los campos del plan no trae nada, y lo que no se entiende se avisa", () => {
  assert.equal(planDetalleDesdeDentalink({ Paciente: "Ana", Fecha: "01/01/2026" }).traeCampos, false);
  const r = planDetalleDesdeDentalink({ "Anclaje superior": "Enorme", "Extracciones indicadas": "14, 99", Reevaluación: "pronto" });
  assert.equal(r.detalle.anclajeSuperior, null);
  assert.deepEqual(r.extraccionesIndicadas, [14]);
  assert.equal(r.detalle.reevaluacion, null);
  assert.equal(r.avisos.length, 3);
});

import { SECCIONES_DEL_FORMULARIO, seccionesConDatos } from "../plan-detalle-formulario";

test("la navegación del popup marca las secciones que ya tienen algo", () => {
  assert.deepEqual(SECCIONES_DEL_FORMULARIO.map((s) => s.titulo), [
    "Tiempo y controles", "Anclaje", "Aditamentos", "Extracciones", "Control radiográfico", "Aparatología", "Tubos, bandas y cementación", "Interconsultas",
  ]);
  const vacio = seccionesConDatos(formularioVacio(18));
  assert.ok(Object.values(vacio).every((v) => v === false), "la duración sola no cuenta");
  const f = seccionesConDatos({ ...formularioVacio(18), controles: "18", anclajeInferior: "MEDIO", placas: ["Disyuntor Moon"], bandasSuperiores: "Roth", extraccionesRealizadas: "14" });
  assert.deepEqual(Object.entries(f).filter(([, v]) => v).map(([k]) => k), ["tiempo", "anclaje", "extracciones", "aparatologia", "tubos"]);
});

// ─── Reglas de no-repetición (gerente, 29-sep) ──────────────────────────
import {
  FRECUENCIAS_DE_CONTROL,
  aparatologiaPermitida,
  controlesSugeridos,
  normalizarFrecuenciaDeControl,
  prescripcionDerivada,
  sinAparatologiaIncompatible,
  tadsRequeridos,
  validarContraTecnica,
} from "../plan-detalle";

test("controles previstos se proponen: duración ÷ frecuencia de control de la clínica", () => {
  assert.equal(controlesSugeridos(18), 18, "por omisión, uno al mes");
  assert.equal(controlesSugeridos(18, 30), 18);
  assert.equal(controlesSugeridos(18, 14), 39, "cada 2 semanas");
  assert.equal(controlesSugeridos(12, 60), 6, "cada 2 meses");
  assert.equal(controlesSugeridos(24, 42), 17, "cada 6 semanas");
  assert.equal(controlesSugeridos(null), null);
  assert.equal(controlesSugeridos(0), null);
  assert.equal(controlesSugeridos(60, 7), 120, "con tope");
  assert.equal(normalizarFrecuenciaDeControl("abc"), 30);
  assert.equal(normalizarFrecuenciaDeControl(3), 30, "menos de 7 días no es una frecuencia");
  assert.equal(normalizarFrecuenciaDeControl("21"), 21);
  assert.ok(FRECUENCIAS_DE_CONTROL.some((f) => f.dias === 30 && f.texto === "Cada mes"));
});

test("la aparatología que se ofrece sigue a la técnica: alineadores solo con alineadores o mixta", () => {
  assert.deepEqual(aparatologiaPermitida("CLEAR_ALIGNERS"), { brackets: false, alineadores: true });
  assert.deepEqual(aparatologiaPermitida("HYBRID"), { brackets: true, alineadores: true });
  for (const t of ["METAL_BRACKETS", "CERAMIC_BRACKETS", "SELF_LIGATING_METAL", "SELF_LIGATING_CERAMIC", "LINGUAL_BRACKETS"]) {
    assert.deepEqual(aparatologiaPermitida(t), { brackets: true, alineadores: false }, t);
  }
  assert.deepEqual(aparatologiaPermitida(null), { brackets: true, alineadores: true }, "sin técnica elegida no se filtra");
});

test("al cambiar de técnica se quita lo incompatible y se dice qué; el servidor lo exige", () => {
  const plan = completo({ brackets: ["Damon"], alineadores: ["Invisalign lite dual"], placas: ["Plano superior"] });
  const a = sinAparatologiaIncompatible(plan, "CLEAR_ALIGNERS");
  assert.deepEqual(a.plan.brackets, []);
  assert.deepEqual(a.plan.alineadores, ["Invisalign lite dual"]);
  assert.deepEqual(a.plan.placas, ["Plano superior"], "las placas van con cualquier técnica");
  assert.deepEqual(a.quitados, ["Damon"]);
  assert.deepEqual(sinAparatologiaIncompatible(plan, "HYBRID").quitados, []);
  assert.match(validarContraTecnica(plan, "METAL_BRACKETS", "Brackets metálicos") ?? "", /Alineadores.*«Brackets metálicos»/);
  assert.match(validarContraTecnica(plan, "CLEAR_ALIGNERS") ?? "", /Brackets/);
  assert.equal(validarContraTecnica(plan, "HYBRID"), null);
  assert.equal(validarContraTecnica(completo({ brackets: ["MBT"] }), "SELF_LIGATING_CERAMIC"), null);
});

test("tadsRequired se deriva de Aditamentos y de los TAD registrados, no es una casilla aparte", () => {
  assert.equal(tadsRequeridos(["Microtornillos"]), true);
  assert.equal(tadsRequeridos(["Miniplacas", "Topes"]), true);
  assert.equal(tadsRequeridos(["Topes"]), false);
  assert.equal(tadsRequeridos(["Topes"], 2), true);
  assert.equal(tadsRequeridos([]), false);
});

test("la prescripción y el cementado generales se derivan de tubos, bandas y cementación", () => {
  assert.deepEqual(prescripcionDerivada(completo({ tubosSuperiores: "Roth", tubosInferiores: "Roth", bandasSuperiores: "Roth" })), { prescriptionSlot: "ROTH_022", bondingType: null });
  assert.equal(prescripcionDerivada(completo({ tubosSuperiores: "MBT" })).prescriptionSlot, "MBT_022");
  assert.equal(prescripcionDerivada(completo({ bandasInferiores: "Damon" })).prescriptionSlot, "DAMON_Q2");
  assert.equal(prescripcionDerivada(completo({ tubosSuperiores: "Roth", bandasSuperiores: "MBT" })).prescriptionSlot, null, "sistemas mezclados: no se deduce");
  assert.equal(prescripcionDerivada(completo()).prescriptionSlot, null);
  assert.equal(prescripcionDerivada(completo({ brackets: ["MBT"], tubosSuperiores: "Roth" })).prescriptionSlot, null, "brackets MBT con tubos Roth: dos prescripciones, ninguna se deduce");
  assert.equal(prescripcionDerivada(completo({ brackets: ["Ovation Roth"], tubosSuperiores: "Roth" })).prescriptionSlot, "ROTH_022");
  assert.equal(prescripcionDerivada(completo({ cementacionSuperiorAnterior: "Cementado indirecto" })).bondingType, "INDIRECTO");
  assert.equal(prescripcionDerivada(completo({ cementacionSuperiorAnterior: "Directo", cementacionInferiorAnterior: "Directo" })).bondingType, "DIRECTO");
  assert.equal(prescripcionDerivada(completo({ cementacionSuperiorAnterior: "Directo", cementacionInferiorAnterior: "Indirecto" })).bondingType, null);
  assert.equal(prescripcionDerivada(completo({ cementacionSuperiorAnterior: "Corona clínica" })).bondingType, null, "«corona clínica» no dice directo o indirecto");
});

// ─── Casos con diagnóstico o plan incompleto ────────────────────────────
import { pasoQueFalta, piezasQueFaltan } from "../plan-detalle";

const CASO_COMPLETO = {
  diagnosticoMigrado: false,
  sinCapturar: [] as string[],
  doctorId: "d1",
  detalle: completo({ controlesPrevistos: 18, anclajeSuperior: "MAXIMO" as const, brackets: ["MBT"] }),
  billingMode: "PRECIO_TOTAL" as const,
  tieneFactura: true,
};

test("un caso completo no tiene nada que faltar; lo opcional vacío no cuenta", () => {
  assert.deepEqual(piezasQueFaltan(CASO_COMPLETO), []);
  assert.equal(pasoQueFalta([]), null);
});

test("lo opcional no cuenta: sin resumen clínico, anclaje, aparatología ni retención el caso NO está incompleto", () => {
  const f = piezasQueFaltan({ ...CASO_COMPLETO, detalle: completo({ controlesPrevistos: 18 }) });
  assert.deepEqual(f, []);
});

test("un caso migrado de Dentalink entra vacío: dice qué falta y a qué paso ir primero", () => {
  const f = piezasQueFaltan({
    diagnosticoMigrado: true,
    doctorId: null,
    detalle: null,
    billingMode: "PRECIO_TOTAL",
    tieneFactura: false,
  });
  assert.deepEqual(f.map((x) => x.clave), ["diagnostico-migrado", "doctor", "controles", "cobro"]);
  assert.equal(pasoQueFalta(f), "diagnostico");
  assert.equal(pasoQueFalta(f.filter((x) => x.paso === "plan")), "plan");
});

test("la falta se dice por pieza: Angle y overjet/overbite sin capturar, sin doctor, «Pago por control» sin factura de colocación", () => {
  const f = piezasQueFaltan({
    ...CASO_COMPLETO,
    sinCapturar: ["angleClassRight", "angleClassLeft", "overjetMm", "overbiteMm", "overbitePercentage"],
    doctorId: null,
    billingMode: "PAGO_POR_CONTROL",
    tieneFactura: false,
  });
  assert.deepEqual(f.map((x) => x.clave), ["angle", "overjet-overbite", "doctor", "cobro"]);
  assert.equal(f.find((x) => x.clave === "cobro")!.texto, "factura de colocación");
  assert.equal(pasoQueFalta(f), "diagnostico");
});

// ─── Una fuente para la prescripción y lo de arranque que no es dato (ws1-t12, revisión final) ────

import { anclajeGeneralComoDato, prescripcionDelPlan } from "../plan-detalle";

test("la prescripción es la que dice el plan, tal cual: brackets MBT con tubos Roth se dicen los dos", () => {
  assert.equal(prescripcionDelPlan(completo({ brackets: ["MBT"], tubosSuperiores: "Roth", tubosInferiores: "Roth" })), "Brackets MBT · Tubos Roth");
  assert.equal(prescripcionDelPlan(completo({ brackets: ["MBT"], tubosSuperiores: "MBT", bandasSuperiores: "MBT" })), "Brackets MBT · Tubos y bandas MBT");
  assert.equal(prescripcionDelPlan(completo({ tubosSuperiores: "Roth", bandasInferiores: "Damon" })), "Tubos Roth · Bandas Damon");
  assert.equal(prescripcionDelPlan(completo({ alineadores: ["Invisalign lite single"] })), null, "los alineadores no llevan prescripción de brackets");
  assert.equal(prescripcionDelPlan(completo()), null, "sin nada elegido no se inventa un calibre");
});

test("el anclaje general «Moderado» es el de arranque y no se dice como dato; los demás sí", () => {
  assert.equal(anclajeGeneralComoDato("MODERATE"), null);
  assert.equal(anclajeGeneralComoDato(null), null);
  assert.equal(anclajeGeneralComoDato("MAXIMUM"), "Máximo");
  assert.equal(anclajeGeneralComoDato("COMPOUND"), "Compuesto (ver por arcada)");
});
