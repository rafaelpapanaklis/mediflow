// ─────────────────────────────────────────────────────────────────────────────
// La tarjeta «Banderas de riesgo» del cuestionario (ws1-t3, auditoría BEVADENT F6).
//
// Decía «Ninguna» aunque el paciente tuviera padecimientos marcados: solo diez
// respuestas levantan bandera (`computeRiskFlags`) y el asma, por ejemplo, es
// un padecimiento sin bandera. Leído de prisa, «Ninguna» parecía «paciente sano».
//
// Aquí NO se cambia qué respuestas son bandera (eso lo decide Rafael): se dice
// cuáles son, y se nombra lo marcado que no levanta bandera para que la tarjeta
// no diga «ninguna» a secas.
//
// PURO: sin Prisma, sin React y sin red.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ALERGIAS,
  PADECIMIENTOS,
  RISK_FLAG_LABELS,
  computeRiskFlags,
  deriveSyncArrays,
  type Answers,
  type QDef,
} from "@/lib/health-questionnaire";

/**
 * Qué respuesta del cuestionario levanta cada bandera. Es el espejo de
 * `computeRiskFlags`; una prueba comprueba que los dos digan lo mismo.
 */
export const PREGUNTA_DE_CADA_BANDERA: Record<string, string> = {
  ANTICOAGULANTES: "anticoagulants",
  BIFOSFONATOS: "bisphosphonates",
  EMBARAZO: "pregnancy",
  ALERGIA_ANESTESIA: "allergyAnesthetics",
  ALERGIA_PENICILINA: "allergyPenicillin",
  ALERGIA_LATEX: "allergyLatex",
  CARDIOPATIA: "heartDisease",
  DIABETES: "diabetes",
  HIPERTENSION: "hypertension",
  COAGULOPATIA: "coagulation",
};

const PREGUNTAS_CON_BANDERA = new Set(Object.values(PREGUNTA_DE_CADA_BANDERA));
const TODAS: QDef[] = [...PADECIMIENTOS, ...ALERGIAS];

/** «Toma anticoagulantes» → «Anticoagulantes», en el orden de `computeRiskFlags`. */
export function preguntasQueLevantanBandera(): Array<{ bandera: string; etiqueta: string; pregunta: string }> {
  return Object.entries(PREGUNTA_DE_CADA_BANDERA).map(([bandera, clave]) => ({
    bandera,
    etiqueta: RISK_FLAG_LABELS[bandera] ?? bandera,
    pregunta: TODAS.find((q) => q.key === clave)?.label ?? clave,
  }));
}

export interface ResumenDeBanderas {
  /** Las banderas, como `computeRiskFlags`. */
  banderas: string[];
  /** Padecimientos marcados que NO levantan bandera («Asma»). */
  padecimientos: string[];
  /** Alergias marcadas que NO levantan bandera («AINEs / aspirina», las escritas en «Otras»). */
  alergias: string[];
}

function marcada(a: Answers, k: string): boolean {
  return a != null && a[k] === true;
}

export function resumenDeBanderas(answers: Answers): ResumenDeBanderas {
  const a = answers ?? {};
  const sinBandera = (defs: QDef[]) => defs.filter((q) => marcada(a, q.key) && !PREGUNTAS_CON_BANDERA.has(q.key));

  // Los nombres cortos («Asma», no «Asma o problemas respiratorios») son los que
  // ya llegan al expediente: `deriveSyncArrays` sobre solo lo que no es bandera.
  const soloPadecimientos: Answers = {};
  for (const q of sinBandera(PADECIMIENTOS)) soloPadecimientos[q.key] = true;
  const padecimientos = deriveSyncArrays(soloPadecimientos).chronicConditions;

  const soloAlergias: Answers = {};
  for (const q of sinBandera(ALERGIAS)) soloAlergias[q.key] = true;
  if (soloAlergias.allergyOther) soloAlergias.allergyOtherDetail = a.allergyOtherDetail;
  const alergias = deriveSyncArrays(soloAlergias).allergies;
  // «Otras alergias: sí» sin decir cuáles también es algo marcado.
  if (soloAlergias.allergyOther && !String(a.allergyOtherDetail ?? "").trim()) {
    alergias.push(ALERGIAS.find((q) => q.key === "allergyOther")?.label ?? "Otras alergias");
  }

  return { banderas: computeRiskFlags(a), padecimientos, alergias };
}
