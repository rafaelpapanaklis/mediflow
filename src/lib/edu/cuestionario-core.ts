/**
 * DaleControl INSTITUCIONAL — EL CUESTIONARIO DE SALUD · la parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido. Las preguntas, el cálculo de las BANDERAS DE
 * RIESGO y el merge aditivo a la ficha. Lo que toca la base vive en
 * cuestionario.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (fila 7 del informe ws2-t1)
 *
 * El dental guarda una VERSIÓN NUEVA cada vez, calcula las banderas en el
 * servidor y hace merge aditivo a la ficha, con historial de 20.
 * Instituto guarda los MISMOS campos clínicos… pero SOBRE LA PROPIA FILA
 * DEL PACIENTE: sin versionado, sin historial y sin banderas.
 *
 * La diferencia no es de comodidad. La pregunta clínica no es "¿qué
 * contesta el paciente?", es "¿QUÉ CONTESTÓ ANTES DE LA EXTRACCIÓN?", y un
 * UPDATE la deja sin respuesta para siempre.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS BANDERAS LAS CALCULA EL SERVIDOR, SIEMPRE.
 *
 * Una bandera que manda el cliente es una bandera que el cliente puede no
 * mandar. `eduCuestionarioRiskFlags` es una función pura sobre las
 * respuestas y se vuelve a correr en CADA versión: corregir el cálculo
 * mañana no reescribe las versiones viejas (eso sería falsear el
 * expediente), pero la siguiente ya sale bien.
 *
 * 🔴 EL MERGE A LA FICHA ES ADITIVO. Al guardar una versión, los campos
 * clínicos que el cuestionario toca se MEZCLAN sobre EduPatient: se añade
 * lo que llegó, NO se borra lo que no llegó. Un cuestionario que se manda
 * a medias no puede vaciarle las alergias a nadie — y eso es literalmente
 * la diferencia entre "no refiere alergias" y "nadie preguntó", que la
 * ficha ya distingue con `historyRecordedAt`.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduHabitLevel, EduPregnancy } from "@/lib/edu/types";
import { EDU_HABIT_LEVELS, EDU_PREGNANCY_VALUES } from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL HISTORIAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuántas versiones se enseñan. VEINTE, el mismo número que el dental, y
 * no es arbitrario: es lo que cabe en una pestaña sin paginar y lo que
 * cubre varios años de un paciente que viene dos veces al año.
 *
 * ⚠️ NO SE BORRA LA VEINTIUNO. El tope es de LECTURA: las versiones viejas
 * siguen en la base y siguen siendo el expediente. Un tope que borra es
 * una pérdida de datos con nombre de paginación.
 */
export const EDU_CUESTIONARIO_HISTORIAL = 20;

/** Tope de caracteres del campo de notas. Igual que el `@db.VarChar(2000)`. */
export const EDU_CUESTIONARIO_NOTES_MAX = 2000;

/** Tope de preguntas por versión, para que un cliente roto no meta 10 000. */
export const EDU_CUESTIONARIO_MAX_PREGUNTAS = 120;

// ═══════════════════════════════════════════════════════════════════════
// 2 · LAS BANDERAS DE RIESGO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las banderas. Son un catálogo cerrado y no texto libre: lo que se
 * escribe a mano no se puede filtrar ni alertar, y esto existe justamente
 * para poder alertar antes de infiltrar un anestésico.
 */
export const EDU_RISK_FLAGS = [
  /** Toma anticoagulantes: sangra y no para. Es la que más mata. */
  "ANTICOAGULANTE",
  /** Alergia declarada a un anestésico local o a un antibiótico. */
  "ALERGIA_FARMACO",
  /** Cualquier otra alergia declarada. */
  "ALERGIA",
  /** Embarazo o lactancia: cambia la radiografía y el fármaco. */
  "EMBARAZO",
  /** Cardiopatía, prótesis valvular, endocarditis previa. */
  "CARDIOPATIA",
  /** Diabetes: cicatrización e infección. */
  "DIABETES",
  /** Hipertensión no controlada. */
  "HIPERTENSION",
  /** Inmunosupresión, quimioterapia, VIH, trasplante. */
  "INMUNOSUPRESION",
  /** Bifosfonatos: osteonecrosis tras una extracción. */
  "BIFOSFONATOS",
  /** Tabaquismo frecuente: periodontal y cicatrización. */
  "TABAQUISMO",
  /** El paciente es menor de edad: firma un tutor. */
  "MENOR",
] as const;

export type EduRiskFlag = (typeof EDU_RISK_FLAGS)[number];

export const EDU_RISK_FLAG_LABELS: Record<EduRiskFlag, string> = {
  ANTICOAGULANTE: "Toma anticoagulantes",
  ALERGIA_FARMACO: "Alergia a un fármaco",
  ALERGIA: "Alergias declaradas",
  EMBARAZO: "Embarazo o lactancia",
  CARDIOPATIA: "Cardiopatía",
  DIABETES: "Diabetes",
  HIPERTENSION: "Hipertensión",
  INMUNOSUPRESION: "Inmunosupresión",
  BIFOSFONATOS: "Bifosfonatos",
  TABAQUISMO: "Tabaquismo frecuente",
  MENOR: "Menor de edad",
};

/**
 * Las banderas que PARAN un procedimiento hasta que alguien las lea. Se
 * pintan en rojo y arriba; el resto en ámbar.
 */
export const EDU_RISK_FLAGS_CRITICAS: EduRiskFlag[] = [
  "ANTICOAGULANTE",
  "ALERGIA_FARMACO",
  "EMBARAZO",
  "BIFOSFONATOS",
];

/**
 * Las respuestas de las que se derivan las banderas. Es un mapa
 * `clave → texto o booleano`: el formulario de cada escuela puede tener
 * las preguntas que quiera, pero estas claves son las que el servidor
 * mira. Una escuela que no las use simplemente no enciende banderas.
 */
export interface EduCuestionarioAnswers {
  [key: string]: unknown;
}

/** ¿Esta respuesta es un "sí"? Acepta booleano, "si"/"sí"/"true"/"1". */
export function eduCuestionarioEsSi(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v !== "string") return false;
  const s = v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return s === "si" || s === "true" || s === "1" || s === "yes";
}

/** ¿Hay texto de verdad ahí? (Un "no", "ninguna" o "-" no cuenta.) */
export function eduCuestionarioTieneTexto(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => eduCuestionarioTieneTexto(x));
  if (typeof v !== "string") return false;
  const s = v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!s || s === "-" || s === "n/a" || s === "na") return false;
  return s !== "no" && s !== "ninguna" && s !== "ninguno" && s !== "nada";
}

/**
 * LAS BANDERAS, calculadas sobre las respuestas. Función PURA: mismas
 * respuestas, mismas banderas, siempre.
 *
 * 🔴 SE DEVUELVEN ORDENADAS Y SIN REPETIR, y las críticas primero: el
 * orden ES la lectura. Un alumno de pie con el paciente en el sillón lee
 * la primera línea y a veces solo esa.
 */
export function eduCuestionarioRiskFlags(
  answers: EduCuestionarioAnswers,
  extra: { isChild?: boolean; pregnancy?: EduPregnancy | null } = {},
): EduRiskFlag[] {
  const flags = new Set<EduRiskFlag>();

  if (eduCuestionarioEsSi(answers.anticoagulantes)) flags.add("ANTICOAGULANTE");
  if (eduCuestionarioTieneTexto(answers.alergiaFarmacos)) {
    flags.add("ALERGIA_FARMACO");
    flags.add("ALERGIA");
  }
  if (eduCuestionarioTieneTexto(answers.alergias)) flags.add("ALERGIA");
  if (eduCuestionarioEsSi(answers.cardiopatia)) flags.add("CARDIOPATIA");
  if (eduCuestionarioEsSi(answers.diabetes)) flags.add("DIABETES");
  if (eduCuestionarioEsSi(answers.hipertension)) flags.add("HIPERTENSION");
  if (eduCuestionarioEsSi(answers.inmunosupresion)) flags.add("INMUNOSUPRESION");
  if (eduCuestionarioEsSi(answers.bifosfonatos)) flags.add("BIFOSFONATOS");

  const tabaco = eduCuestionarioParseHabit(answers.tabaco);
  if (tabaco === "FRECUENTE") flags.add("TABAQUISMO");

  // El embarazo puede venir de la respuesta O de la columna de la ficha:
  // si la ficha ya lo sabe, no hace falta que se vuelva a preguntar para
  // que la bandera salga.
  const emb = eduCuestionarioParsePregnancy(answers.embarazo) ?? extra.pregnancy ?? null;
  if (emb === "EMBARAZO" || emb === "LACTANCIA") flags.add("EMBARAZO");

  if (extra.isChild) flags.add("MENOR");

  const criticas = EDU_RISK_FLAGS_CRITICAS.filter((f) => flags.has(f));
  const resto = EDU_RISK_FLAGS.filter((f) => flags.has(f) && !criticas.includes(f));
  return [...criticas, ...resto];
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS PARSERS
// ═══════════════════════════════════════════════════════════════════════

export function eduCuestionarioParseHabit(raw: unknown): EduHabitLevel | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return (EDU_HABIT_LEVELS as string[]).includes(v) ? (v as EduHabitLevel) : null;
}

export function eduCuestionarioParsePregnancy(raw: unknown): EduPregnancy | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return (EDU_PREGNANCY_VALUES as string[]).includes(v) ? (v as EduPregnancy) : null;
}

/** Un array de texto limpio, sin vacíos ni repetidos, con tope. */
export function eduCuestionarioParseLista(raw: unknown, max = 30): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;\n]/)
      : [];
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const x of arr) {
    if (typeof x !== "string") continue;
    const v = x.trim().slice(0, 120);
    if (!v) continue;
    const k = v.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Valida el cuerpo de las respuestas.
 *
 * Lanza con un mensaje escrito para una persona (lo traduce a 400 el
 * `eduApiError` de la ruta) en vez de dejar que Postgres rebote un JSON de
 * 4 MB con un error que nadie entiende.
 */
export function eduCuestionarioParseAnswers(raw: unknown): EduCuestionarioAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("El cuestionario llegó vacío o con una forma que no se entiende.");
  }
  const claves = Object.keys(raw as Record<string, unknown>);
  if (claves.length === 0) {
    throw new Error("El cuestionario llegó sin ni una respuesta: no se guarda una versión vacía.");
  }
  if (claves.length > EDU_CUESTIONARIO_MAX_PREGUNTAS) {
    throw new Error(
      `El cuestionario trae ${claves.length} respuestas y el tope son ${EDU_CUESTIONARIO_MAX_PREGUNTAS}.`,
    );
  }
  return raw as EduCuestionarioAnswers;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL MERGE ADITIVO A LA FICHA
// ═══════════════════════════════════════════════════════════════════════

/** Lo que el merge puede tocar de EduPatient, y nada más. */
export interface EduCuestionarioMergeData {
  allergies?: string[];
  chronicConditions?: string[];
  currentMedications?: string[];
  bloodType?: string;
  familyHistory?: string;
  personalNonPathologicalHistory?: string;
  pregnancy?: EduPregnancy;
  habitsTobacco?: EduHabitLevel;
  habitsAlcohol?: EduHabitLevel;
  habitsBruxism?: EduHabitLevel;
  habitsNotes?: string;
  historyRecordedAt?: Date;
  historyRecordedById?: string | null;
}

/**
 * El `data` del update ADITIVO sobre la ficha.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ADITIVO SIGNIFICA QUE UN CAMPO AUSENTE NO SE ESCRIBE.
 *
 * No "se escribe vacío": NO SE ESCRIBE. La diferencia se ve en una frase:
 * un cuestionario que solo pregunta por el embarazo no puede dejar a un
 * cardiópata sin sus padecimientos crónicos. Es la misma regla que ya usa
 * `patient-update-core.ts` del dental («campo ausente no se escribe») y la
 * que hace que este merge sea seguro dentro de una transacción que también
 * inserta la versión.
 *
 * 🔴 LAS LISTAS SE UNEN, NO SE PISAN. Si la ficha ya dice "penicilina" y
 * el cuestionario nuevo dice "látex", quedan las dos. Quitar una alergia
 * de la ficha es un acto explícito desde la pestaña de antecedentes, no
 * un efecto colateral de contestar un formulario.
 *
 * 🔴 `historyRecordedAt` Y `historyRecordedById` SE ESCRIBEN JUNTOS Y
 * SIEMPRE, porque son lo que distingue "se le preguntó y no refiere" de
 * "nadie los ha capturado" — y confundir esos dos estados, dice el propio
 * esquema, «es como se mata a alguien».
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduCuestionarioMergeData(
  answers: EduCuestionarioAnswers,
  actual: {
    allergies?: string[] | null;
    chronicConditions?: string[] | null;
    currentMedications?: string[] | null;
  },
  actorUserId: string | null,
  now: Date,
): EduCuestionarioMergeData {
  const data: EduCuestionarioMergeData = {
    historyRecordedAt: now,
    historyRecordedById: actorUserId,
  };

  const une = (viejo: string[] | null | undefined, nuevo: string[]): string[] => {
    const out: string[] = [];
    const vistos = new Set<string>();
    for (const v of [...(viejo ?? []), ...nuevo]) {
      const k = v.trim().toLowerCase();
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      out.push(v.trim());
    }
    return out;
  };

  if (answers.alergias !== undefined || answers.alergiaFarmacos !== undefined) {
    const nuevas = [
      ...eduCuestionarioParseLista(answers.alergias),
      ...eduCuestionarioParseLista(answers.alergiaFarmacos),
    ];
    if (nuevas.length > 0) data.allergies = une(actual.allergies, nuevas);
  }

  if (answers.padecimientos !== undefined) {
    const nuevos = eduCuestionarioParseLista(answers.padecimientos);
    if (nuevos.length > 0) data.chronicConditions = une(actual.chronicConditions, nuevos);
  }

  if (answers.medicamentos !== undefined) {
    const nuevos = eduCuestionarioParseLista(answers.medicamentos);
    if (nuevos.length > 0) data.currentMedications = une(actual.currentMedications, nuevos);
  }

  if (typeof answers.tipoSangre === "string" && answers.tipoSangre.trim()) {
    data.bloodType = answers.tipoSangre.trim().slice(0, 10);
  }
  if (eduCuestionarioTieneTexto(answers.heredofamiliares)) {
    data.familyHistory = String(answers.heredofamiliares).trim().slice(0, 2000);
  }
  if (eduCuestionarioTieneTexto(answers.noPatologicos)) {
    data.personalNonPathologicalHistory = String(answers.noPatologicos).trim().slice(0, 2000);
  }

  const emb = eduCuestionarioParsePregnancy(answers.embarazo);
  if (emb) data.pregnancy = emb;

  const tabaco = eduCuestionarioParseHabit(answers.tabaco);
  if (tabaco) data.habitsTobacco = tabaco;
  const alcohol = eduCuestionarioParseHabit(answers.alcohol);
  if (alcohol) data.habitsAlcohol = alcohol;
  const bruxismo = eduCuestionarioParseHabit(answers.bruxismo);
  if (bruxismo) data.habitsBruxism = bruxismo;
  if (eduCuestionarioTieneTexto(answers.habitosNotas)) {
    data.habitsNotes = String(answers.habitosNotas).trim().slice(0, 500);
  }

  return data;
}

/**
 * Las tres listas clínicas TAL COMO SE LEYERON, para el `where` de la
 * escritura. Es un filtro de Prisma escrito a mano (`{ equals }` sobre una
 * columna de lista) para no arrastrar `@prisma/client` a un módulo puro.
 */
export interface EduCuestionarioMergeCas {
  allergies?: { equals: string[] };
  chronicConditions?: { equals: string[] };
  currentMedications?: { equals: string[] };
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL COMPARE-AND-SWAP DEL MERGE. Lo que impide que guardar un
 * cuestionario BORRE una alergia que acaba de escribir otra persona.
 *
 * El merge es aditivo, sí, pero se calcula contra una FOTO: se lee la ficha,
 * se une lo viejo con lo nuevo y se escribe el resultado. Entre la lectura y
 * la escritura hay dos escritores más en este vertical —el otro alumno
 * guardando su propio cuestionario del mismo paciente, y la pestaña de
 * ANTECEDENTES, que reemplaza el bloque entero— y la unión contra la foto
 * vieja los pisa sin decir nada:
 *
 *   1. Ana abre el cuestionario. Se lee `allergies: []`.
 *   2. La docente guarda antecedentes: `allergies: ["Penicilina"]`.
 *   3. Ana guarda. Se escribe `["Látex"]` — la penicilina desapareció.
 *
 * No hay error, no hay aviso, y lo que se pierde es el dato por el que
 * existe la ficha. Con estas claves en el `where`, el paso 3 no escribe
 * NADA: `updateMany` devuelve `count: 0`, el llamador vuelve a leer la ficha
 * de AHORA y une contra ella, y quedan las dos. Es el mismo patrón que el
 * resto del vertical («el estado leído va en el where»), aplicado a las
 * columnas que se unen.
 *
 * Solo se ponen en el `where` las listas que esta escritura VA A TOCAR: un
 * cuestionario que no pregunta por medicamentos no puede fallar porque
 * alguien tocara los medicamentos.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduCuestionarioMergeCas(
  data: EduCuestionarioMergeData,
  actual: {
    allergies?: string[] | null;
    chronicConditions?: string[] | null;
    currentMedications?: string[] | null;
  },
): EduCuestionarioMergeCas {
  const cas: EduCuestionarioMergeCas = {};
  if (data.allergies !== undefined) cas.allergies = { equals: actual.allergies ?? [] };
  if (data.chronicConditions !== undefined) {
    cas.chronicConditions = { equals: actual.chronicConditions ?? [] };
  }
  if (data.currentMedications !== undefined) {
    cas.currentMedications = { equals: actual.currentMedications ?? [] };
  }
  return cas;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL FORMULARIO, COMO DATO (Ola C·2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS PREGUNTAS SON UN DATO Y VIVEN AQUÍ, no en el JSX de la pantalla.
 *
 * La razón es concreta y ya mordió una vez en este vertical: las CLAVES de
 * las respuestas son las que `eduCuestionarioRiskFlags` y
 * `eduCuestionarioMergeData` van a leer. Si la pantalla escribe
 * `anticoagulante` (singular) y el servidor busca `anticoagulantes`, el
 * cuestionario se guarda perfectamente, la ficha se actualiza a medias y
 * la bandera roja NO SE ENCIENDE — sin error, sin aviso, y el fallo se
 * descubre con el paciente sangrando. Con las claves aquí, la pantalla las
 * recorre y no las teclea, y una prueba comprueba que las que el servidor
 * mira están todas en esta lista.
 *
 * 🔴 CADA ESCUELA PUEDE AÑADIR LAS SUYAS Y NO PASA NADA: `answers` es Json
 * y el servidor solo MIRA estas claves. Una pregunta extra se guarda y se
 * lee en el historial; simplemente no enciende banderas.
 * ═══════════════════════════════════════════════════════════════════════
 */
export type EduCuestionarioTipo = "SI_NO" | "TEXTO" | "LISTA" | "HABITO" | "EMBARAZO";

export interface EduCuestionarioPregunta {
  clave: string;
  etiqueta: string;
  tipo: EduCuestionarioTipo;
  /** La línea de ayuda, cuando la pregunta necesita explicarse. */
  ayuda?: string;
  /** true = si se contesta que sí, enciende una bandera CRÍTICA. */
  critica?: boolean;
}

export interface EduCuestionarioBloque {
  id: string;
  titulo: string;
  lead: string;
  preguntas: EduCuestionarioPregunta[];
}

export const EDU_CUESTIONARIO_BLOQUES: EduCuestionarioBloque[] = [
  {
    id: "alertas",
    titulo: "Lo que puede parar un procedimiento",
    lead:
      "Las cuatro respuestas que se leen antes de infiltrar un anestésico o de sacar una pieza. Si alguna es «sí», la ficha lo dice en rojo en todas sus pestañas.",
    preguntas: [
      {
        clave: "anticoagulantes",
        etiqueta: "¿Toma anticoagulantes?",
        tipo: "SI_NO",
        ayuda: "Warfarina, acenocumarol, rivaroxabán, apixabán, clopidogrel, aspirina a dosis alta.",
        critica: true,
      },
      {
        clave: "alergiaFarmacos",
        etiqueta: "¿A qué medicamentos es alérgico?",
        tipo: "LISTA",
        ayuda: "Sepáralos con comas. Anestésicos y antibióticos, primero.",
        critica: true,
      },
      {
        clave: "embarazo",
        etiqueta: "¿Embarazo o lactancia?",
        tipo: "EMBARAZO",
        ayuda: "Cambia la radiografía y el fármaco.",
        critica: true,
      },
      {
        clave: "bifosfonatos",
        etiqueta: "¿Toma o ha tomado bifosfonatos?",
        tipo: "SI_NO",
        ayuda: "Alendronato, ácido zoledrónico. Riesgo de osteonecrosis tras una extracción.",
        critica: true,
      },
    ],
  },
  {
    id: "padecimientos",
    titulo: "Padecimientos",
    lead: "Lo que cambia la cicatrización, la infección y la dosis.",
    preguntas: [
      { clave: "cardiopatia", etiqueta: "¿Cardiopatía, prótesis valvular o endocarditis previa?", tipo: "SI_NO" },
      { clave: "diabetes", etiqueta: "¿Diabetes?", tipo: "SI_NO" },
      { clave: "hipertension", etiqueta: "¿Hipertensión?", tipo: "SI_NO" },
      {
        clave: "inmunosupresion",
        etiqueta: "¿Inmunosupresión?",
        tipo: "SI_NO",
        ayuda: "Quimioterapia, VIH, trasplante, corticoides de largo plazo.",
      },
      {
        clave: "padecimientos",
        etiqueta: "Otros padecimientos crónicos",
        tipo: "LISTA",
        ayuda: "Se SUMAN a los que la ficha ya tenía; contestar aquí no borra nada.",
      },
    ],
  },
  {
    id: "medicacion",
    titulo: "Medicación y alergias",
    lead: "Qué toma y a qué es alérgico, más allá de los fármacos.",
    preguntas: [
      { clave: "medicamentos", etiqueta: "¿Qué medicamentos toma?", tipo: "LISTA" },
      {
        clave: "alergias",
        etiqueta: "Otras alergias",
        tipo: "LISTA",
        ayuda: "Látex, níquel, yodo, alimentos.",
      },
      { clave: "tipoSangre", etiqueta: "Tipo de sangre", tipo: "TEXTO" },
    ],
  },
  {
    id: "habitos",
    titulo: "Hábitos",
    lead: "Periodontal, cicatrización y desgaste.",
    preguntas: [
      { clave: "tabaco", etiqueta: "Tabaco", tipo: "HABITO" },
      { clave: "alcohol", etiqueta: "Alcohol", tipo: "HABITO" },
      { clave: "bruxismo", etiqueta: "Bruxismo", tipo: "HABITO" },
      { clave: "habitosNotas", etiqueta: "Notas sobre hábitos", tipo: "TEXTO" },
    ],
  },
  {
    id: "nom004",
    titulo: "Antecedentes (NOM-004)",
    lead:
      "Heredofamiliares y personales no patológicos. Son los dos que la norma pide por su nombre y los que la ficha no tenía dónde guardar.",
    preguntas: [
      { clave: "heredofamiliares", etiqueta: "Heredofamiliares", tipo: "TEXTO" },
      { clave: "noPatologicos", etiqueta: "Personales no patológicos", tipo: "TEXTO" },
    ],
  },
];

/** Todas las claves del formulario, aplanadas. Lo usa la prueba. */
export const EDU_CUESTIONARIO_CLAVES: string[] = EDU_CUESTIONARIO_BLOQUES.flatMap((b) =>
  b.preguntas.map((p) => p.clave),
);

/** La etiqueta de una clave, para el historial y el diff. */
export function eduCuestionarioEtiqueta(clave: string): string {
  for (const b of EDU_CUESTIONARIO_BLOQUES) {
    for (const p of b.preguntas) if (p.clave === clave) return p.etiqueta;
  }
  // Una clave que esta escuela añadió por su cuenta: se pinta tal cual en
  // vez de esconderse. El historial es lo que se contestó, no lo que este
  // archivo sabe preguntar.
  return clave;
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL DIFF ENTRE DOS VERSIONES
// ═══════════════════════════════════════════════════════════════════════

export interface EduCuestionarioCambio {
  clave: string;
  etiqueta: string;
  antes: string;
  despues: string;
}

/** Un valor de respuesta, escrito para una persona. */
export function eduCuestionarioTexto(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ") || "—";
  return String(v);
}

/**
 * QUÉ CAMBIÓ entre dos versiones del cuestionario.
 *
 * 🔴 SOLO LO QUE CAMBIÓ, y las claves de las DOS versiones. Una pregunta
 * que la versión nueva ya no trae también es un cambio —dejó de
 * contestarse— y esconderla haría que el diff dijera que no pasó nada. Es
 * la misma regla que el diff de la bitácora.
 *
 * `nueva` primero en la firma porque es como se lee la pantalla: «la 4
 * comparada con la 3».
 */
export function eduCuestionarioDiff(
  nueva: EduCuestionarioAnswers | null | undefined,
  vieja: EduCuestionarioAnswers | null | undefined,
): EduCuestionarioCambio[] {
  const a = (vieja ?? {}) as Record<string, unknown>;
  const b = (nueva ?? {}) as Record<string, unknown>;
  const claves = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  const out: EduCuestionarioCambio[] = [];
  for (const clave of claves) {
    const antes = eduCuestionarioTexto(a[clave]);
    const despues = eduCuestionarioTexto(b[clave]);
    if (antes === despues) continue;
    out.push({ clave, etiqueta: eduCuestionarioEtiqueta(clave), antes, despues });
  }
  // El orden del formulario primero, y lo que no está en él al final: un
  // diff ordenado por el objeto JSON sale en el orden en que se tecleó,
  // que no es ningún orden.
  const peso = (clave: string) => {
    const i = EDU_CUESTIONARIO_CLAVES.indexOf(clave);
    return i < 0 ? EDU_CUESTIONARIO_CLAVES.length : i;
  };
  return out.sort((x, y) => peso(x.clave) - peso(y.clave));
}
