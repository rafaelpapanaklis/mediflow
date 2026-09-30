// ws1-t8 — «Diagnóstico» completo de ortodoncia (como Dentalink): validación en el servidor, lectura tolerante,
// derivados (un dato, un lugar), renglones legibles, valores clave, Movimientos y el formulario del paso. Puro.
// Correr: npm run test:orto-diagnostico
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECCIONES_DEL_DETALLE,
  cambiosDelDetalle,
  categoriaOverbite,
  categoriaOverjet,
  diagnosticoDetalleVacio,
  esDiagnosticoDetalleVacio,
  faltaDelDiagnostico,
  gradoDeApinamiento,
  indicadoresClave,
  lineaMediaDerivada,
  mordidasDerivadas,
  normalizarDiagnosticoDetalle,
  seccionesDelDiagnostico,
  textoDeMovimientoDelDiagnostico,
  validarDiagnosticoDetalle,
  type DiagnosticoBase,
} from "../diagnostico-detalle";
import {
  avanceDelPaso,
  entradaParaGuardar,
  formularioAPeticion,
  formularioDesdeDiagnostico,
  formularioVacio,
  hayCambiosEnElDiagnostico,
  type PeticionDelDiagnostico,
} from "../diagnostico-formulario";

const BASE: DiagnosticoBase = {
  angleClassRight: "CLASS_I",
  angleClassLeft: "CLASS_I",
  overbiteMm: 2,
  overbitePercentage: 20,
  overjetMm: 3,
  midlineDeviationMm: null,
  crowdingUpperMm: null,
  crowdingLowerMm: null,
  crossbite: false,
  crossbiteDetails: null,
  openBite: false,
  openBiteDetails: null,
  etiologySkeletal: false,
  etiologyDental: false,
  etiologyFunctional: false,
  etiologyNotes: null,
  habits: [],
  habitsDescription: null,
  dentalPhase: "PERMANENT",
  skeletalPattern: null,
  tmjPainPresent: false,
  tmjClickingPresent: false,
  tmjNotes: null,
  clinicalSummary: "Paciente clase I con buena relación de arcos y perfil recto, sin alteraciones.",
};

test("un dato, un lugar: el JSON no repite lo que ya tiene columna ni lo que se deriva", () => {
  const claves = SECCIONES_DEL_DETALLE.flatMap((s) => s.campos.map((c) => `${s.clave}.${c.clave}`));
  for (const prohibida of [
    "oclusal.overjet", // categoría: se deriva de overjetMm
    "oclusal.overbite", // categoría: se deriva de overbiteMm
    "oclusal.mordida", // la dicen overbite y las mordidas cruzadas/abierta
    "dentoalveolar.apinamientoSuperior", // grado: se deriva de crowdingUpperMm
    "dentoalveolar.apinamientoInferior",
    "funcional.deglucion", // es el hábito «deglución atípica»
    "cefalometria.vertTipo", // es la columna skeletalPattern
  ]) {
    assert.ok(!claves.includes(prohibida), `${prohibida} no debe estar en el JSON`);
  }
  assert.ok(!claves.some((c) => /referid|observ/i.test(c)), "doctor que refirió / observación son del caso");
  const sueno = SECCIONES_DEL_DETALLE.find((s) => s.clave === "funcional")!.campos.find((c) => c.clave === "sueno")!;
  assert.ok(sueno.tipo === "varias" && !sueno.opciones.some((o) => /brux/.test(o.valor)), "el bruxismo es hábito");
});

test("normalizar: descarta lo desconocido y lo fuera de rango, no inventa", () => {
  const d = normalizarDiagnosticoDetalle({
    facial: { cierreLabial: "forzado", menton: "inventado", extra: 1 },
    oclusal: { lineaMediaInferior: "izquierda", lineaMediaInferiorMm: "2,5", lineaMediaSuperiorMm: 99 },
    funcional: { sueno: ["ronquido", "ronquido", "x"] },
    raro: {},
  });
  assert.equal(d.facial.cierreLabial, "forzado");
  assert.equal(d.facial.menton, null);
  assert.equal(d.oclusal.lineaMediaInferiorMm, 2.5);
  assert.equal(d.oclusal.lineaMediaSuperiorMm, null);
  assert.deepEqual(d.funcional.sueno, ["ronquido"]);
  assert.ok(esDiagnosticoDetalleVacio(normalizarDiagnosticoDetalle(null)));
  assert.ok(esDiagnosticoDetalleVacio(normalizarDiagnosticoDetalle("basura")));
});

test("validar (servidor): errores con nombre de sección y campo", () => {
  assert.equal(validarDiagnosticoDetalle(null).ok, true);
  const mal = (x: unknown) => {
    const r = validarDiagnosticoDetalle(x);
    assert.equal(r.ok, false);
    return (r as { error: string }).error;
  };
  assert.match(mal({ otra: {} }), /sección desconocida/);
  assert.match(mal({ facial: { menton: "x" } }), /Características faciales · Mentón: opción no válida/);
  assert.match(mal({ facial: { nariz: "x" } }), /campo desconocido/);
  assert.match(mal({ cefalometria: { anb: 40 } }), /ANB: de -15 a 15/);
  assert.match(mal({ cefalometria: { anb: "abc" } }), /escribe un número/);
  assert.match(mal({ funcional: { sueno: ["sin-alteraciones", "ronquido"] } }), /Sin alteraciones/);
  assert.match(mal({ cefalometria: { analisisPenn: "x".repeat(301) } }), /máximo 300/);
  const ok = validarDiagnosticoDetalle({ facial: { claseFacialSagital: "II" }, cefalometria: { anb: "4,5" } });
  assert.equal(ok.ok, true);
  assert.equal((ok as { detalle: ReturnType<typeof diagnosticoDetalleVacio> }).detalle.cefalometria.anb, 4.5);
});

test("overjet/overbite: la categoría sale de los mm", () => {
  assert.equal(categoriaOverjet(null), null);
  assert.equal(categoriaOverjet(-2), "invertido");
  assert.equal(categoriaOverjet(0), "borde-a-borde");
  assert.equal(categoriaOverjet(0.5), "disminuido");
  assert.equal(categoriaOverjet(3), "normal");
  assert.equal(categoriaOverjet(6), "aumentado");
  assert.equal(categoriaOverbite(-1), "mordida-abierta");
  assert.equal(categoriaOverbite(4), "normal");
  assert.equal(categoriaOverbite(5), "aumentado");
  assert.equal(gradoDeApinamiento(0), null);
  assert.equal(gradoDeApinamiento(3), "leve");
  assert.equal(gradoDeApinamiento(5), "moderado");
  assert.equal(gradoDeApinamiento(9), "severo");
});

test("línea media única y mordidas: derivadas del detalle", () => {
  const d = diagnosticoDetalleVacio();
  assert.equal(lineaMediaDerivada(d), undefined);
  d.oclusal.lineaMediaSuperior = "centrada";
  assert.equal(lineaMediaDerivada(d), 0);
  d.oclusal.lineaMediaInferior = "izquierda";
  d.oclusal.lineaMediaInferiorMm = 2;
  assert.equal(lineaMediaDerivada(d), -2);
  d.oclusal.lineaMediaSuperior = "derecha";
  d.oclusal.lineaMediaSuperiorMm = 3;
  assert.equal(lineaMediaDerivada(d), 3);

  assert.deepEqual(mordidasDerivadas(diagnosticoDetalleVacio()), {});
  const m = diagnosticoDetalleVacio();
  m.dentoalveolar.cruzadaAnterior = "no";
  m.dentoalveolar.cruzadaPosterior = "bilateral";
  m.dentoalveolar.mordidaAbierta = "no";
  assert.deepEqual(mordidasDerivadas(m), { crossbite: true, openBite: false });
});

test("lectura: solo lo que tiene dato, patrón esquelético en cefalometría, respiración bucal vieja como respiración", () => {
  const d = diagnosticoDetalleVacio();
  d.facial.cierreLabial = "incompetente";
  d.cefalometria.vertValor = -1.2;
  const secs = seccionesDelDiagnostico({ ...BASE, skeletalPattern: "DOLICOFACIAL", habits: ["MOUTH_BREATHING", "BRUXISM"] }, d);
  const claves = secs.map((s) => s.clave);
  assert.deepEqual(claves, ["clasificacion", "facial", "funcional", "cefalometria"]);
  const cef = secs.find((s) => s.clave === "cefalometria")!.lineas.map((l) => l.clave);
  assert.deepEqual(cef, ["vertValor", "skeletalPattern"]);
  assert.ok(!secs.find((s) => s.clave === "clasificacion")!.lineas.some((l) => l.clave === "skeletalPattern"));
  const func = secs.find((s) => s.clave === "funcional")!.lineas;
  assert.equal(func.find((l) => l.clave === "respiracion")?.valor, "Oral");
  assert.equal(func.find((l) => l.clave === "habits")?.valor, "Bruxismo");
  assert.equal(secs.find((s) => s.clave === "facial")!.lineas[0]!.estado, "alterado");
  const ob = secs.find((s) => s.clave === "clasificacion")!.lineas.find((l) => l.clave === "overbiteMm")!;
  assert.equal(ob.valor, "2 mm (20%) · normal");
  // La línea media vieja (una sola) se sigue leyendo si no hay las nuevas.
  const vieja = seccionesDelDiagnostico({ ...BASE, midlineDeviationMm: 1.5 }, null);
  assert.equal(vieja.find((s) => s.clave === "oclusal")!.lineas[0]!.valor, "Desviada 1.5 mm");
});

test("valores clave: Angle, overjet/overbite con su categoría, clase facial y líneas medias", () => {
  const d = diagnosticoDetalleVacio();
  d.facial.claseFacialSagital = "II";
  d.oclusal.lineaMediaSuperior = "centrada";
  d.oclusal.lineaMediaInferior = "derecha";
  d.oclusal.lineaMediaInferiorMm = 2;
  const i = indicadoresClave({ ...BASE, angleClassRight: "CLASS_II_DIV_1", overjetMm: 6 }, d);
  const por = Object.fromEntries(i.map((x) => [x.clave, x]));
  assert.equal(por.angle!.valor, "II div. 1 / I");
  assert.equal(por.angle!.estado, "alterado");
  assert.equal(por.overjet!.detalle, "aumentado");
  assert.equal(por.overjet!.estado, "alterado");
  assert.equal(por.overbite!.estado, "normal");
  assert.equal(por.claseFacial!.valor, "Clase II");
  assert.equal(por.lineaMedia!.valor, "Una desviada");
  assert.equal(por.lineaMedia!.detalle, "sup. centrada · inf. der. 2 mm");
  const vacio = indicadoresClave(BASE, null);
  assert.equal(vacio.find((x) => x.clave === "claseFacial")!.valor, "—");
  assert.equal(vacio.find((x) => x.clave === "lineaMedia")!.estado, null);
});

test("Movimientos: qué apartados cambiaron, sin valores clínicos", () => {
  const a = diagnosticoDetalleVacio();
  const b = diagnosticoDetalleVacio();
  b.facial.menton = "retruido";
  b.cefalometria.anb = 5;
  const c = cambiosDelDetalle(a, b);
  assert.deepEqual(c.secciones, ["facial", "cefalometria"]);
  assert.deepEqual(c.campos, ["diagnosticoDetalle.facial.menton", "diagnosticoDetalle.cefalometria.anb"]);
  assert.deepEqual(cambiosDelDetalle(null, diagnosticoDetalleVacio()).campos, []);
  const t = textoDeMovimientoDelDiagnostico(["overjetMm", "skeletalPattern", "tmjNotes"], c.secciones);
  assert.equal(t, "Actualizó el diagnóstico de ortodoncia: clasificación, cefalometría, ATM y características faciales");
  assert.ok(!/retruido|5/.test(t));
  assert.equal(textoDeMovimientoDelDiagnostico([], []), "Actualizó el diagnóstico de ortodoncia");
});

test("formulario: desde el diagnóstico y de vuelta, con los derivados", () => {
  const f = formularioDesdeDiagnostico({ ...BASE, habits: ["MOUTH_BREATHING", "BRUXISM"], midlineDeviationMm: 0 }, null);
  assert.equal(f.detalle.funcional.respiracion, "oral");
  assert.deepEqual(f.habits, ["BRUXISM"]);
  assert.equal(f.detalle.oclusal.lineaMediaSuperior, "centrada");

  f.detalle.oclusal.lineaMediaInferior = "izquierda";
  f.detalle.oclusal.lineaMediaInferiorMm = 1.5;
  f.detalle.dentoalveolar.cruzadaPosterior = "unilateral-derecha";
  f.overjetMm = "";
  const r = formularioAPeticion(f);
  assert.equal(r.ok, true);
  const p = (r as { peticion: PeticionDelDiagnostico }).peticion;
  assert.equal(p.midlineDeviationMm, -1.5);
  assert.equal(p.crossbite, true);
  assert.equal(p.openBite, undefined, "sin dato de mordida abierta no se toca la columna");
  assert.equal("overjetMm" in p, false, "vaciar el campo no borra la columna NOT NULL");
  assert.equal(p.overbiteMm, 2);
  assert.deepEqual(p.habits, ["BRUXISM"]);
});

test("formulario: errores llevan a su sección; al abrir el caso el resumen puede esperar", () => {
  const f = formularioVacio();
  const editar = formularioAPeticion(f, "editar");
  assert.equal(editar.ok, false);
  assert.equal((editar as { seccion: string }).seccion, "resumen");
  assert.equal(formularioAPeticion(f, "abrir").ok, true);
  f.clinicalSummary = "corto";
  assert.equal((formularioAPeticion(f, "abrir") as { seccion: string }).seccion, "resumen");
  f.clinicalSummary = "x".repeat(40);
  f.overjetMm = "abc";
  assert.equal((formularioAPeticion(f) as { seccion: string }).seccion, "clasificacion");
  f.overjetMm = "3";
  f.detalle.cefalometria.anb = 99;
  assert.equal((formularioAPeticion(f) as { seccion: string }).seccion, "cefalometria");
});

test("avance del paso y qué le falta al diagnóstico", () => {
  const f = formularioDesdeDiagnostico(BASE, null);
  const a = avanceDelPaso(f);
  assert.equal(a.clasificacion.llenos, 6);
  assert.equal(a.facial.llenos, 0);
  assert.equal(a.resumen.llenos, 1);
  assert.deepEqual(faltaDelDiagnostico(BASE, null), ["características faciales", "líneas medias", "tipo de respiración"]);
  assert.deepEqual(faltaDelDiagnostico(null, null), ["diagnóstico"]);
  const d = diagnosticoDetalleVacio();
  d.facial.cierreLabial = "competente";
  d.oclusal.lineaMediaSuperior = "centrada";
  d.funcional.respiracion = "nasal";
  assert.deepEqual(faltaDelDiagnostico(BASE, d), []);
});

test("para guardar los dos pasos juntos: hay cambios y entrada lista para el servidor", () => {
  const inicial = formularioDesdeDiagnostico(BASE, null);
  const f = structuredClone(inicial);
  assert.equal(hayCambiosEnElDiagnostico(inicial, f), false);
  f.overjetMm = "4";
  assert.equal(hayCambiosEnElDiagnostico(inicial, f), true);
  const e = entradaParaGuardar("dx1", f);
  assert.equal(e.ok, true);
  const entrada = (e as { entrada: { diagnosisId: string; overjetMm?: number } }).entrada;
  assert.equal(entrada.diagnosisId, "dx1");
  assert.equal(entrada.overjetMm, 4);
  f.overjetMm = "xx";
  const mal = entradaParaGuardar("dx1", f);
  assert.equal(mal.ok, false);
  assert.equal((mal as { seccion: string }).seccion, "clasificacion");
});
