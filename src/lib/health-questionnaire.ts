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
  detail?: boolean;     // muestra un campo de detalle al marcar "sí"
  detailLabel?: string; // etiqueta del campo de detalle
  detailPlaceholder?: string;
}

export interface QGroup {
  id: string;
  title: string;
  questions: QDef[];
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

export const QUESTIONNAIRE_GROUPS: QGroup[] = [
  { id: "padecimientos", title: "Padecimientos", questions: PADECIMIENTOS },
  { id: "alergias",      title: "Alergias",      questions: ALERGIAS },
  { id: "habitos",       title: "Hábitos",       questions: HABITOS },
];

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
