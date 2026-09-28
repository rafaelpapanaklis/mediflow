// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Frase corta de
// interpretación clínica por medida — la columna "interpretación" del
// reporte (requisito 3 del encargo) y de la UI cuando la Parte B la monte.
//
// Deliberadamente CONSERVADOR: solo una frase de manual para "aumentado"/
// "disminuido" en las medidas con norma citada — nunca un diagnóstico, y
// siempre junto al número y a la norma (nunca la frase sola). Una medida
// "sin-norma" o "sin-medida" no tiene frase — devolver una inventada ahí
// sería peor que no decir nada.

import type { FullMeasurementKey } from "./norms-extended";
import type { NormInterpretation } from "./norms";

type Phrases = Partial<Record<"aumentado" | "disminuido", string>>;

const PHRASES: Partial<Record<FullMeasurementKey, Phrases>> = {
  SNA: {
    aumentado: "Maxilar en posición anterior respecto a la base de cráneo (protrusivo).",
    disminuido: "Maxilar en posición posterior respecto a la base de cráneo (retrusivo).",
  },
  SNB: {
    aumentado: "Mandíbula en posición anterior respecto a la base de cráneo (protrusiva).",
    disminuido: "Mandíbula en posición posterior respecto a la base de cráneo (retrusiva).",
  },
  ANB: {
    aumentado: "Tendencia esquelética Clase II (maxilar adelantado respecto a la mandíbula).",
    disminuido: "Tendencia esquelética Clase III (mandíbula adelantada respecto al maxilar).",
  },
  FMA: {
    aumentado: "Patrón de crecimiento vertical (cara larga).",
    disminuido: "Patrón de crecimiento horizontal (cara corta).",
  },
  IMPA: {
    aumentado: "Incisivo inferior proinclinado (vestibularizado).",
    disminuido: "Incisivo inferior retroinclinado (lingualizado).",
  },
  SN_GOGN: {
    aumentado: "Plano mandibular abierto — patrón de crecimiento vertical.",
    disminuido: "Plano mandibular cerrado — patrón de crecimiento horizontal.",
  },
  U1_NA_DEG: {
    aumentado: "Incisivo superior proinclinado respecto a NA.",
    disminuido: "Incisivo superior retroinclinado respecto a NA.",
  },
  U1_NA_MM: {
    aumentado: "Incisivo superior protruido respecto a la línea NA.",
    disminuido: "Incisivo superior retruido respecto a la línea NA.",
  },
  L1_NB_DEG: {
    aumentado: "Incisivo inferior proinclinado respecto a NB.",
    disminuido: "Incisivo inferior retroinclinado respecto a NB.",
  },
  L1_NB_MM: {
    aumentado: "Incisivo inferior protruido respecto a la línea NB.",
    disminuido: "Incisivo inferior retruido respecto a la línea NB.",
  },
  INTERINCISAL: {
    aumentado: "Incisivos verticalizados entre sí (ángulo interincisal abierto).",
    disminuido: "Incisivos proinclinados entre sí (ángulo interincisal cerrado).",
  },
  OCCLUSAL_SN: {
    aumentado: "Plano oclusal más inclinado respecto a la base de cráneo.",
    disminuido: "Plano oclusal más plano respecto a la base de cráneo.",
  },
  FACIAL_AXIS: {
    aumentado: "Dirección de crecimiento mandibular más horizontal.",
    disminuido: "Dirección de crecimiento mandibular más vertical.",
  },
  FACIAL_DEPTH: {
    aumentado: "Perfil esquelético relativamente más protrusivo.",
    disminuido: "Perfil esquelético relativamente más retrusivo.",
  },
  MANDIBULAR_PLANE_RICKETTS: {
    aumentado: "Patrón de crecimiento vertical.",
    disminuido: "Patrón de crecimiento horizontal.",
  },
  CONVEXITY_MM: {
    aumentado: "Perfil esquelético convexo (relación anteroposterior tipo Clase II).",
    disminuido: "Perfil esquelético cóncavo (relación anteroposterior tipo Clase III).",
  },
  UPPER_LIP_E_MM: {
    aumentado: "Labio superior protrusivo respecto a la línea E.",
    disminuido: "Labio superior retrusivo respecto a la línea E.",
  },
  LOWER_LIP_E_MM: {
    aumentado: "Labio inferior protrusivo respecto a la línea E.",
    disminuido: "Labio inferior retrusivo respecto a la línea E.",
  },
  FMIA: {
    aumentado: "Incisivo inferior más retroinclinado respecto a Frankfort.",
    disminuido: "Incisivo inferior más proinclinado respecto a Frankfort.",
  },
};

/** `null` cuando no hay frase para esa medida/estado (medidas sin norma citada, o interpretación "normal"/"sin-norma"/"sin-medida"). */
export function interpretationPhrase(
  key: FullMeasurementKey,
  interpretation: NormInterpretation,
): string | null {
  if (interpretation !== "aumentado" && interpretation !== "disminuido") return null;
  return PHRASES[key]?.[interpretation] ?? null;
}
