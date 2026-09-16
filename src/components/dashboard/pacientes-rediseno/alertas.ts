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
 * El emparejado es sobre el texto ENTERO ya normalizado (sin acentos, en
 * minúsculas, sin el «alergia a» de delante y sin una coletilla conocida del
 * final): así «Penicilina», «Alergia a penicilina» y «Alérgico a la
 * penicilina» caen bajo ALERGIA_PENICILINA, e «Hipertensión controlada» bajo
 * HIPERTENSION. Lo que no diga exactamente lo mismo se sigue pintando —una
 * alergia al ibuprofeno, o a «antibióticos sulfamidas», no se pierde.
 */

/**
 * El término canónico de cada bandera: lo que el texto libre tiene que DECIR
 * para considerarse la misma cosa. Se compara ya normalizado.
 *
 * Es una lista corta y explícita a propósito. La primera versión de esto
 * buscaba trozos de palabra dentro del texto (`indexOf`), y eso escondía cosas
 * que NO eran repetidos: con la bandera de penicilina puesta, una alergia
 * escrita a mano como «antibióticos sulfamidas» desaparecía de la cabecera
 * porque contenía «antibiotic». En una alerta de alergia, esconder de más es
 * el peor error posible: aquí se prefiere un chip repetido a una alergia que
 * no se ve.
 */
const TERMINOS_POR_BANDERA: Record<string, string[]> = {
  ALERGIA_ANESTESIA: ["anestesicos locales", "anestesicos", "anestesia local"],
  ALERGIA_PENICILINA: ["penicilina"],
  ALERGIA_LATEX: ["latex"],
  HIPERTENSION: ["hipertension", "hipertension arterial"],
  DIABETES: ["diabetes"],
  CARDIOPATIA: ["cardiopatia", "marcapasos", "cardiopatia o marcapasos"],
  COAGULOPATIA: ["trastorno de coagulacion", "trastornos de coagulacion", "coagulopatia"],
  ANTICOAGULANTES: ["anticoagulantes"],
  BIFOSFONATOS: ["bifosfonatos"],
  EMBARAZO: ["embarazo", "lactancia", "embarazo o lactancia"],
};

/**
 * Coletillas que no cambian de qué se está hablando: «Hipertensión» e
 * «Hipertensión controlada» son lo mismo, y la cabecera las pintaba pegadas.
 * Cualquier otra cosa detrás del término NO es una coletilla —«Diabetes
 * insípida» no es la diabetes de la bandera— y se sigue pintando.
 */
const COLETILLAS = [
  "controlada", "controlado", "no controlada", "no controlado",
  "en tratamiento", "tratada", "tratado", "compensada", "compensado",
  "tipo 1", "tipo 2", "tipo i", "tipo ii",
];

/** Lo que sobra al quitar «alergia a», «alérgico al», etc. */
const PREFIJOS_ALERGIA = [
  "alergia a la ", "alergia al ", "alergia a ", "alergia ",
  "alergico a la ", "alergico al ", "alergico a ",
  "alergica a la ", "alergica al ", "alergica a ",
];

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

/** Quita el «alergia a…» de delante, si lo trae. */
function sinPrefijoAlergia(n: string): string {
  for (let i = 0; i < PREFIJOS_ALERGIA.length; i++) {
    const p = PREFIJOS_ALERGIA[i];
    if (n.indexOf(p) === 0) return n.slice(p.length).trim();
  }
  return n;
}

/**
 * ¿Este texto libre dice EXACTAMENTE lo mismo que una de las banderas
 * presentes? Solo entonces se calla. Compara el texto entero (sin el «alergia
 * a» de delante y sin una coletilla del final) contra el término canónico:
 * nada de buscar trozos de palabra sueltos dentro de la frase.
 */
function loCubreUnaBandera(texto: string, banderas: string[]): boolean {
  const n = sinPrefijoAlergia(normalizar(texto));
  if (!n) return true; // vacío: nada que pintar
  return banderas.some((bandera) => {
    const terminos = TERMINOS_POR_BANDERA[bandera];
    if (!terminos) return false;
    return terminos.some((t) => {
      if (n === t) return true;
      // «Hipertensión controlada» = «Hipertensión» + coletilla.
      if (n.indexOf(t + " ") !== 0) return false;
      const resto = n.slice(t.length + 1).trim();
      return COLETILLAS.indexOf(resto) !== -1;
    });
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
    // Un medicamento se calla SOLO si es literalmente el nombre de la bandera.
    // Al contestar «toma anticoagulantes: sí», el cuestionario escribe la
    // palabra «Anticoagulantes» en la medicación del paciente Y levanta la
    // bandera ANTICOAGULANTES, cuyo texto es esa misma palabra: sin esto, la
    // cabecera pintaba el mismo chip dos veces. Lo que dice CUÁL y CUÁNTO
    // («Warfarina 5 mg») no es un repetido y se sigue pintando: el doctor lo
    // necesita ver.
    .filter((m) => !loCubreUnaBandera(m, banderas))
    .forEach((m) => {
      chips.push({ clave: `medicamento-${normalizar(m)}`, texto: m, tono: "violeta", esRiesgo: false });
    });

  return chips;
}

/** ¿Hay alguna alerta de las que obligan a parar antes de anestesiar? */
export function hayRiesgo(chips: ChipAlerta[]): boolean {
  return chips.some((c) => c.esRiesgo);
}
