/**
 * QUÉ VISOR ABRE UN ARCHIVO — la extensión y nada más.
 *
 * Es la MISMA regla que aplica el dental en `Models3DTab.tsx` (isZip /
 * formatFromName) y la misma que aplica el servidor para decidir el `kind`
 * de la fila (`eduStudyKindForExt`). Se decide por el archivo y no por el
 * `kind` guardado porque el archivo no puede mentir: si alguien vuelve a
 * escribir tipos a mano, un .zip de 600 MB marcado como "Foto" acabaría en
 * un <img> en vez de en el visor de tomografía.
 *
 * 🔴 MÓDULO SIN NI UNA IMPORTACIÓN, y eso es a propósito: así la elección
 * del visor se puede PROBAR de verdad (edu-visor.test.ts la importa y la
 * ejecuta) en vez de comprobarla buscando texto dentro de un .tsx que el
 * corredor de pruebas no puede cargar.
 */

export type EduVisorTipo = "cbct" | "dicom" | "malla" | null;

/** Extensión en minúsculas ("ESTUDIO.ZIP" → "zip"). */
function extension(name: string): string {
  if (typeof name !== "string") return "";
  return (name.split(".").pop() ?? "").toLowerCase();
}

/**
 * · .zip           → DicomSetViewer  (set CBCT: rejilla MPR + volumen 3D)
 * · .dcm / .dicom  → DicomViewer2D   (corte único)
 * · .stl/.ply/.obj → Model3DViewer   (malla del escáner intraoral)
 * · cualquier otra → null: no hay visor 3D que lo abra (una imagen o un
 *   PDF se pintan en la hoja normal del vertical; lo demás se descarga).
 */
export function eduVisorPorExtension(name: string): EduVisorTipo {
  switch (extension(name)) {
    case "zip":
      return "cbct";
    case "dcm":
    case "dicom":
      return "dicom";
    case "stl":
    case "ply":
    case "obj":
      return "malla";
    default:
      return null;
  }
}
