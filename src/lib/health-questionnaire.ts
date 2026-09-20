// ═══════════════════════════════════════════════════════════════════
// Contrato del cuestionario de salud / anamnesis dental (WS1-T2).
//
// Fuente ÚNICA de verdad: lo usan el formulario (cliente) y el endpoint
// /api/patients/[id]/health-questionnaire (servidor) para que las
// preguntas, las banderas de riesgo calculadas y el merge aditivo hacia
// Patient NUNCA diverjan. Sin dependencias de React ni de Prisma.
//
// Reglas del repo: TS no-strict, target < ES2015 → NADA de for...of sobre
// Map/Set. Solo arrays + forEach/map/filter.
// ═══════════════════════════════════════════════════════════════════

export const HEALTH_QUESTIONNAIRE_VERSION = 1;

/** El cuestionario vigente con más de estos meses se considera vencido. */
export const STALE_AFTER_MONTHS = 12;

export type Answers = Record<string, any>;

export interface QDef {
  key: string;          // clave booleana sí/no en `answers`
  label: string;        // pregunta en español neutro
  /** Clave i18n de la pregunta. Si está, la pantalla traduce; si no, usa `label`. */
  labelKey?: string;
  detail?: boolean;     // muestra un campo de detalle al marcar "sí"
  detailLabel?: string; // etiqueta del campo de detalle
  detailPlaceholder?: string;
}

/** Un campo de texto libre al pie de un grupo, para lo que no encaje en las casillas. */
export interface QLibre {
  key: string;
  label: string;
  labelKey?: string;
  placeholder?: string;
  placeholderKey?: string;
}

export interface QGroup {
  id: string;
  title: string;
  /** Clave i18n del título. Si está, la pantalla traduce; si no, usa `title`. */
  titleKey?: string;
  /** Clave i18n de la línea de ayuda bajo el título (opcional). */
  ayudaKey?: string;
  questions: QDef[];
  /**
   * Si está, las respuestas del grupo NO son claves sueltas de `answers`:
   * viven anidadas en `answers[namespace]`. Es lo que fija el contrato de
   * NOM-004 (`heredoFamiliares`, `aparatosSistemas`) sin ensuciar el plano
   * que ya usan las 24 preguntas de siempre.
   */
  namespace?: string;
  /** Casillas de marcar, no botones Sí/No. */
  casillas?: boolean;
  /** Arranca plegado: una revisión de control no llena esto. */
  plegado?: boolean;
  /** Campo de texto libre al pie del grupo (vive dentro del namespace). */
  libre?: QLibre;
}

// ── Padecimientos ──────────────────────────────────────────────────
export const PADECIMIENTOS: QDef[] = [
  { key: "diabetes",        label: "Diabetes", detail: true, detailLabel: "Tipo / control" },
  { key: "hypertension",    label: "Hipertensión arterial" },
  { key: "heartDisease",    label: "Cardiopatía o marcapasos", detail: true, detailLabel: "Detalle" },
  { key: "rheumaticFever",  label: "Fiebre reumática" },
  { key: "hepatitis",       label: "Hepatitis", detail: true, detailLabel: "Tipo (A/B/C)" },
  { key: "hiv",             label: "VIH / SIDA" },
  { key: "epilepsy",        label: "Epilepsia o convulsiones" },
  { key: "asthma",          label: "Asma o problemas respiratorios" },
  { key: "thyroid",         label: "Problemas de tiroides" },
  { key: "cancer",          label: "Cáncer (radioterapia / quimioterapia)", detail: true, detailLabel: "Detalle" },
  { key: "osteoporosis",    label: "Osteoporosis" },
  { key: "bisphosphonates", label: "Toma o ha tomado bifosfonatos", detail: true, detailLabel: "Cuál y desde cuándo" },
  { key: "coagulation",     label: "Trastornos de coagulación" },
  { key: "anticoagulants",  label: "Toma anticoagulantes", detail: true, detailLabel: "Cuál (warfarina, etc.)" },
  { key: "kidneyLiver",     label: "Enfermedad renal o hepática" },
  { key: "pregnancy",       label: "Embarazo o lactancia", detail: true, detailLabel: "Semanas de gestación" },
];

// ── Alergias ───────────────────────────────────────────────────────
export const ALERGIAS: QDef[] = [
  { key: "allergyAnesthetics", label: "Anestésicos locales" },
  { key: "allergyPenicillin",  label: "Penicilina / antibióticos" },
  { key: "allergyNsaids",      label: "AINEs / aspirina" },
  { key: "allergyLatex",       label: "Látex" },
  { key: "allergyOther",       label: "Otras alergias", detail: true, detailLabel: "¿Cuáles? (separa con comas)" },
];

// ── Hábitos ────────────────────────────────────────────────────────
export const HABITOS: QDef[] = [
  { key: "smoking", label: "Tabaco", detail: true, detailLabel: "Cantidad al día" },
  { key: "alcohol", label: "Alcohol", detail: true, detailLabel: "Frecuencia" },
  { key: "bruxism", label: "Bruxismo / aprieta los dientes" },
];

// ═══════════════════════════════════════════════════════════════════
// NOM-004 — los dos apartados que la norma pide y no se capturaban.
//
// Van ANIDADOS en `answers` (`answers.heredoFamiliares`,
// `answers.aparatosSistemas`) y no como claves sueltas: así el plano de las
// 24 preguntas de siempre se queda exactamente como está, y el PDF del
// expediente sabe dónde mirar sin adivinar prefijos.
//
// Son CASILLAS, no botones Sí/No, y por una razón de captura: esto se llena
// entre paciente y paciente. Marcar cuatro casillas son cuatro toques;
// contestar «no» a once preguntas son once. Y una casilla sin marcar no
// afirma nada — que es justo lo que un expediente necesita: ⛔ ninguna de
// las dos secciones escribe un «sin alteraciones» que nadie miró.
//
// Las dos arrancan PLEGADAS: la primera visita las llena, una revisión de
// control no.
// ═══════════════════════════════════════════════════════════════════

/** Antecedentes heredo-familiares: de qué padecen o murieron los padres. */
export const HEREDO_FAMILIARES: QDef[] = [
  { key: "diabetes",     label: "Diabetes",      labelKey: "clinical.nom004.heredoFamiliares.diabetes" },
  { key: "hipertension", label: "Hipertensión",  labelKey: "clinical.nom004.heredoFamiliares.hipertension" },
  { key: "cardiopatias", label: "Cardiopatías",  labelKey: "clinical.nom004.heredoFamiliares.cardiopatias" },
  { key: "cancer",       label: "Cáncer",        labelKey: "clinical.nom004.heredoFamiliares.cancer" },
];

/** Interrogatorio por aparatos y sistemas: dónde refiere algo el paciente. */
export const APARATOS_SISTEMAS: QDef[] = [
  { key: "cardiovascular",     label: "Cardiovascular",     labelKey: "clinical.nom004.aparatosSistemas.cardiovascular" },
  { key: "respiratorio",       label: "Respiratorio",       labelKey: "clinical.nom004.aparatosSistemas.respiratorio" },
  { key: "digestivo",          label: "Digestivo",          labelKey: "clinical.nom004.aparatosSistemas.digestivo" },
  { key: "genitourinario",     label: "Genitourinario",     labelKey: "clinical.nom004.aparatosSistemas.genitourinario" },
  { key: "endocrino",          label: "Endocrino",          labelKey: "clinical.nom004.aparatosSistemas.endocrino" },
  { key: "nervioso",           label: "Nervioso",           labelKey: "clinical.nom004.aparatosSistemas.nervioso" },
  { key: "musculoesqueletico", label: "Musculoesquelético", labelKey: "clinical.nom004.aparatosSistemas.musculoesqueletico" },
];

export const GRUPO_HEREDO_FAMILIARES: QGroup = {
  id: "heredoFamiliares",
  namespace: "heredoFamiliares",
  title: "Antecedentes heredo-familiares",
  titleKey: "clinical.nom004.heredoFamiliares.titulo",
  ayudaKey: "clinical.nom004.heredoFamiliares.ayuda",
  casillas: true,
  plegado: true,
  questions: HEREDO_FAMILIARES,
  libre: {
    key: "otros",
    label: "Otros",
    labelKey: "clinical.nom004.heredoFamiliares.otros",
    placeholder: "Ej. madre con artritis reumatoide; padre finado por EVC",
    placeholderKey: "clinical.nom004.heredoFamiliares.otrosEjemplo",
  },
};

export const GRUPO_APARATOS_SISTEMAS: QGroup = {
  id: "aparatosSistemas",
  namespace: "aparatosSistemas",
  title: "Interrogatorio por aparatos y sistemas",
  titleKey: "clinical.nom004.aparatosSistemas.titulo",
  ayudaKey: "clinical.nom004.aparatosSistemas.ayuda",
  casillas: true,
  plegado: true,
  questions: APARATOS_SISTEMAS,
  libre: {
    key: "notas",
    label: "Notas",
    labelKey: "clinical.nom004.aparatosSistemas.notas",
    placeholder: "Ej. refiere disnea de medianos esfuerzos desde hace un mes",
    placeholderKey: "clinical.nom004.aparatosSistemas.notasEjemplo",
  },
};

export const QUESTIONNAIRE_GROUPS: QGroup[] = [
  { id: "padecimientos", title: "Padecimientos", questions: PADECIMIENTOS },
  { id: "alergias",      title: "Alergias",      questions: ALERGIAS },
  { id: "habitos",       title: "Hábitos",       questions: HABITOS },
  GRUPO_HEREDO_FAMILIARES,
  GRUPO_APARATOS_SISTEMAS,
];

/**
 * ¿Este valor es «nada»? Una casilla desmarcada y una cadena VACÍA.
 *
 * Ojo con el espacio: `"   "` NO se considera nada aquí a propósito. Si lo
 * fuera, teclear un espacio como primer carácter del texto libre borraría la
 * clave y el campo controlado volvería a "" — no se podría empezar por
 * espacio. Lo que sobra se recorta en `normalizeAnswers`, que es el borde
 * donde de verdad importa: lo que se guarda.
 */
function esVacio(v: any): boolean {
  return v === undefined || v === null || v === false || v === "";
}

/**
 * Lo contestado de un grupo. Con `namespace`, el sub-objeto anidado; sin él,
 * las propias `answers`. Siempre un objeto: nunca null, nunca un array.
 */
export function grupoValores(answers: Answers, group: QGroup): Answers {
  const raw = group.namespace ? (answers == null ? null : answers[group.namespace]) : answers;
  return raw != null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Pone (o quita) un valor del grupo y devuelve unas `answers` NUEVAS.
 *
 * VACÍO ES VACÍO: `false`, `undefined` y el texto en blanco BORRAN la clave,
 * y cuando el grupo se queda sin nada se borra el grupo entero. Así una
 * casilla que se marcó y se desmarcó no deja rastro, y un expediente sin
 * antecedentes heredo-familiares no guarda cuatro `false` que nadie miró.
 */
export function ponerEnGrupo(answers: Answers, group: QGroup, key: string, value: any): Answers {
  const base: Answers = answers != null && typeof answers === "object" ? answers : {};
  if (!group.namespace) {
    const plano: Answers = { ...base };
    if (esVacio(value)) delete plano[key];
    else plano[key] = value;
    return plano;
  }
  const sub: Answers = { ...grupoValores(base, group) };
  if (esVacio(value)) delete sub[key];
  else sub[key] = value;
  const out: Answers = { ...base };
  if (Object.keys(sub).length === 0) delete out[group.namespace];
  else out[group.namespace] = sub;
  return out;
}

/**
 * Deja las secciones anidadas en su forma canónica ANTES de guardar: solo
 * las casillas marcadas (`true`) que el catálogo conoce y el texto libre
 * recortado que tenga algo. Una sección sin nada desaparece.
 *
 * Todo lo demás de `answers` —las 24 preguntas planas, los detalles, el
 * motivo, el dolor— pasa INTACTO: un cuestionario viejo, sin las secciones
 * nuevas, entra y sale idéntico.
 */
export function normalizeAnswers(answers: Answers): Answers {
  const out: Answers =
    answers != null && typeof answers === "object" && !Array.isArray(answers) ? { ...answers } : {};
  QUESTIONNAIRE_GROUPS.forEach((g) => {
    if (!g.namespace) return;
    const sub = grupoValores(out, g);
    const limpio: Answers = {};
    g.questions.forEach((q) => {
      if (sub[q.key] === true) limpio[q.key] = true;
    });
    if (g.libre) {
      const txt = sub[g.libre.key];
      if (typeof txt === "string" && txt.trim()) limpio[g.libre.key] = txt.trim();
    }
    if (Object.keys(limpio).length === 0) delete out[g.namespace];
    else out[g.namespace] = limpio;
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// NOM-004 §6.2 — lo que le faltaba a la NOTA DE EVOLUCIÓN.
//
// Vive en `medical_records.specialtyData` (columna JSON que ya existía):
//   exploracionFisica: { habitus, cabezaCuello, cavidadOral, atm, ganglios, notas }
//   pronostico:        "bueno" | "reservado" | "malo" | ""
//
// El catálogo está AQUÍ y no en el formulario para que se pueda probar sin
// montar React, y para que el PDF del expediente lea la misma lista.
//
// ⛔ El léxico del pronóstico NO se redefine aquí: los tres valores y sus
// textos son los del plan de tratamiento
// (`components/dashboard/plan-tratamiento-rediseno/plan-clinico.ts`), y por
// eso `normalizePronostico` RECIBE la lista en vez de llevarla dentro. Dos
// léxicos para el mismo concepto es deuda desde el día uno.
// ═══════════════════════════════════════════════════════════════════

export interface CampoExploracion {
  key: string;
  label: string;
  labelKey: string;
  /** Ejemplo real de odontología: un dentista no escribe «habitus exterior» de memoria. */
  placeholder: string;
  placeholderKey: string;
  /** Campo de varias líneas. */
  area?: boolean;
}

export const EXPLORACION_FISICA: CampoExploracion[] = [
  {
    key: "habitus",
    label: "Habitus exterior",
    labelKey: "clinical.nom004.exploracionFisica.habitus",
    placeholder: "Ej. buena constitución, marcha normal",
    placeholderKey: "clinical.nom004.exploracionFisica.habitusEjemplo",
  },
  {
    key: "cabezaCuello",
    label: "Cabeza y cuello",
    labelKey: "clinical.nom004.exploracionFisica.cabezaCuello",
    placeholder: "Ej. simetría facial conservada",
    placeholderKey: "clinical.nom004.exploracionFisica.cabezaCuelloEjemplo",
  },
  {
    key: "cavidadOral",
    label: "Cavidad oral",
    labelKey: "clinical.nom004.exploracionFisica.cavidadOral",
    placeholder: "Ej. cálculo en anteroinferiores, encía 36",
    placeholderKey: "clinical.nom004.exploracionFisica.cavidadOralEjemplo",
  },
  {
    key: "atm",
    label: "ATM",
    labelKey: "clinical.nom004.exploracionFisica.atm",
    placeholder: "Ej. apertura 42 mm, chasquido derecho",
    placeholderKey: "clinical.nom004.exploracionFisica.atmEjemplo",
  },
  {
    key: "ganglios",
    label: "Ganglios",
    labelKey: "clinical.nom004.exploracionFisica.ganglios",
    placeholder: "Ej. submandibulares no palpables",
    placeholderKey: "clinical.nom004.exploracionFisica.gangliosEjemplo",
  },
  {
    key: "notas",
    label: "Notas de la exploración",
    labelKey: "clinical.nom004.exploracionFisica.notas",
    placeholder: "Lo que no entre arriba. Ej. paciente con ansiedad marcada al sillón",
    placeholderKey: "clinical.nom004.exploracionFisica.notasEjemplo",
    area: true,
  },
];

/**
 * La exploración física tal como se guarda: SOLO los campos con algo escrito,
 * recortados. Devuelve siempre un objeto —puede ser `{}`— para que quien la
 * lea (el PDF del expediente) no tenga que defenderse de un `undefined`.
 *
 * ⛔ No rellena huecos: un campo en blanco NO se guarda como «sin
 * alteraciones». En un expediente eso es peor que el hueco, porque afirma
 * algo que no se exploró.
 */
export function normalizeExploracionFisica(raw: any): Record<string, string> {
  const src = raw != null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out: Record<string, string> = {};
  EXPLORACION_FISICA.forEach((c) => {
    const v = src[c.key];
    if (typeof v === "string" && v.trim()) out[c.key] = v.trim();
  });
  return out;
}

/**
 * El pronóstico tal como se guarda. `permitidos` son los valores del plan de
 * tratamiento (`PRONOSTICOS`); cualquier otra cosa —o nada— guarda "".
 */
export function normalizePronostico(raw: any, permitidos: readonly string[]): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  return permitidos.indexOf(v) === -1 ? "" : v;
}

// ── Banderas de riesgo (chips rojos en el panel) ───────────────────
export type RiskFlag =
  | "ANTICOAGULANTES" | "BIFOSFONATOS" | "EMBARAZO"
  | "ALERGIA_ANESTESIA" | "ALERGIA_PENICILINA" | "ALERGIA_LATEX"
  | "CARDIOPATIA" | "DIABETES" | "HIPERTENSION" | "COAGULOPATIA";

export const RISK_FLAG_LABELS: Record<string, string> = {
  ANTICOAGULANTES:    "Anticoagulantes",
  BIFOSFONATOS:       "Bifosfonatos",
  EMBARAZO:           "Embarazo",
  ALERGIA_ANESTESIA:  "Alergia a anestesia",
  ALERGIA_PENICILINA: "Alergia a penicilina",
  ALERGIA_LATEX:      "Alergia al látex",
  CARDIOPATIA:        "Cardiopatía / marcapasos",
  DIABETES:           "Diabetes",
  HIPERTENSION:       "Hipertensión",
  COAGULOPATIA:       "Trastorno de coagulación",
};

function truthy(a: Answers, k: string): boolean {
  return a != null && a[k] === true;
}

/**
 * Calcula las banderas de riesgo a partir de las respuestas. Se ejecuta
 * server-side al guardar (autoridad) y también puede correr en cliente
 * para previsualizar. Orden estable para UI determinista.
 */
export function computeRiskFlags(answers: Answers): string[] {
  const flags: string[] = [];
  if (truthy(answers, "anticoagulants"))     flags.push("ANTICOAGULANTES");
  if (truthy(answers, "bisphosphonates"))    flags.push("BIFOSFONATOS");
  if (truthy(answers, "pregnancy"))          flags.push("EMBARAZO");
  if (truthy(answers, "allergyAnesthetics")) flags.push("ALERGIA_ANESTESIA");
  if (truthy(answers, "allergyPenicillin"))  flags.push("ALERGIA_PENICILINA");
  if (truthy(answers, "allergyLatex"))       flags.push("ALERGIA_LATEX");
  if (truthy(answers, "heartDisease"))       flags.push("CARDIOPATIA");
  if (truthy(answers, "diabetes"))           flags.push("DIABETES");
  if (truthy(answers, "hypertension"))       flags.push("HIPERTENSION");
  if (truthy(answers, "coagulation"))        flags.push("COAGULOPATIA");
  return flags;
}

/**
 * Merge ADITIVO con dedup case-insensitive. Conserva el orden (existentes
 * primero) y descarta vacíos. NO borra lo capturado a mano en Patient.
 */
export function mergeAdditive(existing: string[] | null | undefined, incoming: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};
  const push = (raw: any) => {
    const v = (raw == null ? "" : String(raw)).trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push(v);
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return out;
}

/** Divide un texto libre (comas o saltos de línea) en items limpios. */
function splitFree(text: any): string[] {
  if (text == null) return [];
  return String(text)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deriva los arrays que se mergean ADITIVAMENTE hacia Patient
 * (allergies / chronicConditions / currentMedications) a partir de las
 * respuestas, para que las alertas existentes del panel sigan vivas sin
 * tocar su código.
 */
export function deriveSyncArrays(answers: Answers): {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
} {
  const allergies: string[] = [];
  if (truthy(answers, "allergyAnesthetics")) allergies.push("Anestésicos locales");
  if (truthy(answers, "allergyPenicillin"))  allergies.push("Penicilina");
  if (truthy(answers, "allergyNsaids"))      allergies.push("AINEs / aspirina");
  if (truthy(answers, "allergyLatex"))       allergies.push("Látex");
  if (truthy(answers, "allergyOther"))       splitFree(answers.allergyOtherDetail).forEach((a) => allergies.push(a));

  const CONDITION_LABELS: Record<string, string> = {
    diabetes:      "Diabetes",
    hypertension:  "Hipertensión",
    heartDisease:  "Cardiopatía",
    rheumaticFever:"Fiebre reumática",
    hepatitis:     "Hepatitis",
    hiv:           "VIH",
    epilepsy:      "Epilepsia",
    asthma:        "Asma",
    thyroid:       "Tiroides",
    cancer:        "Cáncer",
    osteoporosis:  "Osteoporosis",
    coagulation:   "Trastorno de coagulación",
    kidneyLiver:   "Enfermedad renal / hepática",
  };
  const chronicConditions: string[] = [];
  Object.keys(CONDITION_LABELS).forEach((k) => {
    if (truthy(answers, k)) chronicConditions.push(CONDITION_LABELS[k]);
  });

  const currentMedications: string[] = splitFree(answers.currentMedications);
  if (truthy(answers, "anticoagulants")) currentMedications.push("Anticoagulantes");
  if (truthy(answers, "bisphosphonates")) currentMedications.push("Bifosfonatos");

  return { allergies, chronicConditions, currentMedications };
}

/**
 * Frescura del cuestionario vigente. `none` = nunca llenado; `stale` =
 * más viejo que STALE_AFTER_MONTHS; `ok` = vigente. Recibe el filledAt y
 * un timestamp de referencia (ms) para ser puro y testeable.
 */
export function questionnaireFreshness(
  filledAt: Date | string | null | undefined,
  nowMs: number,
): "none" | "stale" | "ok" {
  if (!filledAt) return "none";
  const t = filledAt instanceof Date ? filledAt.getTime() : new Date(filledAt).getTime();
  if (isNaN(t)) return "none";
  const months = (nowMs - t) / (1000 * 60 * 60 * 24 * 30.4375);
  return months > STALE_AFTER_MONTHS ? "stale" : "ok";
}
