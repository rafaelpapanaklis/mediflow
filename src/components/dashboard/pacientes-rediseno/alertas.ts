import { RISK_FLAG_LABELS } from "@/lib/health-questionnaire";

/**
 * Las alertas de la cabecera del paciente, SIN repetidos.
 *
 * El problema, fotografiado: la cabecera pinta «Alergia a penicilina» y
 * «Penicilina» pegadas, y también «Alergia al látex» + «Látex» e
 * «Hipertensión» + «Hipertensión controlada». No es un fallo de pintado, es
 * que el dato llega por dos caminos y los dos son legítimos:
 *
 *   · las BANDERAS DE RIESGO las calcula el cuestionario de salud
 *     (`computeRiskFlags`) y son una lista cerrada de diez;
 *   · las ALERGIAS, PADECIMIENTOS y MEDICAMENTOS son campos del paciente,
 *     y al guardar el cuestionario se le suman ahí también
 *     (`deriveSyncArrays` + `mergeAdditive`), donde además conviven con lo
 *     que la clínica escribió a mano.
 *
 * Aquí no se borra ningún dato: se decide qué CHIP se pinta. Gana la bandera
 * de riesgo (es la que viene del cuestionario firmado y la que el doctor
 * reconoce), y se calla el texto libre que dice lo mismo.
 *
 * El emparejado es por PALABRA CLAVE y sobre texto normalizado (sin acentos,
 * en minúsculas), no por igualdad: así «Penicilina», «Alergia a penicilina» y
 * «Alérgico a la penicilina» caen todos bajo la bandera ALERGIA_PENICILINA, e
 * «Hipertensión controlada» bajo HIPERTENSION. Lo que NO se parezca a ninguna
 * bandera se sigue pintando: una alergia al ibuprofeno escrita a mano no se
 * pierde porque no exista una bandera para ella.
 */

/** Palabras que delatan a cada bandera dentro de un texto libre. */
const CLAVES_POR_BANDERA: Record<string, string[]> = {
  ALERGIA_ANESTESIA: ["anestes"],
  ALERGIA_PENICILINA: ["penicilina", "antibiotic"],
  ALERGIA_LATEX: ["latex"],
  HIPERTENSION: ["hipertension"],
  DIABETES: ["diabet"],
  CARDIOPATIA: ["cardiopat", "marcapaso"],
  COAGULOPATIA: ["coagulac", "coagulopat"],
  ANTICOAGULANTES: ["anticoagulante", "warfarina", "acenocumarol"],
  BIFOSFONATOS: ["bifosfonato"],
  EMBARAZO: ["embarazo", "gestacion", "lactancia"],
};

export type TonoAlerta = "peligro" | "alerta" | "violeta" | "exito";

export interface ChipAlerta {
  /** Clave estable para React; no se enseña. */
  clave: string;
  texto: string;
  tono: TonoAlerta;
  /** Alergia o bandera de alergia — lleva el triángulo. */
  esRiesgo: boolean;
}

export interface EntradaAlertas {
  riskFlags: string[];
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
}

/** minúsculas, sin acentos y sin dobles espacios. */
export function normalizar(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Este texto libre ya lo está diciendo una de las banderas presentes? */
function loCubreUnaBandera(texto: string, banderas: string[]): boolean {
  const n = normalizar(texto);
  if (!n) return true; // vacío: nada que pintar
  return banderas.some((bandera) => {
    const claves = CLAVES_POR_BANDERA[bandera];
    if (!claves) return false;
    return claves.some((clave) => n.indexOf(clave) !== -1);
  });
}

/** Quita repetidos dentro de una misma lista (case/acento-insensible). */
function sinRepetidos(lista: string[]): string[] {
  const vistos: Record<string, true> = {};
  const salida: string[] = [];
  (lista || []).forEach((texto) => {
    const n = normalizar(texto);
    if (!n || vistos[n]) return;
    vistos[n] = true;
    salida.push(texto.trim());
  });
  return salida;
}

/**
 * Devuelve los chips ya listos para pintar, en el orden de siempre: primero
 * lo que puede matar a alguien (banderas y alergias), luego padecimientos,
 * luego medicación.
 */
export function construirAlertas(entrada: EntradaAlertas): ChipAlerta[] {
  const banderas = (entrada.riskFlags || []).filter((f) => !!f);
  const chips: ChipAlerta[] = [];

  banderas.forEach((f) => {
    chips.push({
      clave: `bandera-${f}`,
      texto: RISK_FLAG_LABELS[f] ?? f,
      tono: "peligro",
      esRiesgo: true,
    });
  });

  sinRepetidos(entrada.allergies)
    .filter((a) => !loCubreUnaBandera(a, banderas))
    .forEach((a) => {
      chips.push({ clave: `alergia-${normalizar(a)}`, texto: a, tono: "peligro", esRiesgo: true });
    });

  sinRepetidos(entrada.chronicConditions)
    .filter((c) => !loCubreUnaBandera(c, banderas))
    .forEach((c) => {
      chips.push({ clave: `cronica-${normalizar(c)}`, texto: c, tono: "alerta", esRiesgo: false });
    });

  sinRepetidos(entrada.currentMedications)
    // Los medicamentos NO se comparan contra las banderas: «Anticoagulantes»
    // (bandera) y «Warfarina 5 mg» (medicamento) son dos datos distintos —
    // el segundo dice cuál y cuánto, y eso el doctor lo necesita ver.
    .forEach((m) => {
      chips.push({ clave: `medicamento-${normalizar(m)}`, texto: m, tono: "violeta", esRiesgo: false });
    });

  return chips;
}

/** ¿Hay alguna alerta de las que obligan a parar antes de anestesiar? */
export function hayRiesgo(chips: ChipAlerta[]): boolean {
  return chips.some((c) => c.esRiesgo);
}
