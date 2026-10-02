/**
 * Tipos de archivo del expediente — UNA sola tabla para la ficha del paciente.
 *
 * Módulo puro (lo importa el navegador). Antes la ficha tenía su propio mapa de
 * nueve tipos y pintaba el código crudo («XRAY_CEPHALOMETRIC») para el resto, y
 * al subir mandaba «Periapical» fijo: una lateral o una panorámica quedaba mal
 * clasificada y no contaba para la reevaluación radiográfica del plan.
 */
import { guessFileCategory, type FileCategoryValue } from "@/lib/uploads/patient-bulk-file-upload";

/** Clave i18n (`patients.fileCat.*`) de cada categoría que existe en la base. */
export const CLAVE_ETIQUETA_CATEGORIA: Record<string, string> = {
  XRAY_PERIAPICAL: "patients.fileCat.periapical",
  XRAY_PANORAMIC: "patients.fileCat.panoramic",
  XRAY_BITEWING: "patients.fileCat.bitewing",
  XRAY_OCCLUSAL: "patients.fileCat.occlusal",
  XRAY_CBCT: "patients.fileCat.cbct",
  XRAY_CEPHALOMETRIC: "patients.fileCat.cephalometric",
  PHOTO_FRONTAL: "patients.fileCat.photoFrontal",
  PHOTO_LATERAL: "patients.fileCat.photoLateral",
  PHOTO_OCCLUSAL_UPPER: "patients.fileCat.photoOcclusalUpper",
  PHOTO_OCCLUSAL_LOWER: "patients.fileCat.photoOcclusalLower",
  PHOTO_INTRAORAL: "patients.fileCat.intraoral",
  PHOTO_EXTRAORAL: "patients.fileCat.extraoral",
  PHOTO_PROGRESS: "patients.fileCat.progress",
  PHOTO_PATIENT: "patients.fileCat.photoPatient",
  CONSENT_FORM: "patients.fileCat.consent",
  ORTHO_PHOTO_T0: "patients.fileCat.orthoT0",
  ORTHO_PHOTO_T1: "patients.fileCat.orthoT1",
  ORTHO_PHOTO_T2: "patients.fileCat.orthoT2",
  ORTHO_PHOTO_CONTROL: "patients.fileCat.orthoControl",
  CEPH_ANALYSIS_PDF: "patients.fileCat.cephPdf",
  SCAN_STL: "patients.fileCat.scanStl",
  OTHER: "patients.fileCat.other",
};

/**
 * Lo que se ofrece al SUBIR desde la ficha, en el orden en que lo busca una
 * clínica: radiografías primero. Los sets de ortodoncia (T0/T1/T2) y el STL
 * tienen su propio camino de subida y no se ofrecen aquí.
 */
export const CATEGORIAS_SUBIDA_FICHA = [
  "XRAY_PERIAPICAL",
  "XRAY_PANORAMIC",
  "XRAY_CEPHALOMETRIC",
  "XRAY_BITEWING",
  "XRAY_OCCLUSAL",
  "XRAY_CBCT",
  "PHOTO_INTRAORAL",
  "PHOTO_EXTRAORAL",
  "CEPH_ANALYSIS_PDF",
  "CONSENT_FORM",
  "OTHER",
] as const;
export type CategoriaSubidaFicha = (typeof CATEGORIAS_SUBIDA_FICHA)[number];

/**
 * El tipo más probable según el nombre del archivo, o `null` si el nombre no lo
 * dice. Nunca se inventa uno: un archivo «IMG_0341.jpg» no es periapical por
 * defecto — quien sube lo elige. La lista de la ficha no ofrece las categorías
 * de ortodoncia por etapa, así que lo que el adivinador devuelva fuera de ella
 * se traduce a su equivalente más cercano.
 */
export function categoriaSugeridaParaSubida(nombre: string): CategoriaSubidaFicha | null {
  const g: FileCategoryValue = guessFileCategory(nombre);
  if (g === "OTHER") return null;
  if ((CATEGORIAS_SUBIDA_FICHA as readonly string[]).includes(g)) return g as CategoriaSubidaFicha;
  if (g === "PHOTO_FRONTAL" || g === "PHOTO_LATERAL" || g === "PHOTO_PATIENT") return "PHOTO_EXTRAORAL";
  if (g === "PHOTO_OCCLUSAL_UPPER" || g === "PHOTO_OCCLUSAL_LOWER") return "PHOTO_INTRAORAL";
  return null;
}

/** Nombre en español (para el servidor: PDF, línea de tiempo, Movimientos). */
export const NOMBRE_CATEGORIA_ES: Record<string, string> = {
  XRAY_PERIAPICAL: "Periapical",
  XRAY_PANORAMIC: "Panorámica",
  XRAY_BITEWING: "Aleta de mordida",
  XRAY_OCCLUSAL: "Oclusal",
  XRAY_CBCT: "Tomografía (CBCT)",
  XRAY_CEPHALOMETRIC: "Lateral de cráneo (cefalométrica)",
  PHOTO_INTRAORAL: "Foto intraoral",
  PHOTO_EXTRAORAL: "Foto extraoral",
  PHOTO_FRONTAL: "Foto frontal",
  PHOTO_LATERAL: "Foto lateral",
  PHOTO_OCCLUSAL_UPPER: "Foto oclusal superior",
  PHOTO_OCCLUSAL_LOWER: "Foto oclusal inferior",
  PHOTO_PROGRESS: "Progreso",
  PHOTO_PATIENT: "Foto del paciente",
  CEPH_ANALYSIS_PDF: "Análisis cefalométrico (PDF)",
  CONSENT_FORM: "Consentimiento",
  OTHER: "Otro",
};

// ─── Filtrar por grupo (ficha y visor) ───────────────────────────────────

export const GRUPOS_ARCHIVO = ["radiografias", "fotos", "documentos", "ortodoncia"] as const;
export type GrupoArchivo = (typeof GRUPOS_ARCHIVO)[number];

/** Clave i18n de cada chip de grupo. */
export const CLAVE_GRUPO: Record<GrupoArchivo, string> = {
  radiografias: "patients.xrays.filtro.radiografias",
  fotos: "patients.xrays.filtro.fotos",
  documentos: "patients.xrays.filtro.documentos",
  ortodoncia: "patients.xrays.filtro.ortodoncia",
};

/** Etapas del chip «Ortodoncia»: la categoría que las guarda y su etiqueta. */
export const ETAPAS_ORTODONCIA = ["ORTHO_PHOTO_T0", "ORTHO_PHOTO_T1", "ORTHO_PHOTO_T2", "ORTHO_PHOTO_CONTROL"] as const;
export type EtapaOrtodoncia = (typeof ETAPAS_ORTODONCIA)[number];
export const CLAVE_ETAPA: Record<EtapaOrtodoncia, string> = {
  ORTHO_PHOTO_T0: "patients.xrays.filtro.etapaT0",
  ORTHO_PHOTO_T1: "patients.xrays.filtro.etapaT1",
  ORTHO_PHOTO_T2: "patients.xrays.filtro.etapaT2",
  ORTHO_PHOTO_CONTROL: "patients.xrays.filtro.etapaControl",
};

/**
 * A qué chip pertenece una categoría. Todo lo que no es radiografía ni foto ni
 * ortodoncia por etapa (PDF de trazado, consentimiento, modelo 3D, «Otro» y lo
 * que no conozcamos) cae en documentos: así ningún archivo desaparece de la
 * lista al filtrar.
 */
export function grupoDeCategoria(categoria: string | null | undefined): GrupoArchivo {
  const c = categoria ?? "";
  if (c.indexOf("XRAY_") === 0) return "radiografias";
  if (c.indexOf("ORTHO_PHOTO_") === 0) return "ortodoncia";
  if (c.indexOf("PHOTO_") === 0) return "fotos";
  return "documentos";
}

export interface FiltroArchivos {
  grupo: GrupoArchivo | null;
  etapa: EtapaOrtodoncia | null;
}
export const SIN_FILTRO: FiltroArchivos = { grupo: null, etapa: null };

export function filtrarArchivosPorGrupo<T extends { category: string }>(archivos: T[], filtro: FiltroArchivos): T[] {
  if (!filtro.grupo) return archivos;
  return archivos.filter((f) => {
    if (grupoDeCategoria(f.category) !== filtro.grupo) return false;
    return filtro.grupo === "ortodoncia" && filtro.etapa ? f.category === filtro.etapa : true;
  });
}

export function contarPorGrupo<T extends { category: string }>(archivos: T[]): Record<GrupoArchivo, number> {
  const n: Record<GrupoArchivo, number> = { radiografias: 0, fotos: 0, documentos: 0, ortodoncia: 0 };
  for (const f of archivos) n[grupoDeCategoria(f.category)] += 1;
  return n;
}

export function contarPorEtapa<T extends { category: string }>(archivos: T[]): Record<EtapaOrtodoncia, number> {
  const n: Record<EtapaOrtodoncia, number> = { ORTHO_PHOTO_T0: 0, ORTHO_PHOTO_T1: 0, ORTHO_PHOTO_T2: 0, ORTHO_PHOTO_CONTROL: 0 };
  for (const f of archivos) if ((ETAPAS_ORTODONCIA as readonly string[]).includes(f.category)) n[f.category as EtapaOrtodoncia] += 1;
  return n;
}

// ─── Cambiar el tipo de un archivo ya subido ─────────────────────────────

const DOCUMENTOS_PERMITIDOS: readonly string[] = ["CEPH_ANALYSIS_PDF", "CONSENT_FORM", "OTHER"];

/**
 * A qué tipos se puede cambiar un archivo ya subido. Solo cambia la etiqueta: el
 * archivo no se toca, así que no se ofrece lo que contradice su formato (un PDF
 * no es una periapical; una imagen no es un «PDF de trazado»). Los sets de fotos
 * de ortodoncia (T0/T1/T2/control) y los modelos 3D los amarra su propio módulo
 * por id: ni salen de su tipo ni se llega a ellos desde aquí.
 */
export function opcionesDeCambioDeTipo(actual: string, mimeType: string | null | undefined): CategoriaSubidaFicha[] {
  if (actual.indexOf("ORTHO_PHOTO_") === 0 || actual === "SCAN_STL") return [];
  const mime = (mimeType ?? "").toLowerCase();
  return CATEGORIAS_SUBIDA_FICHA.filter((c) => {
    if (c === actual) return false;
    if (mime === "application/pdf") return DOCUMENTOS_PERMITIDOS.includes(c);
    if (mime.indexOf("image/") === 0 || mime === "") return c !== "CEPH_ANALYSIS_PDF";
    // DICOM u otro formato clínico: solo radiografías u «Otro».
    return c.indexOf("XRAY_") === 0 || c === "OTHER";
  });
}

export function puedeCambiarTipo(actual: string, mimeType: string | null | undefined): boolean {
  return opcionesDeCambioDeTipo(actual, mimeType).length > 0;
}

// Forma plana a propósito: con `strict: false` TypeScript no estrecha por `ok`.
export interface ResultadoCambioDeTipo {
  ok: boolean;
  motivo?: "mismo_tipo" | "tipo_no_permitido" | "tipo_bloqueado";
}

export function validarCambioDeTipo(args: { actual: string; nuevo: string; mimeType: string | null | undefined }): ResultadoCambioDeTipo {
  if (args.actual === args.nuevo) return { ok: false, motivo: "mismo_tipo" };
  if (args.actual.indexOf("ORTHO_PHOTO_") === 0 || args.actual === "SCAN_STL") return { ok: false, motivo: "tipo_bloqueado" };
  if (!(opcionesDeCambioDeTipo(args.actual, args.mimeType) as string[]).includes(args.nuevo)) {
    return { ok: false, motivo: "tipo_no_permitido" };
  }
  return { ok: true };
}
