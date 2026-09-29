/**
 * Uso de almacenamiento de una clínica — módulo PURO (sin Prisma ni React).
 * La lectura de la base vive en `@/lib/storage-usage` (server); aquí solo están
 * las categorías, la suma y los umbrales de aviso, para poder probarlos y para
 * que la tarjeta de Suscripción, la cuota de subida y /admin lean lo mismo.
 */

/** Las cinco cosas que la clínica ve en el desglose. */
export const CATEGORIAS_ALMACENAMIENTO = ["fotos", "radiografias", "modelos3d", "documentos", "otros"] as const;
export type CategoriaAlmacenamiento = (typeof CATEGORIAS_ALMACENAMIENTO)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaAlmacenamiento, string> = {
  fotos: "Fotos",
  radiografias: "Radiografías y CBCT",
  modelos3d: "Modelos 3D",
  documentos: "Documentos",
  otros: "Otros",
};

export type DesgloseAlmacenamiento = Record<CategoriaAlmacenamiento, number>;

export function desgloseVacio(): DesgloseAlmacenamiento {
  return { fotos: 0, radiografias: 0, modelos3d: 0, documentos: 0, otros: 0 };
}

export function totalDesglose(d: DesgloseAlmacenamiento): number {
  return CATEGORIAS_ALMACENAMIENTO.reduce((s, c) => s + d[c], 0);
}

/** A qué categoría cae cada `FileCategory` de patient_files. */
export function categoriaDeArchivo(category: string, esCbct = false): CategoriaAlmacenamiento {
  if (category === "SCAN_STL") return esCbct ? "radiografias" : "modelos3d";
  if (category.startsWith("XRAY_")) return "radiografias";
  if (category.startsWith("PHOTO_") || category.startsWith("ORTHO_PHOTO_")) return "fotos";
  if (category === "CONSENT_FORM" || category === "CEPH_ANALYSIS_PDF") return "documentos";
  return "otros";
}

/** A qué categoría cae cada `kind` de clinic_storage_objects. */
export const KINDS_OBJETO_ALMACEN = [
  "CBCT_LITE",
  "MODEL_WEB",
  "PHOTO_THUMB",
  "SIGNATURE",
  "RECEIPT",
  "LANDING",
  "SUPPORT",
] as const;
export type KindObjetoAlmacen = (typeof KINDS_OBJETO_ALMACEN)[number];

export function categoriaDeObjeto(kind: string): CategoriaAlmacenamiento {
  switch (kind) {
    case "CBCT_LITE":
      return "radiografias";
    case "MODEL_WEB":
      return "modelos3d";
    case "PHOTO_THUMB":
      return "fotos";
    case "RECEIPT":
      return "documentos";
    default:
      return "otros"; // firmas, landing/web, soporte
  }
}

export interface FilaAgrupada {
  clave: string;
  bytes: number;
}

/** Suma filas (categoría/kind → bytes) al desglose con la función de categoría dada. */
export function sumarEnDesglose(
  d: DesgloseAlmacenamiento,
  filas: FilaAgrupada[],
  categoriaDe: (clave: string) => CategoriaAlmacenamiento,
): DesgloseAlmacenamiento {
  for (const f of filas) d[categoriaDe(f.clave)] += Math.max(0, f.bytes || 0);
  return d;
}

/** Aviso al 80 % y al 95 % (el 100 % es «lleno»). Sin tope = siempre ok. */
export const ALMACENAMIENTO_AVISO = 0.8;
export const ALMACENAMIENTO_CRITICO = 0.95;

export type NivelAlmacenamiento = "ok" | "aviso" | "critico" | "lleno";

export function nivelAlmacenamiento(usado: number, tope: number | null | undefined): NivelAlmacenamiento {
  if (tope === null || tope === undefined || tope <= 0) return "ok";
  if (usado >= tope) return "lleno";
  const r = usado / tope;
  if (r >= ALMACENAMIENTO_CRITICO) return "critico";
  return r >= ALMACENAMIENTO_AVISO ? "aviso" : "ok";
}

export interface ResumenAlmacenamiento {
  usado: number;
  tope: number | null;
  /** 0–100 entero, o null si el plan es ilimitado. */
  porcentaje: number | null;
  nivel: NivelAlmacenamiento;
  desglose: DesgloseAlmacenamiento;
}

export function resumirAlmacenamiento(desglose: DesgloseAlmacenamiento, tope: number | null): ResumenAlmacenamiento {
  const usado = totalDesglose(desglose);
  return {
    usado,
    tope,
    porcentaje: tope && tope > 0 ? Math.min(100, Math.round((usado / tope) * 100)) : null,
    nivel: nivelAlmacenamiento(usado, tope),
    desglose,
  };
}

/** «12.4 GB», «830 MB»: GB con un decimal desde 1 GB; MB entero desde 1 MB. */
export function bytesLegibles(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (n >= GB) return `${(n / GB).toFixed(1).replace(/\.0$/, "")} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  return "<1 MB";
}
