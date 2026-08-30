/**
 * LAS CINCO CUENTAS DE LA EVALUACIÓN — Ola 6 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-evaluacion.test.ts
 *
 * (No hay `npm run test:edu-evaluacion`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos: `evaluacion-core.ts` recibe datos y
 * devuelve datos.
 *
 * Lo que fija este archivo:
 *  1. que los PESOS de una rúbrica sumen 100, y que el error se pueda leer;
 *  2. que la calificación final sea la MISMA que sacaría el docente con su
 *     calculadora — la discute el alumno, así que un redondeo distinto es
 *     una discusión perdida;
 *  3. que el AVANCE cuente lo que tiene que contar y NADA más (un caso
 *     transferido no cuenta para los dos alumnos);
 *  4. que las HORAS salgan de los sellos reales y que una cita cerrada al
 *     día siguiente no valga dieciocho horas;
 *  5. 🔴 que el semáforo diga POR QUÉ, y que un requisito cumplido de más
 *     no compense otro sin tocar;
 *  6. que el CSV no se pueda convertir en una fórmula de Excel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_ATRASO_LABELS,
  EDU_ATRASO_UMBRAL_VIGILAR,
  EDU_HORAS_MAX_MINUTOS_POR_CITA,
  EDU_WEIGHT_TOTAL,
  eduAppointmentMinutes,
  eduAtrasoVerdict,
  eduAverageScore,
  eduCaseCountsFor,
  eduClinicalHours,
  eduComputeFinalScore,
  eduCsvCell,
  eduCsvFile,
  eduCsvFileName,
  eduCsvRow,
  eduCurrentGrade,
  eduCycleFraction,
  eduHoursLabel,
  eduParseScoreX100,
  eduRequirementProgress,
  eduRubricWeightCheck,
  eduScaleCheck,
  eduScoreLabel,
  eduSemesterRangeCheck,
  parseEduSemaforo,
  type EduCountableCase,
  type EduRequirementSpec,
  type EduTimedAppointment,
} from "../evaluacion-core";

// ═════════════════════════════════════════════════════════════════════
// 1 · LOS PESOS SUMAN 100
// ═════════════════════════════════════════════════════════════════════

test("una rúbrica válida pasa", () => {
  const r = eduRubricWeightCheck([
    { name: "Aislamiento", weightPercent: 20 },
    { name: "Conformación", weightPercent: 30 },
    { name: "Obturación", weightPercent: 50 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.total, EDU_WEIGHT_TOTAL);
  assert.equal(r.detail, "");
});

test("🔴 si no suman 100, NO pasa — y el mensaje dice cuánto falta o sobra", () => {
  const falta = eduRubricWeightCheck([
    { name: "A", weightPercent: 30 },
    { name: "B", weightPercent: 30 },
  ]);
  assert.equal(falta.ok, false);
  assert.equal(falta.total, 60);
  assert.match(falta.detail, /faltan 40/);

  const sobra = eduRubricWeightCheck([
    { name: "A", weightPercent: 60 },
    { name: "B", weightPercent: 60 },
  ]);
  assert.equal(sobra.ok, false);
  assert.match(sobra.detail, /sobran 20/);
});

test("una rúbrica sin criterios no califica nada", () => {
  assert.equal(eduRubricWeightCheck([]).ok, false);
  assert.equal(eduRubricWeightCheck(undefined as never).ok, false);
});

test("un peso 0, negativo o con decimales se rebota nombrando el criterio", () => {
  for (const peso of [0, -5, 33.3, Number.NaN]) {
    const r = eduRubricWeightCheck([
      { name: "Aislamiento", weightPercent: peso },
      { name: "B", weightPercent: 50 },
    ]);
    assert.equal(r.ok, false, `peso ${peso} debería rebotarse`);
    assert.match(r.detail, /Aislamiento/);
  }
});

test("la escala la decide la escuela, dentro de un rango sensato", () => {
  assert.equal(eduScaleCheck(1, 10), null, "1–10 es válida");
  assert.equal(eduScaleCheck(0, 100), null, "0–100 también");
  assert.equal(eduScaleCheck(0, 5), null, "0–5 también");
  assert.ok(eduScaleCheck(10, 10), "el máximo tiene que ser mayor que el mínimo");
  assert.ok(eduScaleCheck(10, 1), "y no al revés");
  assert.ok(eduScaleCheck(0, 5000), "hay un techo");
  assert.ok(eduScaleCheck(0.5, 10), "enteros");
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LA CALIFICACIÓN FINAL
// ═════════════════════════════════════════════════════════════════════

test("la final es Σ(puntuación × peso) / 100, en enteros ×100", () => {
  // 8 × 20 % + 9 × 30 % + 7 × 50 % = 1,6 + 2,7 + 3,5 = 7,8
  const final = eduComputeFinalScore([
    { scoreX100: 800, weightPercent: 20 },
    { scoreX100: 900, weightPercent: 30 },
    { scoreX100: 700, weightPercent: 50 },
  ]);
  assert.equal(final, 780);
  assert.equal(eduScoreLabel(final), "7.8");
});

test("🔴 la división se hace UNA vez, al final (si no, el docente no cuadra)", () => {
  // Tres criterios de 33/33/34 con 10, 10 y 9: dividir por renglón y sumar
  // arrastraría un redondeo por cada uno.
  const final = eduComputeFinalScore([
    { scoreX100: 1000, weightPercent: 33 },
    { scoreX100: 1000, weightPercent: 33 },
    { scoreX100: 900, weightPercent: 34 },
  ]);
  // (1000·33 + 1000·33 + 900·34) / 100 = (33000 + 33000 + 30600)/100 = 966
  assert.equal(final, 966);
  assert.equal(eduScoreLabel(final), "9.66");
});

test("el redondeo es medio ARRIBA: un 7,995 sale 8", () => {
  const final = eduComputeFinalScore([{ scoreX100: 799.5 as number, weightPercent: 100 }]);
  assert.equal(final, 800);
});

test("una lista vacía o con pesos cero devuelve 0 en vez de NaN", () => {
  assert.equal(eduComputeFinalScore([]), 0);
  assert.equal(eduComputeFinalScore([{ scoreX100: 900, weightPercent: 0 }]), 0);
  assert.equal(eduComputeFinalScore(undefined as never), 0);
});

test("la puntuación se teclea con punto O con coma (en México se usan las dos)", () => {
  assert.equal(eduParseScoreX100("8", 0, 10), 800);
  assert.equal(eduParseScoreX100("8.5", 0, 10), 850);
  assert.equal(eduParseScoreX100("8,5", 0, 10), 850);
  assert.equal(eduParseScoreX100(9, 0, 10), 900);
});

test("una puntuación fuera de la escala o con basura se descarta", () => {
  assert.equal(eduParseScoreX100("11", 0, 10), null, "por encima del máximo");
  assert.equal(eduParseScoreX100("-1", 0, 10), null, "por debajo del mínimo");
  assert.equal(eduParseScoreX100("ocho", 0, 10), null);
  assert.equal(eduParseScoreX100("", 0, 10), null);
  assert.equal(eduParseScoreX100("8.555", 0, 10), null, "más de dos decimales");
});

test("la etiqueta se lee como una calificación, no como un entero raro", () => {
  assert.equal(eduScoreLabel(800), "8");
  assert.equal(eduScoreLabel(850), "8.5");
  assert.equal(eduScoreLabel(875), "8.75");
  assert.equal(eduScoreLabel(805), "8.05");
  assert.equal(eduScoreLabel(0), "0");
});

test("🔴 la calificación VIGENTE es la que nadie corrige", () => {
  const a = { id: "g1", correctsId: null };
  const b = { id: "g2", correctsId: "g1" };
  assert.equal(eduCurrentGrade([b, a])?.id, "g2");
  assert.equal(eduCurrentGrade([a])?.id, "g1");
  assert.equal(eduCurrentGrade([]), null);

  // Una cadena de tres: solo la última queda viva.
  const c = { id: "g3", correctsId: "g2" };
  assert.equal(eduCurrentGrade([c, b, a])?.id, "g3");
});

test("el promedio solo mezcla calificaciones de la MISMA escala", () => {
  const r = eduAverageScore([
    { finalScoreX100: 800, scaleMax: 10, current: true },
    { finalScoreX100: 900, scaleMax: 10, current: true },
    { finalScoreX100: 8500, scaleMax: 100, current: true },
  ]);
  // Promediar 8/10 con 85/100 daría 46,5, que no significa nada.
  assert.equal(r.averageX100, 850);
  assert.equal(r.scaleMax, 10);
  assert.equal(r.ignored, 1, "y se DICE cuántas quedaron fuera");
});

test("las calificaciones corregidas no entran en el promedio", () => {
  const r = eduAverageScore([
    { finalScoreX100: 500, scaleMax: 10, current: false },
    { finalScoreX100: 900, scaleMax: 10, current: true },
  ]);
  assert.equal(r.averageX100, 900);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL AVANCE
// ═════════════════════════════════════════════════════════════════════

const PROG = "prog_endo";

function req(over: Partial<EduRequirementSpec> = {}): EduRequirementSpec {
  return {
    id: "r1",
    name: "Endodoncias unirradiculares",
    programId: PROG,
    semesterFrom: null,
    semesterTo: null,
    procedureId: null,
    category: null,
    requiredCount: 8,
    onlyCompleted: true,
    ...over,
  };
}

function caso(over: Partial<EduCountableCase> = {}): EduCountableCase {
  return {
    id: "c1",
    programId: PROG,
    status: "COMPLETED",
    procedureId: null,
    procedureCategory: null,
    ...over,
  };
}

test("un caso de otra especialidad NUNCA cuenta", () => {
  assert.equal(eduCaseCountsFor(req(), caso({ programId: "prog_orto" })), false);
});

test("«solo terminados» hace lo que dice, y apagarlo también", () => {
  assert.equal(eduCaseCountsFor(req(), caso({ status: "IN_TREATMENT" })), false);
  assert.equal(
    eduCaseCountsFor(req({ onlyCompleted: false }), caso({ status: "IN_TREATMENT" })),
    true,
  );
});

test("🔴 un caso TRANSFERIDO no cuenta — ni para el que lo dejó ni para el que lo tomó", () => {
  // Si contara, el requisito se daría por cumplido a los DOS: al que
  // empezó y al que terminó.
  assert.equal(
    eduCaseCountsFor(req({ onlyCompleted: false }), caso({ status: "TRANSFERRED" })),
    false,
  );
  assert.equal(
    eduCaseCountsFor(req({ onlyCompleted: false }), caso({ status: "ABANDONED" })),
    false,
  );
});

test("un requisito por PROCEDIMIENTO exige ese procedimiento", () => {
  const r = req({ procedureId: "proc_endo1" });
  assert.equal(eduCaseCountsFor(r, caso({ procedureId: "proc_endo1" })), true);
  assert.equal(eduCaseCountsFor(r, caso({ procedureId: "proc_otro" })), false);
  assert.equal(
    eduCaseCountsFor(r, caso({ procedureId: null })),
    false,
    "un caso sin procedimiento no cuenta para un requisito que pide uno",
  );
});

test("un requisito por CATEGORÍA compara sin distinguir mayúsculas ni espacios", () => {
  const r = req({ category: "Endodoncia" });
  assert.equal(eduCaseCountsFor(r, caso({ procedureCategory: "endodoncia" })), true);
  assert.equal(eduCaseCountsFor(r, caso({ procedureCategory: " ENDODONCIA " })), true);
  assert.equal(eduCaseCountsFor(r, caso({ procedureCategory: "Prótesis" })), false);
  assert.equal(eduCaseCountsFor(r, caso({ procedureCategory: null })), false);
});

test("sin procedimiento ni categoría, cuenta cualquier caso de la especialidad", () => {
  assert.equal(eduCaseCountsFor(req(), caso()), true);
});

test("el avance dice CUÁNTOS FALTAN, con números claros", () => {
  const casos = [caso({ id: "a" }), caso({ id: "b" }), caso({ id: "c" })];
  const p = eduRequirementProgress(req({ requiredCount: 8 }), casos, 0.5);
  assert.equal(p.doneCount, 3);
  assert.equal(p.missingCount, 5);
  assert.equal(p.met, false);
  assert.equal(p.expectedCount, 4, "a mitad de ciclo se esperan 4 de 8");
  assert.match(p.detail, /Te faltan 5 de 8/);
});

test("cumplido de más sigue siendo cumplido, y no deja `missingCount` negativo", () => {
  const casos = Array.from({ length: 12 }, (_, i) => caso({ id: `c${i}` }));
  const p = eduRequirementProgress(req({ requiredCount: 8 }), casos, 1);
  assert.equal(p.doneCount, 12);
  assert.equal(p.missingCount, 0);
  assert.equal(p.met, true);
  assert.match(p.detail, /Cumplido: 12 de 8/);
});

test("sin fracción de ciclo no se inventa lo esperado", () => {
  const p = eduRequirementProgress(req(), [caso()], null);
  assert.equal(p.expectedCount, 0);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · LAS HORAS CLÍNICAS
// ═════════════════════════════════════════════════════════════════════

function cita(over: Partial<EduTimedAppointment> = {}): EduTimedAppointment {
  return {
    status: "COMPLETED",
    startsAt: "2026-03-02T15:00:00.000Z",
    endsAt: "2026-03-02T16:00:00.000Z",
    checkedInAt: null,
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

test("solo cuentan las citas COMPLETADAS", () => {
  for (const status of ["SCHEDULED", "CANCELLED", "NO_SHOW", "IN_CHAIR"]) {
    assert.equal(eduAppointmentMinutes(cita({ status })).minutes, 0, status);
  }
});

test("los minutos salen del tiempo EN EL SILLÓN cuando hay sellos", () => {
  const m = eduAppointmentMinutes(
    cita({
      checkedInAt: "2026-03-02T14:30:00.000Z",
      startedAt: "2026-03-02T15:00:00.000Z",
      completedAt: "2026-03-02T16:30:00.000Z",
    }),
  );
  assert.equal(m.minutes, 90, "de las 15:00 a las 16:30, no desde que llegó");
  assert.equal(m.real, true);
});

test("sin sello de inicio se usa la llegada, y sigue contando como real", () => {
  const m = eduAppointmentMinutes(
    cita({ checkedInAt: "2026-03-02T14:30:00.000Z", completedAt: "2026-03-02T16:00:00.000Z" }),
  );
  assert.equal(m.minutes, 90);
  assert.equal(m.real, true);
});

test("sin ningún sello se cae a la duración AGENDADA, y se marca como estimada", () => {
  const m = eduAppointmentMinutes(cita());
  assert.equal(m.minutes, 60);
  assert.equal(m.real, false, "la pantalla tiene que poder decir que este número es estimado");
});

test("🔴 una cita cerrada a la mañana siguiente NO vale dieciocho horas", () => {
  const m = eduAppointmentMinutes(
    cita({
      startedAt: "2026-03-02T15:00:00.000Z",
      completedAt: "2026-03-03T09:00:00.000Z",
    }),
  );
  assert.equal(m.minutes, EDU_HORAS_MAX_MINUTOS_POR_CITA);
  assert.equal(m.capped, true, "y se DICE cuántas se recortaron, para poder ir a arreglarlas");
});

test("la suma separa lo real de lo estimado y cuenta las recortadas", () => {
  const h = eduClinicalHours([
    cita({ startedAt: "2026-03-02T15:00:00.000Z", completedAt: "2026-03-02T16:00:00.000Z" }),
    cita(),
    cita({ startedAt: "2026-03-02T08:00:00.000Z", completedAt: "2026-03-03T08:00:00.000Z" }),
    cita({ status: "CANCELLED" }),
  ]);
  assert.equal(h.appointments, 3, "la cancelada no cuenta");
  assert.equal(h.realMinutes, 60 + EDU_HORAS_MAX_MINUTOS_POR_CITA);
  assert.equal(h.estimatedMinutes, 60);
  assert.equal(h.estimatedAppointments, 1);
  assert.equal(h.cappedAppointments, 1);
  assert.equal(h.totalMinutes, h.realMinutes + h.estimatedMinutes);
});

test("una fecha ilegible o al revés no resta horas", () => {
  assert.equal(
    eduAppointmentMinutes(cita({ startedAt: "no soy fecha", completedAt: "tampoco" })).minutes,
    60,
    "cae a la duración agendada",
  );
  assert.equal(
    eduAppointmentMinutes(
      cita({
        startsAt: "2026-03-02T16:00:00.000Z",
        endsAt: "2026-03-02T15:00:00.000Z",
      }),
    ).minutes,
    0,
    "una duración negativa vale cero, no menos que cero",
  );
});

test("las horas se leen como las lee una persona", () => {
  assert.equal(eduHoursLabel(0), "0 h");
  assert.equal(eduHoursLabel(45), "45 min");
  assert.equal(eduHoursLabel(60), "1 h");
  assert.equal(eduHoursLabel(545), "9 h 5 min");
});

// ═════════════════════════════════════════════════════════════════════
// 5 · 🔴 EL SEMÁFORO, Y SU PORQUÉ
// ═════════════════════════════════════════════════════════════════════

const INICIO = new Date("2026-01-01T00:00:00.000Z");
const FIN = new Date("2026-12-31T00:00:00.000Z");

test("la fracción del ciclo sale de las fechas de la generación", () => {
  const cohort = { startDate: INICIO, endDate: FIN };
  assert.equal(eduCycleFraction(cohort, INICIO), 0);
  assert.equal(eduCycleFraction(cohort, FIN), 1);
  const mitad = eduCycleFraction(cohort, new Date("2026-07-02T00:00:00.000Z"));
  assert.ok(mitad !== null && mitad > 0.49 && mitad < 0.51, `mitad = ${mitad}`);
});

test("🔴 sin fechas NO se inventa una duración: se devuelve null", () => {
  // Un semáforo rojo sobre un alumno por un dato que la escuela nunca
  // capturó es un rojo que alguien le va a enseñar a ese alumno.
  assert.equal(eduCycleFraction({ startDate: INICIO, endDate: null }, FIN), null);
  assert.equal(eduCycleFraction({ startDate: null, endDate: FIN }, FIN), null);
  assert.equal(eduCycleFraction({ startDate: FIN, endDate: INICIO }, FIN), null, "al revés");
});

test("fuera del ciclo, la fracción se queda entre 0 y 1", () => {
  const cohort = { startDate: INICIO, endDate: FIN };
  assert.equal(eduCycleFraction(cohort, new Date("2025-01-01T00:00:00.000Z")), 0);
  assert.equal(eduCycleFraction(cohort, new Date("2030-01-01T00:00:00.000Z")), 1);
});

function progreso(done: number, required: number, name = "R") {
  return eduRequirementProgress(
    { ...req({ requiredCount: required, name }), id: name },
    Array.from({ length: done }, (_, i) => caso({ id: `${name}${i}` })),
    0.5,
  );
}

test("al día: lleva lo que se esperaba a esta altura, o más", () => {
  const v = eduAtrasoVerdict([progreso(5, 8)], 0.5);
  assert.equal(v.estado, "AL_DIA");
  assert.match(v.motivo, /50 % del ciclo/);
});

test("atrasado: muy por debajo de lo esperado", () => {
  const v = eduAtrasoVerdict([progreso(1, 8)], 0.5);
  assert.equal(v.estado, "ATRASADO");
});

test("vigilar: por debajo, pero todavía alcanza", () => {
  // Esperados = 8 × 0,5 = 4. Con 3 hechos, ratio = 0,75 → justo el umbral.
  const v = eduAtrasoVerdict([progreso(3, 8)], 0.5);
  assert.equal(v.estado, "VIGILAR");
  assert.equal(EDU_ATRASO_UMBRAL_VIGILAR, 0.75);
});

test("🔴 EL MOTIVO SE PUEDE LEER EN VOZ ALTA delante del alumno", () => {
  const v = eduAtrasoVerdict([progreso(1, 8, "Endodoncias"), progreso(0, 4, "Prótesis")], 0.5);
  assert.equal(v.estado, "ATRASADO");
  // Tiene que decir cuánto del ciclo va, qué se esperaba, qué lleva y QUÉ
  // le falta con nombre y apellido. Un semáforo rojo sin esto no sirve
  // para hablar con nadie.
  assert.match(v.motivo, /50 %/);
  assert.match(v.motivo, /se esperan 6 de 12/);
  assert.match(v.motivo, /lleva 1/);
  assert.match(v.motivo, /Endodoncias \(1 de 8\)/);
  assert.match(v.motivo, /Prótesis \(0 de 4\)/);
});

test("🔴 un requisito cumplido DE MÁS no compensa otro sin tocar", () => {
  // 20 endodoncias de las 8 que pedía + 0 prótesis de 4.
  // Sin tope, 20/6 daría "al día" con medio plan sin empezar.
  const v = eduAtrasoVerdict([progreso(20, 8, "Endodoncias"), progreso(0, 4, "Prótesis")], 0.5);
  assert.equal(v.hechos, 8, "lo cumplido se topa por requisito");
  assert.equal(v.totales, 12);
  assert.equal(v.esperados, 6);
  assert.equal(v.estado, "AL_DIA", "8 de 6 esperados sí está al día…");

  // …pero con la prótesis pesando más, el tope sí muerde:
  const v2 = eduAtrasoVerdict([progreso(20, 4, "Endo"), progreso(0, 16, "Prótesis")], 0.5);
  assert.equal(v2.hechos, 4);
  assert.equal(v2.esperados, 10);
  assert.equal(v2.estado, "ATRASADO");
});

test("los faltantes salen ordenados por la deuda más grande", () => {
  const v = eduAtrasoVerdict(
    [progreso(1, 3, "Poco"), progreso(0, 10, "Mucho"), progreso(3, 3, "Hecho")],
    0.5,
  );
  assert.deepEqual(
    v.faltantes.map((f) => f.name),
    ["Mucho", "Poco"],
    "el cumplido no sale, y el que más falta va primero",
  );
});

test("🔴 sin fechas el semáforo NO se pinta, y se dice qué arreglar", () => {
  const v = eduAtrasoVerdict([progreso(1, 8)], null);
  assert.equal(v.estado, null);
  assert.match(v.motivo, /fecha/);
  assert.match(v.motivo, /generaciones/i);
});

test("un alumno sin requisitos capturados sale AL DÍA y lo explica", () => {
  const v = eduAtrasoVerdict([], 0.5);
  assert.equal(v.estado, "AL_DIA");
  assert.match(v.motivo, /todavía no tiene requisitos/i);
});

test("al principio del ciclo no se le espera nada", () => {
  const v = eduAtrasoVerdict([progreso(0, 8)], 0);
  assert.equal(v.estado, "AL_DIA");
  assert.match(v.motivo, /apenas empieza/);
});

test("los tres estados tienen etiqueta en español (la UI no pinta el enum)", () => {
  assert.equal(EDU_ATRASO_LABELS.AL_DIA, "Al día");
  assert.equal(EDU_ATRASO_LABELS.VIGILAR, "Vigilar");
  assert.equal(EDU_ATRASO_LABELS.ATRASADO, "Atrasado");
});

test("el filtro del semáforo descarta lo que no reconoce", () => {
  assert.equal(parseEduSemaforo("ATRASADO"), "ATRASADO");
  assert.equal(parseEduSemaforo("sin_calcular"), "SIN_CALCULAR");
  assert.equal(parseEduSemaforo("REPROBADO"), null);
  assert.equal(parseEduSemaforo(null), null);
});

test("un rango de semestres al revés se rebota", () => {
  assert.equal(eduSemesterRangeCheck(1, 4), null);
  assert.equal(eduSemesterRangeCheck(null, 4), null);
  assert.ok(eduSemesterRangeCheck(5, 2));
});

// ═════════════════════════════════════════════════════════════════════
// 6 · LA EXPORTACIÓN
// ═════════════════════════════════════════════════════════════════════

test("una celda normal se entrecomilla", () => {
  assert.equal(eduCsvCell("María Rodríguez"), '"María Rodríguez"');
  assert.equal(eduCsvCell(8), '"8"');
  assert.equal(eduCsvCell(null), '""');
});

test("las comillas de dentro se duplican (si no, la fila se parte)", () => {
  assert.equal(eduCsvCell('dijo "no"'), '"dijo ""no"""');
});

test("los saltos de línea se aplanan", () => {
  assert.equal(eduCsvCell("una\ndos"), '"una dos"');
  assert.equal(eduCsvCell("una\r\ndos"), '"una dos"');
});

test("🔴 una celda que empieza con = + - @ NO se convierte en fórmula de Excel", () => {
  // Un apellido "-Ortiz" basta para que la hoja de una acreditación abra
  // con errores por toda la columna. Y una celda preparada a mala fe puede
  // llegar más lejos que eso.
  for (const malo of ["=1+1", "+1", "-Ortiz", "@SUM(A1)"]) {
    const salida = eduCsvCell(malo);
    assert.ok(salida.startsWith(`"'`), `${malo} salió sin apóstrofo: ${salida}`);
  }
});

test("la fila junta las celdas con coma", () => {
  assert.equal(eduCsvRow(["a", "b"]), '"a","b"');
});

test("el archivo lleva BOM para que Excel no rompa los acentos", () => {
  const f = eduCsvFile([eduCsvRow(["Rodríguez"])]);
  assert.equal(f.charCodeAt(0), 0xfeff);
  assert.ok(f.endsWith("\r\n"));
});

test("el nombre del archivo sale sin acentos ni espacios", () => {
  assert.equal(
    eduCsvFileName("A-01 María Rodríguez", "2026-03-01"),
    "bitacora-a-01-maria-rodriguez-2026-03-01.csv",
  );
  assert.equal(eduCsvFileName("", "2026-03-01"), "bitacora-alumno-2026-03-01.csv");
});
