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

/** Nombre en español (para el servidor: PDF, línea de tiempo). */
export const NOMBRE_CATEGORIA_ES: Record<string, string> = {
  XRAY_PERIAPICAL: "Periapical",
  XRAY_PANORAMIC: "Panorámica",
  XRAY_BITEWING: "Aleta de mordida",
  XRAY_OCCLUSAL: "Oclusal",
  XRAY_CBCT: "Tomografía (CBCT)",
  XRAY_CEPHALOMETRIC: "Lateral de cráneo (cefalométrica)",
};
