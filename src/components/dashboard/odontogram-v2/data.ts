/* ============================================================
   ODONTOGRAMA v2 — DATA MODEL  (ported 1:1 from design js/data.js)
   Numbering systems, tooth anatomy classification, conditions,
   and bilingual (ES/EN) strings. Framework-agnostic, fully typed.
   NOTE: DEMO is intentionally NOT ported — real data loads via adapter.
   ============================================================ */
import type {
  ToothMeta, NumberLabel, Numbering, SurfaceLetter, Lang,
  Condition, ConditionTarget, RenderKind, Group,
} from "./types";

/* -----------------------------------------------------------
   1. TOOTH CLASSIFICATION (FDI-based)
   ----------------------------------------------------------- */
export function classify(fdi: number): ToothMeta {
  const q = Math.floor(fdi / 10);
  const n = fdi % 10;
  const upper = q === 1 || q === 2 || q === 5 || q === 6;
  const right = q === 1 || q === 4 || q === 5 || q === 8;
  const primary = q >= 5;
  let type: ToothMeta["type"];
  let roots: number;
  let posterior: boolean;
  if (!primary) {
    if (n <= 2) { type = n === 1 ? "central" : "lateral"; roots = 1; posterior = false; }
    else if (n === 3) { type = "canine"; roots = 1; posterior = false; }
    else if (n <= 5) { type = "premolar"; roots = (fdi === 14 || fdi === 24) ? 2 : 1; posterior = true; }
    else { type = "molar"; roots = upper ? 3 : 2; posterior = true; }
  } else {
    if (n <= 2) { type = n === 1 ? "central" : "lateral"; roots = 1; posterior = false; }
    else if (n === 3) { type = "canine"; roots = 1; posterior = false; }
    else { type = "molar"; roots = upper ? 3 : 2; posterior = true; } // primary molars
  }
  return {
    fdi, q, n, type, roots, posterior, upper, right, primary,
    arch: upper ? "upper" : "lower",
    side: right ? "right" : "left",
    center: posterior ? "O" : "I",
  };
}

/* -----------------------------------------------------------
   2. ARCH LAYOUTS (FDI numbers, chart order left→right)
   ----------------------------------------------------------- */
export const PERM: { upper: number[]; lower: number[] } = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};
export const PRIMARY: { upper: number[]; lower: number[] } = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};
// Mixed: permanent 6s + incisors erupted, rest primary (typical ~8yr).
export const MIXED: { upper: number[]; lower: number[] } = {
  upper: [16, 55, 54, 13, 12, 11, 21, 22, 23, 64, 65, 26],
  lower: [46, 85, 84, 43, 42, 41, 31, 32, 33, 74, 75, 36],
};

/* -----------------------------------------------------------
   3. NUMBERING SYSTEMS — map FDI → display label
   ----------------------------------------------------------- */
const UNIVERSAL_PERM: Record<number, string> = {
  18: "1", 17: "2", 16: "3", 15: "4", 14: "5", 13: "6", 12: "7", 11: "8",
  21: "9", 22: "10", 23: "11", 24: "12", 25: "13", 26: "14", 27: "15", 28: "16",
  38: "17", 37: "18", 36: "19", 35: "20", 34: "21", 33: "22", 32: "23", 31: "24",
  41: "25", 42: "26", 43: "27", 44: "28", 45: "29", 46: "30", 47: "31", 48: "32",
};
const UNIVERSAL_PRIM: Record<number, string> = {
  55: "A", 54: "B", 53: "C", 52: "D", 51: "E", 61: "F", 62: "G", 63: "H", 64: "I", 65: "J",
  75: "K", 74: "L", 73: "M", 72: "N", 71: "O", 81: "P", 82: "Q", 83: "R", 84: "S", 85: "T",
};

/** Palmer: number/letter + quadrant bracket. Returns { label, quad }. */
export function palmer(fdi: number): NumberLabel {
  const c = classify(fdi);
  const isPrimary = c.primary;
  const labelPerm = String(c.n);
  const labelPrim = ["", "A", "B", "C", "D", "E"][c.n];
  const label = isPrimary ? labelPrim : labelPerm;
  let quad: NumberLabel["quad"];
  if (c.upper && c.right) quad = "ur";
  else if (c.upper && !c.right) quad = "ul";
  else if (!c.upper && c.right) quad = "lr";
  else quad = "ll";
  return { label, quad };
}

export function numberLabel(fdi: number, system: Numbering): NumberLabel {
  const c = classify(fdi);
  if (system === "fdi") return { label: String(fdi) };
  if (system === "universal") {
    return { label: (c.primary ? UNIVERSAL_PRIM : UNIVERSAL_PERM)[fdi] || "?" };
  }
  if (system === "palmer") return palmer(fdi);
  return { label: String(fdi) };
}

/* -----------------------------------------------------------
   4. SURFACES (caras)
   ----------------------------------------------------------- */
export const SURFACES: { posterior: SurfaceLetter[]; anterior: SurfaceLetter[] } = {
  posterior: ["O", "M", "D", "V", "L"],
  anterior: ["I", "M", "D", "V", "L"],
};
export const SURFACE_NAMES: Record<SurfaceLetter, Record<Lang, string>> = {
  O: { es: "Oclusal", en: "Occlusal" },
  I: { es: "Incisal", en: "Incisal" },
  M: { es: "Mesial", en: "Mesial" },
  D: { es: "Distal", en: "Distal" },
  V: { es: "Vestibular", en: "Buccal / Facial" },
  L: { es: "Palatino / Lingual", en: "Palatal / Lingual" },
};

/* -----------------------------------------------------------
   5. SPECIALTY GROUPS (color per specialty)
   ----------------------------------------------------------- */
export const GROUPS: Group[] = [
  { id: "diagnostic",   color: "#E5484D", es: "Diagnóstico",     en: "Diagnostic" },
  { id: "restorative",  color: "#2A6FDB", es: "Restauradora",    en: "Restorative" },
  { id: "endodontics",  color: "#0E9F8E", es: "Endodoncia",      en: "Endodontics" },
  { id: "surgery",      color: "#8B5CF6", es: "Cirugía",         en: "Surgery" },
  { id: "orthodontics", color: "#6366F1", es: "Ortodoncia",      en: "Orthodontics" },
  { id: "preventive",   color: "#0891B2", es: "Preventivo",      en: "Preventive" },
  { id: "periodontics", color: "#D97706", es: "Periodoncia",     en: "Periodontics" },
  { id: "pediatric",    color: "#DB2777", es: "Odontopediatría", en: "Pediatric" },
];
export const GROUP_COLOR: Record<string, string> = {};
GROUPS.forEach((g) => { GROUP_COLOR[g.id] = g.color; });

/* -----------------------------------------------------------
   6. CONDITIONS (~45)
   target: 'surface' (mark a zone) | 'tooth' (whole)
   render: how it's drawn (see Surface2D / ToothGlyph)
   ----------------------------------------------------------- */
function C(
  id: string, group: string, es: string, en: string,
  target: ConditionTarget, render: RenderKind, extra?: Partial<Condition>,
): Condition {
  return { id, group, es, en, target, render, ...(extra || {}) };
}

export const CONDITIONS: Condition[] = [
  // ---- DIAGNOSTIC (red) ----
  C("caries",        "diagnostic", "Caries",            "Caries",            "surface", "fill"),
  C("caries_inc",    "diagnostic", "Caries incipiente", "Incipient caries",  "surface", "outline"),
  C("pigmentation",  "diagnostic", "Pigmentación",      "Pigmentation",      "surface", "stipple"),
  C("pulpitis",      "diagnostic", "Pulpitis",          "Pulpitis",          "tooth",   "badge", { letter: "P" }),
  C("necrosis",      "diagnostic", "Necrosis pulpar",   "Pulp necrosis",     "tooth",   "badge", { letter: "N" }),
  C("fracture",      "diagnostic", "Fractura",          "Fracture",          "tooth",   "fracture"),
  C("missing",       "diagnostic", "Ausente",           "Missing",           "tooth",   "missing"),
  C("periapical1",   "diagnostic", "Periapical <2mm",   "Periapical <2mm",   "tooth",   "apical", { mm: 1 }),
  C("periapical2",   "diagnostic", "Periapical 2–4mm",  "Periapical 2–4mm",  "tooth",   "apical", { mm: 2 }),
  C("periapical3",   "diagnostic", "Periapical >4mm",   "Periapical >4mm",   "tooth",   "apical", { mm: 3 }),
  C("rotated",       "diagnostic", "Rotado",            "Rotated",           "tooth",   "icon", { icon: "rotate" }),
  C("displaced",     "diagnostic", "Desplazado",        "Displaced",         "tooth",   "icon", { icon: "displace" }),
  C("unerupted",     "diagnostic", "No erupcionado",    "Unerupted",         "tooth",   "hatch"),
  C("mobility",      "diagnostic", "Movilidad",         "Mobility",          "tooth",   "roman", { degree: 1 }),

  // ---- RESTORATIVE (blue) ----
  C("restoration",   "restorative", "Restauración (resina/amalgama)", "Restoration (resin/amalgam)", "surface", "fill"),
  C("temp_rest",     "restorative", "Restauración temporal",  "Temporary restoration", "surface", "outline"),
  C("inlay",         "restorative", "Incrustación inlay/onlay", "Inlay / onlay",        "surface", "fill"),
  C("crown",         "restorative", "Corona",                 "Crown",                "tooth",   "ring"),
  C("veneer",        "restorative", "Carilla",                "Veneer",               "tooth",   "veneer"),
  C("post_core",     "restorative", "Perno / muñón",          "Post & core",          "tooth",   "post"),
  C("bridge_pontic", "restorative", "Póntico (puente)",       "Pontic (bridge)",      "tooth",   "pontic"),

  // ---- ENDODONTICS (teal) ----
  C("rct",           "endodontics", "Tratamiento de conducto", "Root canal (RCT)",    "tooth",   "endo"),
  C("pulpotomy",     "endodontics", "Pulpotomía",              "Pulpotomy",           "tooth",   "endo", { partial: true }),
  C("apexification", "endodontics", "Apicoformación",          "Apexification",       "tooth",   "endo"),
  C("retreatment",   "endodontics", "Retratamiento",           "RCT retreatment",     "tooth",   "endo", { dashed: true }),

  // ---- SURGERY (violet) ----
  C("ext_indicated", "surgery", "Extracción indicada", "Extraction indicated", "tooth", "cross", { soft: true }),
  C("ext_done",      "surgery", "Extracción realizada", "Extracted",           "tooth", "cross"),
  C("implant",       "surgery", "Implante",            "Implant",              "tooth", "implant"),
  C("impacted",      "surgery", "Diente impactado",    "Impacted tooth",       "tooth", "hatch"),
  C("root_remnant",  "surgery", "Resto radicular",     "Root remnant",         "tooth", "remnant"),
  C("apicoectomy",   "surgery", "Apicectomía",         "Apicoectomy",          "tooth", "apico"),

  // ---- ORTHODONTICS (indigo) ----
  C("bracket",       "orthodontics", "Bracket",        "Bracket",              "tooth", "bracket"),
  C("band",          "orthodontics", "Banda",          "Band",                 "tooth", "ring", { band: true }),
  C("diastema",      "orthodontics", "Diastema",       "Diastema",             "tooth", "icon", { icon: "diastema" }),
  C("migration",     "orthodontics", "Migración",      "Migration",            "tooth", "icon", { icon: "displace" }),

  // ---- PREVENTIVE (cyan) ----
  C("sealant",       "preventive", "Sellante",          "Sealant",             "surface", "dots", { surfacesOnly: ["O"] }),
  C("fluoride",      "preventive", "Aplicación de flúor", "Fluoride application", "tooth",  "icon", { icon: "drop" }),
  C("prophylaxis",   "preventive", "Profilaxis",        "Prophylaxis",         "tooth",   "icon", { icon: "sparkle" }),

  // ---- PERIODONTICS (amber) ----
  C("calculus",      "periodontics", "Cálculo",            "Calculus",           "surface", "dots"),
  C("recession",     "periodontics", "Recesión gingival",  "Gingival recession", "tooth",   "recession"),
  C("pocket",        "periodontics", "Bolsa periodontal",  "Periodontal pocket", "tooth",   "icon", { icon: "probe" }),
  C("bleeding",      "periodontics", "Sangrado al sondaje", "Bleeding on probing", "tooth",  "icon", { icon: "drop" }),
  C("furcation",     "periodontics", "Lesión de furca",    "Furcation",          "tooth",   "icon", { icon: "furca" }),
  C("perio_mobility", "periodontics", "Movilidad dental",  "Tooth mobility",     "tooth",   "roman", { degree: 2 }),

  // ---- PEDIATRIC (pink) ----
  C("steel_crown",   "pediatric", "Corona de acero",      "Stainless steel crown", "tooth", "ring", { steel: true }),
  C("space_maint",   "pediatric", "Mantenedor de espacio", "Space maintainer",     "tooth", "icon", { icon: "maintainer" }),
  C("pulpotomy_ped", "pediatric", "Pulpotomía (temporal)", "Pulpotomy (primary)",  "tooth", "endo", { partial: true }),
];

export const COND_BY_ID: Record<string, Condition> = {};
CONDITIONS.forEach((c) => { COND_BY_ID[c.id] = c; });

/* -----------------------------------------------------------
   7. I18N — interface strings
   ----------------------------------------------------------- */
export const I18N: Record<Lang, Record<string, string>> = {
  es: {
    title: "Odontograma",
    subtitle: "Registro clínico completo",
    upperArch: "Arcada superior",
    lowerArch: "Arcada inferior",
    permanent: "Permanente",
    primary: "Temporal",
    mixed: "Mixta",
    adult: "Adulto",
    child: "Niño",
    numbering: "Numeración",
    language: "Idioma",
    dentition: "Dentición",
    legend: "Leyenda",
    selectTool: "Selecciona un hallazgo y luego haz clic en el diente o cara",
    brush: "Hallazgo activo",
    none: "Ninguno",
    clear: "Limpiar",
    clearAll: "Limpiar todo",
    tooth: "Diente",
    surfaces: "Caras",
    view3d: "Vista 3D",
    view2d: "Vista 2D",
    notes: "Notas clínicas",
    notesPh: "Escribe observaciones del diente…",
    history: "Hallazgos registrados",
    noFindings: "Sin hallazgos registrados",
    remove: "Quitar",
    close: "Cerrar",
    rotate: "Arrastra para rotar · clic en una cara",
    resetView: "Reiniciar vista",
    summary: "Resumen",
    teeth: "dientes",
    findings: "hallazgos",
    eraser: "Borrador",
    clickFace: "Haz clic en una cara para aplicar",
    patient: "Paciente",
    examType: "Examen",
    style: "Estilo",
  },
  en: {
    title: "Dental Chart",
    subtitle: "Complete clinical record",
    upperArch: "Upper arch",
    lowerArch: "Lower arch",
    permanent: "Permanent",
    primary: "Primary",
    mixed: "Mixed",
    adult: "Adult",
    child: "Child",
    numbering: "Numbering",
    language: "Language",
    dentition: "Dentition",
    legend: "Legend",
    selectTool: "Pick a finding, then click a tooth or surface",
    brush: "Active finding",
    none: "None",
    clear: "Clear",
    clearAll: "Clear all",
    tooth: "Tooth",
    surfaces: "Surfaces",
    view3d: "3D view",
    view2d: "2D view",
    notes: "Clinical notes",
    notesPh: "Write tooth observations…",
    history: "Recorded findings",
    noFindings: "No findings recorded",
    remove: "Remove",
    close: "Close",
    rotate: "Drag to rotate · click a face",
    resetView: "Reset view",
    summary: "Summary",
    teeth: "teeth",
    findings: "findings",
    eraser: "Eraser",
    clickFace: "Click a face to apply",
    patient: "Patient",
    examType: "Exam",
    style: "Style",
  },
};
