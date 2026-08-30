/**
 * DaleControl INSTITUCIONAL — el cerebro de la EVALUACIÓN, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa). Aquí viven las cinco cuentas que,
 * si se escriben dos veces, terminan discrepando — y una calificación que
 * discrepa entre la pantalla del alumno y el acta de la dirección es una
 * discusión que la escuela pierde:
 *
 *   1. LOS PESOS de una rúbrica suman 100         → eduRubricWeightCheck
 *   2. LA CALIFICACIÓN FINAL de un caso           → eduComputeFinalScore
 *   3. EL AVANCE contra un requisito              → eduRequirementProgress
 *   4. LAS HORAS clínicas de una cita             → eduAppointmentMinutes
 *   5. SI UN ALUMNO VA ATRASADO, y POR QUÉ        → eduAtrasoVerdict
 *
 * Todo se prueba SIN Postgres (src/lib/edu/__tests__/edu-evaluacion.test.ts):
 * son funciones que reciben datos y devuelven datos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LOS NÚMEROS VAN EN ENTEROS ×100, NO EN COMA FLOTANTE.
 *
 * Misma razón que el dinero de la Ola 5 va en centavos: en coma flotante
 * 0,1 + 0,2 no da 0,3, y un promedio de veinte casos acumula ese error
 * hasta que el acta que se imprime no cuadra con la pantalla. Un 8,75 es
 * 875. La división se hace UNA vez, al final, y se redondea a propósito
 * (ver eduComputeFinalScore).
 *
 * 🔴 EL AVANCE NO SE GUARDA: SE CUENTA.
 *
 * No hay ninguna función aquí que escriba un contador, y no hay ninguna
 * columna donde escribirlo. Un "cumplidos: 5" guardado se desincroniza el
 * día que una escritura falle a la mitad o que alguien cierre un caso por
 * SQL — y el número que se enseña en una acreditación es justamente ése.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduCaseStatus } from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 0 · TOPES Y CONSTANTES
//
// Cada uno empata con el `@db.VarChar` o el rango de su columna: si aquí
// fueran más grandes, la base rebotaría la escritura con un error de
// Postgres en vez de un mensaje escrito para una persona.
// ═══════════════════════════════════════════════════════════════════════

export const EDU_RUBRIC_NAME_MAX = 120;
export const EDU_RUBRIC_NOTES_MAX = 300;
export const EDU_CRITERION_NAME_MAX = 120;
export const EDU_CRITERION_DESC_MAX = 500;
export const EDU_GRADE_COMMENT_MAX = 2000;
export const EDU_GRADE_ITEM_COMMENT_MAX = 1000;
export const EDU_REQUIREMENT_NAME_MAX = 120;
export const EDU_REQUIREMENT_NOTES_MAX = 300;
export const EDU_REQUIREMENT_CATEGORY_MAX = 60;
export const EDU_TRANSFER_REASON_MAX = 500;

/** Techo de filas por consulta. Una escuela tiene decenas de rúbricas y de
 *  requisitos, no miles; el tope está para que una consulta rota no se
 *  traiga la tabla entera. */
export const EDU_EVALUACION_MAX_ROWS = 300;

/** Cuántos criterios admite una rúbrica. Veinte ya es una rúbrica que
 *  nadie llena de pie con guantes; el tope evita el formulario infinito. */
export const EDU_RUBRIC_MAX_CRITERIA = 20;

/** Cuántos casos se pueden traspasar de una sentada. Al cerrar una
 *  generación son decenas — cien es holgado y a la vez impide que un
 *  cliente equivocado mande diez mil ids en un POST. */
export const EDU_TRANSFER_MAX_BATCH = 100;

/** Lo máximo que puede pedir un requisito. Nadie exige 500 endodoncias, y
 *  el tope impide que un dedazo deje a toda una generación "atrasada". */
export const EDU_REQUIREMENT_MAX_COUNT = 999;

/**
 * Los extremos que admite la escala de una rúbrica.
 *
 * 🔴 El producto NO tiene un 100 escrito a mano en ninguna parte: la
 * escala la decide la escuela (1–10, 0–100, 0–5) y se lee de la rúbrica.
 * Esto es solo el rango de lo que se puede capturar.
 */
export const EDU_SCALE_MIN_ALLOWED = 0;
export const EDU_SCALE_MAX_ALLOWED = 1000;

/**
 * Lo máximo que cuenta UNA cita como hora clínica.
 *
 * 🔴 Existe por un fallo real y muy fácil: el alumno termina, se va, y
 * marca la cita como terminada a la mañana siguiente. Sin tope, esa cita
 * valdría dieciocho horas y el expediente académico diría que hizo una
 * jornada doble. Con tope, la pantalla dice cuántas citas se recortaron y
 * por qué — que es lo que permite ir a arreglarlas.
 */
export const EDU_HORAS_MAX_MINUTOS_POR_CITA = 8 * 60;

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS PESOS DE LA RÚBRICA
// ═══════════════════════════════════════════════════════════════════════

/** El total al que tienen que sumar los pesos de una rúbrica. */
export const EDU_WEIGHT_TOTAL = 100;

export interface EduWeightedCriterion {
  name: string;
  weightPercent: number;
}

export interface EduRubricWeightCheck {
  ok: boolean;
  total: number;
  /** Qué decirle a quien está capturando. Vacío si está bien. */
  detail: string;
}

/**
 * ¿Los pesos suman 100?
 *
 * 🔴 Esto se llama AL GUARDAR LA RÚBRICA, no al calificar, y esa decisión
 * es de producto: si se validara al calificar, el error saldría con el
 * paciente ya atendido, el docente de pie y el alumno esperando, y la
 * única salida sería no calificar. Validado al guardar, el que se equivoca
 * es quien diseña la rúbrica, sentado, y lo arregla ahí mismo.
 *
 * Sin tolerancias: los pesos son enteros (ver el comentario del modelo),
 * así que 100 es 100. Una rúbrica de tres criterios "iguales" se captura
 * 34/33/33 y no 33,33 tres veces.
 */
export function eduRubricWeightCheck(criteria: EduWeightedCriterion[]): EduRubricWeightCheck {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return {
      ok: false,
      total: 0,
      detail: "Una rúbrica sin criterios no califica nada. Agrega al menos uno.",
    };
  }
  if (criteria.length > EDU_RUBRIC_MAX_CRITERIA) {
    return {
      ok: false,
      total: 0,
      detail: `Son demasiados criterios (${criteria.length}). El máximo es ${EDU_RUBRIC_MAX_CRITERIA}: una rúbrica más larga que eso no se llena de pie en el piso clínico.`,
    };
  }

  let total = 0;
  for (const c of criteria) {
    const w = c?.weightPercent;
    if (!Number.isInteger(w) || w <= 0) {
      return {
        ok: false,
        total: 0,
        detail: `El peso de "${c?.name || "un criterio"}" tiene que ser un número entero mayor que cero.`,
      };
    }
    total += w;
  }

  if (total !== EDU_WEIGHT_TOTAL) {
    const sobra = total - EDU_WEIGHT_TOTAL;
    return {
      ok: false,
      total,
      detail:
        sobra > 0
          ? `Los pesos suman ${total} %: sobran ${sobra} puntos. Tienen que sumar exactamente ${EDU_WEIGHT_TOTAL}.`
          : `Los pesos suman ${total} %: faltan ${-sobra} puntos. Tienen que sumar exactamente ${EDU_WEIGHT_TOTAL}.`,
    };
  }

  return { ok: true, total, detail: "" };
}

/** ¿La escala de la rúbrica tiene sentido? */
export function eduScaleCheck(scaleMin: number, scaleMax: number): string | null {
  if (!Number.isInteger(scaleMin) || !Number.isInteger(scaleMax)) {
    return "La escala se captura con números enteros (por ejemplo, de 1 a 10 o de 0 a 100).";
  }
  if (scaleMin < EDU_SCALE_MIN_ALLOWED || scaleMax > EDU_SCALE_MAX_ALLOWED) {
    return `La escala tiene que estar entre ${EDU_SCALE_MIN_ALLOWED} y ${EDU_SCALE_MAX_ALLOWED}.`;
  }
  if (scaleMax - scaleMin < 1) {
    return "El máximo de la escala tiene que ser mayor que el mínimo.";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA CALIFICACIÓN FINAL
// ═══════════════════════════════════════════════════════════════════════

export interface EduScoredCriterion {
  /** La puntuación en la escala de la rúbrica, ENTERA ×100 (8,5 → 850). */
  scoreX100: number;
  weightPercent: number;
}

/**
 * Σ(puntuación × peso) / 100, en enteros ×100.
 *
 * La división se hace UNA sola vez y al final: dividir criterio por
 * criterio y sumar después arrastra un redondeo por renglón, y con seis
 * criterios eso ya son décimas de diferencia con lo que enseña la
 * calculadora del docente.
 *
 * El redondeo es "medio arriba" (Math.round) a propósito y no truncado: un
 * 7,995 tiene que salir 8,00 y no 7,99, porque el alumno va a hacer la
 * cuenta a mano y la va a discutir.
 *
 * ⚠️ Asume pesos válidos (suman 100). Si no suman, devuelve el promedio
 * ponderado por lo que HAY —no inventa un 100 que no existe— y quien lo
 * llama ya validó con eduRubricWeightCheck al guardar la rúbrica.
 */
export function eduComputeFinalScore(items: EduScoredCriterion[]): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let puntos = 0;
  let pesos = 0;
  for (const it of items) {
    const score = Number.isFinite(it?.scoreX100) ? it.scoreX100 : 0;
    const w = Number.isFinite(it?.weightPercent) ? it.weightPercent : 0;
    puntos += score * w;
    pesos += w;
  }
  if (pesos <= 0) return 0;
  return Math.round(puntos / pesos);
}

/**
 * Una puntuación ×100 tal como llega de un formulario ("8", "8.5", "8,5").
 *
 * Devuelve null cuando no es un número o se sale de la escala. La coma
 * decimal se acepta: en México se teclea "8,5" tanto como "8.5", y
 * rebotarlo sería un error que la persona no entiende.
 */
export function eduParseScoreX100(
  raw: unknown,
  scaleMin: number,
  scaleMax: number,
): number | null {
  if (raw === null || raw === undefined) return null;
  const texto = String(raw).trim().replace(",", ".");
  if (!texto || !/^-?\d+(\.\d{1,2})?$/.test(texto)) return null;
  const valor = Math.round(Number(texto) * 100);
  if (!Number.isFinite(valor)) return null;
  if (valor < scaleMin * 100 || valor > scaleMax * 100) return null;
  return valor;
}

/** Un número ×100 como se lee en pantalla: 875 → "8.75", 800 → "8". */
export function eduScoreLabel(x100: number): string {
  if (!Number.isFinite(x100)) return "—";
  const entero = Math.trunc(x100 / 100);
  const resto = Math.abs(x100 % 100);
  if (resto === 0) return String(entero);
  const dec = resto % 10 === 0 ? String(resto / 10) : String(resto).padStart(2, "0");
  return `${entero}.${dec}`;
}

/** "8.75 / 10" — la calificación SIEMPRE con su escala al lado. Un 8 sin
 *  escala no dice nada cuando la escuela de al lado califica sobre 100. */
export function eduScoreWithScale(x100: number, scaleMax: number): string {
  return `${eduScoreLabel(x100)} / ${scaleMax}`;
}

/**
 * La calificación VIGENTE de una lista: la fila que nadie corrige.
 *
 * 🔴 Se DERIVA, no se guarda. Igual que en la Ola 4 el estado del gate se
 * lee de las autorizaciones en vez de vivir en una bandera del caso: una
 * bandera hay que mantenerla sincronizada con las filas, y el día que
 * discrepen gana la bandera, que es la que no tiene ni firma ni fecha.
 */
export function eduCurrentGrade<T extends { id: string; correctsId: string | null }>(
  grades: T[],
): T | null {
  if (!Array.isArray(grades) || grades.length === 0) return null;
  const corregidas = new Set(
    grades.map((g) => g.correctsId).filter((id): id is string => typeof id === "string"),
  );
  const vivas = grades.filter((g) => !corregidas.has(g.id));
  // Si por un dato raro quedaran varias, gana la última: el orden lo pone
  // quien consulta (gradedAt desc) y no un desempate inventado aquí.
  return vivas[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS REQUISITOS Y EL AVANCE
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo de un requisito para poder contarlo. */
export interface EduRequirementSpec {
  id: string;
  name: string;
  programId: string;
  semesterFrom: number | null;
  semesterTo: number | null;
  procedureId: string | null;
  category: string | null;
  requiredCount: number;
  onlyCompleted: boolean;
}

/** Lo mínimo de un caso para saber si cuenta. */
export interface EduCountableCase {
  id: string;
  programId: string;
  status: EduCaseStatus;
  procedureId: string | null;
  /** La categoría del procedimiento del caso, si tiene procedimiento. */
  procedureCategory: string | null;
}

/**
 * ¿ESTE caso cuenta para ESTE requisito?
 *
 * Las tres condiciones, en orden:
 *   1. la especialidad tiene que coincidir;
 *   2. si el requisito pide un procedimiento, el caso tiene que traer ESE;
 *      si pide una categoría, el procedimiento del caso tiene que ser de
 *      esa categoría; si no pide ninguno, cuenta cualquier caso;
 *   3. si el requisito solo cuenta COMPLETADOS, el caso tiene que estarlo.
 *
 * 🔴 UN CASO SIN PROCEDIMIENTO NO CUENTA para un requisito que pide uno, y
 * eso NO se disimula: la pantalla del alumno lista los casos sin clasificar
 * aparte ("tienes 4 casos sin procedimiento: no cuentan para ningún
 * requisito"). Contarlos "por si acaso" es cómo se gradúa alguien que no
 * hizo lo que dice que hizo; esconderlos es cómo se pasa un semestre
 * creyendo que no avanzas.
 *
 * 🔴 UN CASO TRANSFERIDO NO CUENTA. El caso se cerró como TRANSFERRED
 * porque el alumno lo entregó a medias: contarlo daría el requisito por
 * cumplido a los DOS, al que empezó y al que terminó.
 */
export function eduCaseCountsFor(
  req: EduRequirementSpec,
  caso: EduCountableCase,
): boolean {
  if (!req || !caso) return false;
  if (caso.programId !== req.programId) return false;
  if (caso.status === "TRANSFERRED" || caso.status === "ABANDONED") return false;
  if (req.onlyCompleted && caso.status !== "COMPLETED") return false;

  if (req.procedureId) return caso.procedureId === req.procedureId;
  if (req.category) {
    if (!caso.procedureCategory) return false;
    return caso.procedureCategory.trim().toLowerCase() === req.category.trim().toLowerCase();
  }
  return true;
}

export interface EduRequirementProgress {
  requirementId: string;
  name: string;
  requiredCount: number;
  doneCount: number;
  /** Lo que falta, nunca negativo. */
  missingCount: number;
  /** Ya está: doneCount >= requiredCount. */
  met: boolean;
  /** Cuántos se esperaban A ESTA ALTURA del ciclo (ver eduAtrasoVerdict). */
  expectedCount: number;
  /** En una frase, para la pantalla del alumno. */
  detail: string;
  onlyCompleted: boolean;
  semesterFrom: number | null;
  semesterTo: number | null;
}

/**
 * El avance de UN requisito, contando los casos que encajan.
 *
 * `fraccionDelCiclo` es cuánto ha transcurrido de la generación (0..1) y
 * decide cuántos se ESPERAN a esta altura. Se pasa desde fuera —lo calcula
 * eduCycleFraction con las fechas de EduCohort— para que esta función siga
 * siendo pura y comprobable sin reloj.
 */
export function eduRequirementProgress(
  req: EduRequirementSpec,
  casos: EduCountableCase[],
  fraccionDelCiclo: number | null,
): EduRequirementProgress {
  const done = (casos ?? []).filter((c) => eduCaseCountsFor(req, c)).length;
  const required = Math.max(0, req.requiredCount);
  const missing = Math.max(0, required - done);
  const met = done >= required;

  const expected =
    fraccionDelCiclo === null ? 0 : Math.round(required * clamp01(fraccionDelCiclo));

  const queCuenta = req.procedureId
    ? "de ese procedimiento"
    : req.category
      ? `de la categoría ${req.category}`
      : "de la especialidad";
  const comoCuenta = req.onlyCompleted ? "casos terminados" : "casos abiertos o terminados";

  const detail = met
    ? `Cumplido: ${done} de ${required} ${comoCuenta} ${queCuenta}.`
    : `Te faltan ${missing} de ${required}. Llevas ${done} ${comoCuenta} ${queCuenta}.`;

  return {
    requirementId: req.id,
    name: req.name,
    requiredCount: required,
    doneCount: done,
    missingCount: missing,
    met,
    expectedCount: expected,
    detail,
    onlyCompleted: req.onlyCompleted,
    semesterFrom: req.semesterFrom,
    semesterTo: req.semesterTo,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LAS HORAS CLÍNICAS
//
// 🔴 SE DERIVAN. No hay captura manual y no hay tabla: unas horas que se
// teclean son unas horas que se pueden teclear mal, y son exactamente las
// que una acreditación mira con lupa.
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo de una cita para poder contar sus minutos. */
export interface EduTimedAppointment {
  status: string;
  startsAt: Date | string;
  endsAt: Date | string;
  checkedInAt: Date | string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
}

export interface EduAppointmentMinutes {
  minutes: number;
  /** true = salió de sellos REALES; false = de la duración agendada. */
  real: boolean;
  /** true = se recortó al tope por cita (alguien cerró la cita tardísimo). */
  capped: boolean;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Cuántos minutos clínicos vale UNA cita.
 *
 * Solo cuentan las COMPLETADAS: una cancelada no se trabajó, y una a la
 * que el paciente no llegó tampoco.
 *
 * De dónde salen los minutos, en este orden:
 *   1. `startedAt` → `completedAt`: el tiempo EN EL SILLÓN, que es la hora
 *      clínica de verdad.
 *   2. `checkedInAt` → `completedAt`: si nadie marcó el inicio del
 *      tratamiento. Incluye la espera, y se sabe: por eso `real` sigue
 *      siendo true pero la pantalla dice cuántas citas usaron este camino.
 *   3. `startsAt` → `endsAt`: la duración AGENDADA. Es una estimación y se
 *      marca como tal (`real: false`) — la pantalla enseña los dos números
 *      por separado en vez de sumarlos y callarse.
 *
 * 🔴 Y el tope: ninguna cita vale más de EDU_HORAS_MAX_MINUTOS_POR_CITA.
 * Cerrar la cita a la mañana siguiente es un fallo REAL y frecuente, y sin
 * tope una sola cita le regalaría una jornada doble al expediente
 * académico del alumno.
 */
export function eduAppointmentMinutes(a: EduTimedAppointment): EduAppointmentMinutes {
  const vacio: EduAppointmentMinutes = { minutes: 0, real: false, capped: false };
  if (!a || a.status !== "COMPLETED") return vacio;

  const fin = toDate(a.completedAt);
  const enSillon = toDate(a.startedAt);
  const llegada = toDate(a.checkedInAt);

  let bruto: number | null = null;
  let real = false;

  if (fin && enSillon && fin.getTime() > enSillon.getTime()) {
    bruto = fin.getTime() - enSillon.getTime();
    real = true;
  } else if (fin && llegada && fin.getTime() > llegada.getTime()) {
    bruto = fin.getTime() - llegada.getTime();
    real = true;
  } else {
    const ini = toDate(a.startsAt);
    const term = toDate(a.endsAt);
    if (ini && term && term.getTime() > ini.getTime()) {
      bruto = term.getTime() - ini.getTime();
      real = false;
    }
  }

  if (bruto === null || bruto <= 0) return vacio;

  const minutos = Math.round(bruto / 60000);
  if (minutos > EDU_HORAS_MAX_MINUTOS_POR_CITA) {
    return { minutes: EDU_HORAS_MAX_MINUTOS_POR_CITA, real, capped: true };
  }
  return { minutes: minutos, real, capped: false };
}

export interface EduClinicalHours {
  /** Minutos con sello real (en el sillón o desde que llegó). */
  realMinutes: number;
  /** Minutos que salieron de la duración AGENDADA, por falta de sellos. */
  estimatedMinutes: number;
  totalMinutes: number;
  /** Cuántas citas completadas se contaron. */
  appointments: number;
  /** Cuántas de ellas no tenían sellos y se estimaron. */
  estimatedAppointments: number;
  /** Cuántas se recortaron al tope (alguien las cerró tardísimo). */
  cappedAppointments: number;
}

export const EDU_CLINICAL_HOURS_EMPTY: EduClinicalHours = {
  realMinutes: 0,
  estimatedMinutes: 0,
  totalMinutes: 0,
  appointments: 0,
  estimatedAppointments: 0,
  cappedAppointments: 0,
};

/** Suma las horas de una lista de citas, separando lo real de lo estimado. */
export function eduClinicalHours(citas: EduTimedAppointment[]): EduClinicalHours {
  const out: EduClinicalHours = { ...EDU_CLINICAL_HOURS_EMPTY };
  for (const c of citas ?? []) {
    const m = eduAppointmentMinutes(c);
    if (m.minutes <= 0) continue;
    out.appointments += 1;
    if (m.real) out.realMinutes += m.minutes;
    else {
      out.estimatedMinutes += m.minutes;
      out.estimatedAppointments += 1;
    }
    if (m.capped) out.cappedAppointments += 1;
  }
  out.totalMinutes = out.realMinutes + out.estimatedMinutes;
  return out;
}

/** Minutos como los lee una persona: 545 → "9 h 5 min". */
export function eduHoursLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · ALUMNO ATRASADO — la regla, escrita una vez y explicada en pantalla
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los TRES estados. Se pintan con color, así que el nombre no se enseña
 * nunca crudo (EDU_ATRASO_LABELS).
 */
export type EduAtrasoEstado = "AL_DIA" | "VIGILAR" | "ATRASADO";

export const EDU_ATRASO_ESTADOS: EduAtrasoEstado[] = ["AL_DIA", "VIGILAR", "ATRASADO"];

export const EDU_ATRASO_LABELS: Record<EduAtrasoEstado, string> = {
  AL_DIA: "Al día",
  VIGILAR: "Vigilar",
  ATRASADO: "Atrasado",
};

export const EDU_ATRASO_DESCRIPTIONS: Record<EduAtrasoEstado, string> = {
  AL_DIA: "Lleva cumplido lo que se espera a esta altura del ciclo, o más.",
  VIGILAR: "Va por debajo de lo esperado, pero todavía alcanza si no se descuida.",
  ATRASADO: "Va muy por debajo de lo esperado a esta altura. Hay que hablar con el alumno.",
};

/**
 * El filtro del semáforo tal como llega de la URL.
 *
 * "SIN_CALCULAR" es un valor de FILTRO y no un cuarto estado: sirve para
 * que la dirección encuentre de un tirón a los alumnos cuyo semáforo no se
 * puede calcular —los de una generación sin fechas— que son justamente los
 * que hay que ir a arreglar.
 */
export function parseEduSemaforo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v === "SIN_CALCULAR") return v;
  return (EDU_ATRASO_ESTADOS as string[]).includes(v) ? v : null;
}

/**
 * El umbral de "vigilar": por debajo de esto, atrasado.
 *
 * 🔴 Es un número ARBITRARIO y por eso está aquí arriba con nombre, en vez
 * de escondido en un `if`: la escuela va a discutirlo, y cuando lo haga
 * tiene que cambiarse en UN sitio. Que sea arbitrario no lo hace opcional
 * — sin umbral, un semáforo de dos estados marcaría "atrasado" a quien va
 * un caso por debajo, y la dirección dejaría de mirarlo a la semana.
 */
export const EDU_ATRASO_UMBRAL_VIGILAR = 0.75;

/**
 * Cuánto ha transcurrido de la generación, de 0 a 1.
 *
 * 🔴 Devuelve null cuando NO SE PUEDE SABER (sin fecha de inicio, sin
 * fecha de fin, o con fechas al revés), y quien lo llama pinta "sin
 * calcular" con el motivo. Inventar aquí una duración —los semestres del
 * programa, doce meses, lo que sea— produciría un semáforo rojo sobre un
 * alumno por un dato que la escuela nunca capturó, y ese rojo se lo
 * enseñaría alguien a un alumno.
 */
export function eduCycleFraction(
  cohort: { startDate: Date | string | null; endDate: Date | string | null },
  now: Date,
): number | null {
  const ini = toDate(cohort?.startDate);
  const fin = toDate(cohort?.endDate);
  if (!ini || !fin) return null;
  const total = fin.getTime() - ini.getTime();
  if (total <= 0) return null;
  return clamp01((now.getTime() - ini.getTime()) / total);
}

export interface EduAtrasoVerdict {
  /** null = no se puede calcular (y `motivo` dice por qué). */
  estado: EduAtrasoEstado | null;
  /** Cuánto del ciclo ha transcurrido, 0..1. null si no se sabe. */
  fraccion: number | null;
  /** Suma de lo cumplido, topado por requisito. */
  hechos: number;
  /** Suma de lo que se esperaba a esta altura. */
  esperados: number;
  /** Suma de todo lo que pide el plan. */
  totales: number;
  /**
   * 🔴 POR QUÉ salió así, en una frase que se puede leer en voz alta
   * delante del alumno. Un semáforo rojo sin explicación no sirve para
   * hablar con nadie: la dirección necesita decir QUÉ falta y CUÁNTO.
   */
  motivo: string;
  /** Los requisitos que más lo atrasan, de mayor a menor deuda. */
  faltantes: EduRequirementProgress[];
}

/**
 * ¿Va al día, hay que vigilarlo, o va atrasado? Y SOBRE TODO: por qué.
 *
 * La cuenta, entera:
 *   · `esperados` = Σ (requiredCount × fracción del ciclo transcurrida)
 *   · `hechos`    = Σ min(cumplidos, requiredCount)  ← TOPADO
 *   · ratio       = hechos / esperados
 *
 * 🔴 El tope de `hechos` es la línea que importa. Sin él, hacer doce
 * endodoncias de las tres que pedía el plan compensaría no haber hecho
 * NINGUNA prótesis, y el alumno saldría "al día" con medio plan sin tocar.
 * Un requisito cumplido de más no cumple otro.
 *
 * ⚠️ Un alumno sin requisitos aplicables sale AL_DIA y lo dice: no se le
 * puede exigir un plan que la dirección todavía no capturó.
 */
export function eduAtrasoVerdict(
  progresos: EduRequirementProgress[],
  fraccion: number | null,
  contexto?: { sinFechaMotivo?: string },
): EduAtrasoVerdict {
  const lista = Array.isArray(progresos) ? progresos : [];
  const totales = lista.reduce((s, p) => s + p.requiredCount, 0);
  const hechos = lista.reduce((s, p) => s + Math.min(p.doneCount, p.requiredCount), 0);

  const faltantes = lista
    .filter((p) => !p.met)
    .slice()
    .sort((a, b) => b.missingCount - a.missingCount);

  if (lista.length === 0) {
    return {
      estado: "AL_DIA",
      fraccion,
      hechos: 0,
      esperados: 0,
      totales: 0,
      motivo:
        "Su especialidad todavía no tiene requisitos capturados, así que no hay nada contra qué medirlo. Captúralos en Requisitos.",
      faltantes: [],
    };
  }

  if (fraccion === null) {
    return {
      estado: null,
      fraccion: null,
      hechos,
      esperados: 0,
      totales,
      motivo:
        contexto?.sinFechaMotivo ??
        "No se puede calcular: a su generación le falta la fecha de inicio o la de fin. Captúralas en Especialidades y generaciones y el semáforo aparece solo.",
      faltantes,
    };
  }

  const f = clamp01(fraccion);
  const esperados = totales * f;
  const pct = Math.round(f * 100);

  if (esperados <= 0) {
    return {
      estado: "AL_DIA",
      fraccion: f,
      hechos,
      esperados: 0,
      totales,
      motivo: `El ciclo apenas empieza (${pct} % transcurrido): todavía no se le espera nada. Lleva ${hechos} de ${totales}.`,
      faltantes,
    };
  }

  const ratio = hechos / esperados;
  const esperadosTexto = eduScoreLabel(Math.round(esperados * 100));

  let estado: EduAtrasoEstado;
  if (ratio >= 1) estado = "AL_DIA";
  else if (ratio >= EDU_ATRASO_UMBRAL_VIGILAR) estado = "VIGILAR";
  else estado = "ATRASADO";

  const puntas = faltantes
    .slice(0, 3)
    .map((p) => `${p.name} (${p.doneCount} de ${p.requiredCount})`)
    .join(" · ");

  const cabeza =
    estado === "AL_DIA"
      ? `Va al día: con ${pct} % del ciclo transcurrido se esperan ${esperadosTexto} de ${totales} y lleva ${hechos}.`
      : `Con ${pct} % del ciclo transcurrido se esperan ${esperadosTexto} de ${totales} y lleva ${hechos}.`;

  return {
    estado,
    fraccion: f,
    hechos,
    esperados,
    totales,
    motivo: puntas ? `${cabeza} Lo que más le falta: ${puntas}.` : cabeza,
    faltantes,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA EXPORTACIÓN DE LA BITÁCORA
//
// CSV y no PDF: lo que la dirección hace con esto en una acreditación es
// pegarlo en una hoja de cálculo y sumarlo. Un PDF bonito que no se puede
// sumar obliga a volver a teclearlo.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Una celda de CSV, escapada.
 *
 * 🔴 El apóstrofo delante de `= + - @` NO es decorativo: Excel y Google
 * Sheets interpretan una celda que empieza con esos caracteres como
 * FÓRMULA. Un paciente apellidado "-Ortiz" bastaría para que la hoja de
 * una acreditación abriera con errores por toda la columna, y una celda
 * preparada a mala fe puede llegar más lejos que eso.
 */
export function eduCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let texto = String(value).replace(/\r?\n/g, " ").trim();
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

/** Una fila de CSV. */
export function eduCsvRow(cells: unknown[]): string {
  return (cells ?? []).map(eduCsvCell).join(",");
}

/**
 * El archivo completo.
 *
 * Lleva BOM (U+FEFF) a propósito: sin él, Excel en Windows abre el CSV en
 * la codificación del sistema y "Rodríguez" sale "RodrÃ­guez" — que es
 * exactamente el archivo que la dirección va a imprimir.
 */
export function eduCsvFile(rows: string[]): string {
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

/** Nombre de archivo seguro: sin acentos, sin espacios, sin sorpresas. */
export function eduCsvFileName(base: string, dayISO: string): string {
  const limpio = String(base ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `bitacora-${limpio || "alumno"}-${dayISO}.csv`;
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · VALIDADORES DE ENTRADA
//
// Los mismos que usan los endpoints. Viven aquí —módulo puro— para que la
// pantalla pueda avisar ANTES de mandar y el servidor no confíe en que lo
// hizo.
// ═══════════════════════════════════════════════════════════════════════

/** Texto obligatorio, recortado. null si viene vacío o no es texto. */
export function eduEvalText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 ? v.slice(0, maxLength) : null;
}

/**
 * Texto opcional: `undefined` = "no lo mandes"; "" y "   " = BORRAR.
 * Misma semántica que `eduOptionalText` de agenda-core.
 */
export function eduEvalOptionalText(
  raw: unknown,
  maxLength: number,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (v.length === 0) return null;
  return v.slice(0, maxLength);
}

/** Entero dentro de un rango, o null. Acepta el número y el string. */
export function eduEvalInt(raw: unknown, min: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/** Booleano tolerante: true/false, "1"/"0", "true"/"false". */
export function eduEvalBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === "1" || raw === "true") return true;
  if (raw === 0 || raw === "0" || raw === "false") return false;
  return null;
}

/** ¿El rango de semestres tiene sentido? Devuelve el error o null. */
export function eduSemesterRangeCheck(
  from: number | null,
  to: number | null,
): string | null {
  if (from !== null && to !== null && from > to) {
    return "El semestre inicial no puede ser mayor que el final.";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Se declaran aquí (módulo puro) para que la página server y el componente
// cliente lean el MISMO tipo. Todo lo que sale hacia el navegador es
// serializable: fechas en ISO Y ADEMÁS con su etiqueta ya formateada en la
// zona del instituto — la pantalla no vuelve a formatear nada.
// ═══════════════════════════════════════════════════════════════════════

export interface EduRubricCriterionRow {
  id: string;
  name: string;
  description: string | null;
  weightPercent: number;
  orderIndex: number;
}

export interface EduRubricRow {
  id: string;
  name: string;
  programId: string | null;
  programName: string | null;
  procedureId: string | null;
  procedureName: string | null;
  scaleMin: number;
  scaleMax: number;
  isActive: boolean;
  orderIndex: number;
  notes: string | null;
  criteria: EduRubricCriterionRow[];
  /** En cuántas calificaciones se ha usado. Una rúbrica usada no se
   *  desactiva sin que quien la desactiva sepa qué está tocando. */
  usedIn: number;
}

export interface EduGradeItemRow {
  id: string;
  criterionId: string | null;
  criterionName: string;
  weightPercent: number;
  scoreX100: number;
  scoreLabel: string;
  comment: string | null;
}

export interface EduGradeRow {
  id: string;
  caseId: string;
  studentId: string;
  studentName: string;
  rubricId: string | null;
  rubricName: string;
  scaleMin: number;
  scaleMax: number;
  finalScoreX100: number;
  finalScoreLabel: string;
  comment: string | null;
  gradedById: string;
  gradedByName: string;
  gradedAt: string;
  gradedLabel: string;
  correctsId: string | null;
  /** true = es la calificación VIGENTE (nadie la corrige). */
  current: boolean;
  items: EduGradeItemRow[];
  /** Para la bitácora: de qué caso es. */
  patientName: string;
  patientFolio: string;
  programName: string;
  procedureName: string | null;
}

export interface EduRequirementRow {
  id: string;
  name: string;
  programId: string;
  programName: string;
  semesterFrom: number | null;
  semesterTo: number | null;
  procedureId: string | null;
  procedureName: string | null;
  category: string | null;
  requiredCount: number;
  onlyCompleted: boolean;
  isActive: boolean;
  orderIndex: number;
  notes: string | null;
}

/** Un traspaso, tal como se lee en la bitácora. */
export interface EduTransferRow {
  /** El caso NUEVO (el que quedó). */
  caseId: string;
  fromCaseId: string;
  patientName: string;
  patientFolio: string;
  programName: string;
  fromStudentId: string;
  fromStudentName: string;
  toStudentId: string;
  toStudentName: string;
  reason: string | null;
  byName: string | null;
  at: string;
  atLabel: string;
}

/** Un caso, tal como lo lee la bitácora académica. */
export interface EduBitacoraCaseRow {
  id: string;
  status: EduCaseStatus;
  patientId: string;
  patientName: string;
  patientFolio: string;
  programName: string;
  procedureId: string | null;
  procedureName: string | null;
  procedureCategory: string | null;
  openedAt: string;
  openedLabel: string;
  closedLabel: string | null;
  /** La calificación VIGENTE del caso, si tiene. */
  gradeLabel: string | null;
  gradeScaleMax: number | null;
  gradeId: string | null;
  /** De qué caso viene (traspaso). */
  transferredFromCaseId: string | null;
}

/** Una fila de la lista de Evaluación: un alumno y su semáforo. */
export interface EduEvaluacionRow {
  studentId: string;
  studentName: string;
  matricula: string;
  programId: string;
  programName: string;
  cohortId: string;
  cohortName: string;
  semester: number;
  status: string;
  estado: EduAtrasoEstado | null;
  motivo: string;
  hechos: number;
  esperados: number;
  totales: number;
  fraccion: number | null;
  hoursLabel: string;
  gradesCount: number;
  /** Promedio de sus calificaciones vigentes, ×100. null si no tiene. */
  averageX100: number | null;
  averageLabel: string | null;
  averageScaleMax: number | null;
}

/** La bitácora completa de UN alumno. */
export interface EduBitacoraPage {
  studentId: string;
  studentName: string;
  matricula: string;
  email: string;
  programId: string;
  programName: string;
  cohortName: string;
  cohortStartLabel: string | null;
  cohortEndLabel: string | null;
  semester: number;
  statusLabel: string;
  verdict: EduAtrasoVerdict;
  requirements: EduRequirementProgress[];
  hours: EduClinicalHours;
  hoursLabel: string;
  cases: EduBitacoraCaseRow[];
  /** Casos sin procedimiento: no cuentan para requisitos que pidan uno. */
  casesWithoutProcedure: number;
  grades: EduGradeRow[];
  transfers: EduTransferRow[];
  averageX100: number | null;
  averageLabel: string | null;
  averageScaleMax: number | null;
  generatedLabel: string;
}

/**
 * El promedio de las calificaciones VIGENTES.
 *
 * ⚠️ Solo promedia las que comparten escala. Promediar un 8/10 con un
 * 85/100 daría 46,5, que no significa nada; cuando hay escalas mezcladas
 * se promedia la MÁS USADA y la pantalla dice cuántas quedaron fuera. Es
 * feo, y es menos feo que un número inventado.
 */
export function eduAverageScore(
  grades: { finalScoreX100: number; scaleMax: number; current: boolean }[],
): { averageX100: number | null; scaleMax: number | null; ignored: number } {
  const vigentes = (grades ?? []).filter((g) => g.current);
  if (vigentes.length === 0) return { averageX100: null, scaleMax: null, ignored: 0 };

  const porEscala = new Map<number, number[]>();
  for (const g of vigentes) {
    const lista = porEscala.get(g.scaleMax);
    if (lista) lista.push(g.finalScoreX100);
    else porEscala.set(g.scaleMax, [g.finalScoreX100]);
  }

  let mejorEscala = 0;
  let mejorLista: number[] = [];
  // `forEach` y no `for…of`: el `target` de tsconfig no baja los
  // iteradores de Map, y un `for…of` sobre un Map no compila en este repo.
  porEscala.forEach((lista, escala) => {
    if (lista.length > mejorLista.length) {
      mejorEscala = escala;
      mejorLista = lista;
    }
  });

  const suma = mejorLista.reduce((s, v) => s + v, 0);
  return {
    averageX100: Math.round(suma / mejorLista.length),
    scaleMax: mejorEscala,
    ignored: vigentes.length - mejorLista.length,
  };
}
