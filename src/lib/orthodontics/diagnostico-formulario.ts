// Ortodoncia — el formulario del paso «Diagnóstico» (ws1-t8). PURO: lo usa el componente `PasoDiagnostico`
// (en «Editar diagnóstico» y en el paso 1 de la ventana «Abrir caso» de ws1-t12) y lo prueban los tests.
//
// Un dato, un lugar (reglas del gerente, 29-sep-2026): aquí NO se piden la línea media única, las categorías
// de overjet/overbite, el grado de apiñamiento ni la mordida cruzada/abierta sí-no: se DERIVAN al armar la
// petición. Tampoco el doctor que refirió ni «en observación» (son del caso, no del diagnóstico).

import {
  HABITOS_DEL_PASO,
  SECCIONES_DEL_DETALLE,
  camposConDato,
  diagnosticoDetalleVacio,
  lineaMediaDerivada,
  mordidasDerivadas,
  normalizarDiagnosticoDetalle,
  validarDiagnosticoDetalle,
  type DiagnosticoBase,
  type DiagnosticoDetalle,
} from "./diagnostico-detalle";

export const ANGLE_OPCIONES = [
  { valor: "CLASS_I", etiqueta: "Clase I" },
  { valor: "CLASS_II_DIV_1", etiqueta: "II div. 1" },
  { valor: "CLASS_II_DIV_2", etiqueta: "II div. 2" },
  { valor: "CLASS_III", etiqueta: "Clase III" },
  { valor: "ASYMMETRIC", etiqueta: "Asimétrica" },
] as const;
export const FASE_OPCIONES = [
  { valor: "DECIDUOUS", etiqueta: "Temporal" },
  { valor: "MIXED_EARLY", etiqueta: "Mixta temprana" },
  { valor: "MIXED_LATE", etiqueta: "Mixta tardía" },
  { valor: "PERMANENT", etiqueta: "Permanente" },
] as const;
export const PATRON_OPCIONES = [
  { valor: "DOLICOFACIAL", etiqueta: "Dolicofacial" },
  { valor: "MESOFACIAL", etiqueta: "Mesofacial" },
  { valor: "BRAQUIFACIAL", etiqueta: "Braquifacial" },
] as const;

export interface FormularioDelDiagnostico {
  angleClassRight: string;
  angleClassLeft: string;
  /** Texto tal cual se escribe («2,5»); se convierte al armar la petición. */
  overjetMm: string;
  overbiteMm: string;
  overbitePercentage: string;
  crowdingUpperMm: string;
  crowdingLowerMm: string;
  dentalPhase: string;
  skeletalPattern: string;
  crossbiteDetails: string;
  openBiteDetails: string;
  habits: string[];
  habitsDescription: string;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  tmjNotes: string;
  etiologySkeletal: boolean;
  etiologyDental: boolean;
  etiologyFunctional: boolean;
  etiologyNotes: string;
  clinicalSummary: string;
  /** Registros iniciales: el PDF del trazado cefalométrico y el escaneo (archivos del paciente). "" = ninguno. */
  initialCephFileId: string;
  initialScanFileId: string;
  detalle: DiagnosticoDetalle;
}

export type DiagnosticoParaFormulario = DiagnosticoBase & {
  initialCephFileId?: string | null;
  initialScanFileId?: string | null;
};

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function formularioVacio(): FormularioDelDiagnostico {
  return {
    angleClassRight: "CLASS_I",
    angleClassLeft: "CLASS_I",
    overjetMm: "",
    overbiteMm: "",
    overbitePercentage: "",
    crowdingUpperMm: "",
    crowdingLowerMm: "",
    dentalPhase: "PERMANENT",
    skeletalPattern: "",
    crossbiteDetails: "",
    openBiteDetails: "",
    habits: [],
    habitsDescription: "",
    tmjPainPresent: false,
    tmjClickingPresent: false,
    tmjNotes: "",
    etiologySkeletal: false,
    etiologyDental: false,
    etiologyFunctional: false,
    etiologyNotes: "",
    clinicalSummary: "",
    initialCephFileId: "",
    initialScanFileId: "",
    detalle: diagnosticoDetalleVacio(),
  };
}

/** El formulario desde un diagnóstico guardado. El hábito viejo «respiración bucal» pasa a «Tipo de respiración: oral». */
export function formularioDesdeDiagnostico(base: DiagnosticoParaFormulario, detalle: DiagnosticoDetalle | null): FormularioDelDiagnostico {
  const d = normalizarDiagnosticoDetalle(detalle ?? null);
  if (!d.funcional.respiracion && base.habits.includes("MOUTH_BREATHING")) d.funcional.respiracion = "oral";
  // Sin líneas medias nuevas pero con la vieja «centrada» (0): se propone centrada en las dos.
  if (!d.oclusal.lineaMediaSuperior && !d.oclusal.lineaMediaInferior && base.midlineDeviationMm === 0) {
    d.oclusal.lineaMediaSuperior = "centrada";
    d.oclusal.lineaMediaInferior = "centrada";
  }
  return {
    angleClassRight: base.angleClassRight,
    angleClassLeft: base.angleClassLeft,
    overjetMm: txt(base.overjetMm),
    overbiteMm: txt(base.overbiteMm),
    overbitePercentage: base.overbitePercentage ? String(base.overbitePercentage) : "",
    crowdingUpperMm: base.crowdingUpperMm ? String(base.crowdingUpperMm) : "",
    crowdingLowerMm: base.crowdingLowerMm ? String(base.crowdingLowerMm) : "",
    dentalPhase: base.dentalPhase ?? "PERMANENT",
    skeletalPattern: base.skeletalPattern ?? "",
    crossbiteDetails: base.crossbiteDetails ?? "",
    openBiteDetails: base.openBiteDetails ?? "",
    habits: base.habits.filter((h) => (HABITOS_DEL_PASO as readonly string[]).includes(h)),
    habitsDescription: base.habitsDescription ?? "",
    tmjPainPresent: base.tmjPainPresent,
    tmjClickingPresent: base.tmjClickingPresent,
    tmjNotes: base.tmjNotes ?? "",
    etiologySkeletal: base.etiologySkeletal,
    etiologyDental: base.etiologyDental,
    etiologyFunctional: base.etiologyFunctional,
    etiologyNotes: base.etiologyNotes ?? "",
    clinicalSummary: base.clinicalSummary ?? "",
    initialCephFileId: base.initialCephFileId ?? "",
    initialScanFileId: base.initialScanFileId ?? "",
    detalle: d,
  };
}

/** Lo que se manda a `updateDiagnosis` (o, con `diagnosisId` ausente, lo que usa el alta de ws1-t12). */
export interface PeticionDelDiagnostico {
  angleClassRight: string;
  angleClassLeft: string;
  /** Ausentes = no se tocan (las columnas son NOT NULL: vaciar el campo no borra el dato). */
  overjetMm?: number;
  overbiteMm?: number;
  overbitePercentage?: number;
  crowdingUpperMm: number | null;
  crowdingLowerMm: number | null;
  midlineDeviationMm?: number;
  crossbite?: boolean;
  crossbiteDetails: string | null;
  openBite?: boolean;
  openBiteDetails: string | null;
  dentalPhase: string;
  skeletalPattern: string | null;
  habits: string[];
  habitsDescription: string | null;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  tmjNotes: string | null;
  etiologySkeletal: boolean;
  etiologyDental: boolean;
  etiologyFunctional: boolean;
  etiologyNotes: string | null;
  clinicalSummary?: string;
  initialCephFileId: string | null;
  initialScanFileId: string | null;
  diagnosticoDetalle: DiagnosticoDetalle;
}

export function leerNumero(t: string): number | null | "invalido" {
  const s = t.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : "invalido";
}

export const RESUMEN_MINIMO = 40;

/**
 * El formulario como petición, con los derivados. `modo: "abrir"` deja el resumen para después (al abrir el
 * caso solo son obligatorios técnica y doctor); `"editar"` lo pide porque la columna ya lo tiene.
 * Devuelve también la SECCIÓN del paso donde está el error, para llevar ahí al doctor.
 */
export function formularioAPeticion(
  f: FormularioDelDiagnostico,
  modo: "abrir" | "editar" = "editar",
): { ok: true; peticion: PeticionDelDiagnostico } | { ok: false; error: string; seccion: string } {
  const rangos: Array<[keyof FormularioDelDiagnostico, string, number, number, string]> = [
    ["overjetMm", "Overjet", -5, 20, "clasificacion"],
    ["overbiteMm", "Overbite", -10, 15, "clasificacion"],
    ["overbitePercentage", "Overbite (%)", 0, 100, "clasificacion"],
    ["crowdingUpperMm", "Apiñamiento superior", 0, 20, "dentoalveolar"],
    ["crowdingLowerMm", "Apiñamiento inferior", 0, 20, "dentoalveolar"],
  ];
  const n: Partial<Record<keyof FormularioDelDiagnostico, number | null>> = {};
  for (const [k, et, min, max, sec] of rangos) {
    const v = leerNumero(f[k] as string);
    if (v === "invalido") return { ok: false, error: `${et}: escribe un número.`, seccion: sec };
    if (v !== null && (v < min || v > max)) return { ok: false, error: `${et}: de ${min} a ${max}.`, seccion: sec };
    n[k] = v;
  }
  if (n.overbitePercentage !== null && n.overbitePercentage !== undefined && !Number.isInteger(n.overbitePercentage)) {
    return { ok: false, error: "Overbite (%): un número entero.", seccion: "clasificacion" };
  }
  const resumen = f.clinicalSummary.trim();
  if (resumen && resumen.length < RESUMEN_MINIMO) {
    return { ok: false, error: `Resumen diagnóstico: al menos ${RESUMEN_MINIMO} caracteres (van ${resumen.length}).`, seccion: "resumen" };
  }
  if (!resumen && modo === "editar") {
    return { ok: false, error: `Resumen diagnóstico: escríbelo (al menos ${RESUMEN_MINIMO} caracteres).`, seccion: "resumen" };
  }
  if (resumen.length > 5000) return { ok: false, error: "Resumen diagnóstico: máximo 5000 caracteres.", seccion: "resumen" };

  const v = validarDiagnosticoDetalle(f.detalle);
  if (v.ok === false) {
    const sec = ["facial", "oclusal", "dentoalveolar", "funcional", "cefalometria"].find((s) => v.error.startsWith(tituloCorto(s))) ?? "clasificacion";
    return { ok: false, error: v.error, seccion: sec };
  }
  const detalle = v.detalle;
  const mordidas = mordidasDerivadas(detalle);
  const linea = lineaMediaDerivada(detalle);
  const t = (s: string) => s.trim() || null;

  const peticion: PeticionDelDiagnostico = {
    angleClassRight: f.angleClassRight,
    angleClassLeft: f.angleClassLeft,
    ...(n.overjetMm !== null && n.overjetMm !== undefined ? { overjetMm: n.overjetMm } : {}),
    ...(n.overbiteMm !== null && n.overbiteMm !== undefined ? { overbiteMm: n.overbiteMm } : {}),
    ...(n.overbitePercentage !== null && n.overbitePercentage !== undefined ? { overbitePercentage: n.overbitePercentage } : {}),
    crowdingUpperMm: n.crowdingUpperMm || null,
    crowdingLowerMm: n.crowdingLowerMm || null,
    ...(linea !== undefined ? { midlineDeviationMm: linea } : {}),
    ...mordidas,
    crossbiteDetails: t(f.crossbiteDetails),
    openBiteDetails: t(f.openBiteDetails),
    dentalPhase: f.dentalPhase,
    skeletalPattern: f.skeletalPattern || null,
    // La respiración bucal ya no es hábito: vive en «Tipo de respiración».
    habits: f.habits.filter((h) => h !== "MOUTH_BREATHING"),
    habitsDescription: t(f.habitsDescription),
    tmjPainPresent: f.tmjPainPresent,
    tmjClickingPresent: f.tmjClickingPresent,
    tmjNotes: t(f.tmjNotes),
    etiologySkeletal: f.etiologySkeletal,
    etiologyDental: f.etiologyDental,
    etiologyFunctional: f.etiologyFunctional,
    etiologyNotes: t(f.etiologyNotes),
    ...(resumen ? { clinicalSummary: resumen } : {}),
    initialCephFileId: f.initialCephFileId || null,
    initialScanFileId: f.initialScanFileId || null,
    diagnosticoDetalle: detalle,
  };
  return { ok: true, peticion };
}

function tituloCorto(s: string): string {
  return (
    {
      facial: "Características faciales",
      oclusal: "Análisis oclusal",
      dentoalveolar: "Dentoalveolar",
      funcional: "Funcional",
      cefalometria: "Análisis cefalométrico",
    } as Record<string, string>
  )[s]!;
}

// ─── Las secciones del paso ─────────────────────────────────────────────

export const SECCIONES_DEL_PASO = [
  { clave: "clasificacion", titulo: "Clasificación", sub: "Angle (dental), overjet y overbite en mm y etapa de dentición." },
  { clave: "facial", titulo: "Características faciales", sub: "Lo que se ve de frente y de perfil." },
  { clave: "oclusal", titulo: "Oclusal y dentario", sub: "Líneas medias, planos, curvas y forma de los arcos." },
  { clave: "dentoalveolar", titulo: "Dentoalveolar", sub: "Apiñamiento, espacios, mordidas cruzadas y abiertas, piezas." },
  { clave: "funcional", titulo: "Funcional y ATM", sub: "Respiración, sueño, vía aérea, hábitos y articulación." },
  { clave: "cefalometria", titulo: "Cefalometría", sub: "Valores escritos a mano del trazado; el patrón esquelético vive aquí." },
  { clave: "etiologia", titulo: "Etiología", sub: "De dónde viene la maloclusión." },
  { clave: "registros", titulo: "Registros iniciales", sub: "PDF del trazado, escaneo y fotos con los que se diagnosticó." },
  { clave: "resumen", titulo: "Resumen diagnóstico", sub: "La conclusión, en palabras del doctor." },
] as const;
export type SeccionDelPaso = (typeof SECCIONES_DEL_PASO)[number]["clave"];

const totalDetalle = (s: string) => SECCIONES_DEL_DETALLE.find((x) => x.clave === s)?.campos.length ?? 0;

/** Cuántos datos tiene cada sección del paso, de cuántos (el contador del índice). */
export function avanceDelPaso(f: FormularioDelDiagnostico): Record<SeccionDelPaso, { llenos: number; total: number }> {
  const hay = (t: string) => (t.trim() ? 1 : 0);
  const d = f.detalle;
  return {
    clasificacion: { llenos: 2 + hay(f.overjetMm) + hay(f.overbiteMm) + hay(f.overbitePercentage) + (f.dentalPhase ? 1 : 0), total: 6 },
    facial: { llenos: camposConDato(d, "facial"), total: totalDetalle("facial") },
    oclusal: { llenos: camposConDato(d, "oclusal"), total: totalDetalle("oclusal") },
    dentoalveolar: {
      llenos: camposConDato(d, "dentoalveolar") + hay(f.crowdingUpperMm) + hay(f.crowdingLowerMm) + hay(f.crossbiteDetails) + hay(f.openBiteDetails),
      total: totalDetalle("dentoalveolar") + 4,
    },
    funcional: {
      llenos:
        camposConDato(d, "funcional") +
        (f.habits.length ? 1 : 0) +
        hay(f.habitsDescription) +
        (f.tmjPainPresent || f.tmjClickingPresent ? 1 : 0) +
        hay(f.tmjNotes),
      total: totalDetalle("funcional") + 4,
    },
    cefalometria: { llenos: camposConDato(d, "cefalometria") + (f.skeletalPattern ? 1 : 0), total: totalDetalle("cefalometria") + 1 },
    etiologia: { llenos: (f.etiologySkeletal || f.etiologyDental || f.etiologyFunctional ? 1 : 0) + hay(f.etiologyNotes), total: 2 },
    registros: { llenos: (f.initialCephFileId ? 1 : 0) + (f.initialScanFileId ? 1 : 0), total: 2 },
    resumen: { llenos: f.clinicalSummary.trim().length >= RESUMEN_MINIMO ? 1 : 0, total: 1 },
  };
}

// ─── Para la ventana del caso (ws1-t12): guardar los DOS pasos con un solo «Guardar» ──────────

/** ¿El paso cambió respecto a como se abrió? (Para avisar o para saber si hay que guardar el diagnóstico.) */
export function hayCambiosEnElDiagnostico(inicial: FormularioDelDiagnostico, actual: FormularioDelDiagnostico): boolean {
  return JSON.stringify(inicial) !== JSON.stringify(actual);
}

/**
 * La entrada lista para el servidor (`updateDiagnosis`, o `prepararGuardadoDelDiagnostico` dentro de la acción
 * que guarda diagnóstico + plan juntos), o el error con la sección del paso a la que hay que llevar al doctor.
 */
export function entradaParaGuardar(
  diagnosisId: string,
  f: FormularioDelDiagnostico,
  modo: "abrir" | "editar" = "editar",
): { ok: true; entrada: { diagnosisId: string } & PeticionDelDiagnostico } | { ok: false; error: string; seccion: SeccionDelPaso } {
  const r = formularioAPeticion(f, modo);
  if (r.ok === false) return { ok: false, error: r.error, seccion: r.seccion as SeccionDelPaso };
  return { ok: true, entrada: { diagnosisId, ...r.peticion } };
}
