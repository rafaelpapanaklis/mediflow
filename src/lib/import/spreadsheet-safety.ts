// Utilidades de seguridad del importador que NO dependen de exceljs/Prisma:
// nombres de archivo saneados (para mostrar/registrar, nunca para construir una
// ruta de disco) y neutralización de inyección de fórmulas cuando un valor
// importado se vuelva a escribir alguna vez en un .csv/.xlsx exportable.
//
// El resto de la validación por CONTENIDO (magic bytes, macros, bombas zip,
// cifrado) vive en `@/lib/validate-upload` (validateSpreadsheet), que es el
// punto real de enchufe para `src/lib/uploads/validar-archivo.ts` (ws1-t8)
// cuando exista.

const MAX_UPLOAD_FILE_NAME = 180;

/**
 * Nombre de archivo saneado para mostrarlo o guardarlo en un log/registro:
 * quita separadores de ruta y caracteres de control, colapsa espacios y
 * recorta la longitud. NUNCA se usa el nombre crudo del cliente para construir
 * una ruta de Storage/disco (mismo criterio que `safeBulkFileName` en
 * `patient-bulk-file-upload.ts`, que ya hace esto para "archivos en bloque").
 */
export function sanitizeUploadFileName(name: string): string {
  const sinRuta = String(name ?? "").replace(/^.*[/\\]/, "");
  // eslint-disable-next-line no-control-regex
  const sinControl = sinRuta.replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim();
  const limpio = sinControl.length > MAX_UPLOAD_FILE_NAME ? sinControl.slice(0, MAX_UPLOAD_FILE_NAME) : sinControl;
  return limpio || "archivo";
}

const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Neutraliza "inyección de fórmulas" (CSV/Excel injection, OWASP): si el valor
 * empieza con =, +, -, @ (o tab/CR), Excel/Sheets lo trata como fórmula al
 * abrir un .csv/.xlsx que lo contenga — un campo de texto importado tal cual
 * ("=cmd|'/c calc'!A1" disfrazado de nombre de paciente) podría ejecutarse en
 * la máquina de quien abra un reporte exportado más tarde. Antepone una
 * comilla simple (que Excel/Sheets interpreta como "texto, no fórmula") y deja
 * el valor intacto en cualquier otro caso.
 *
 * Este importador NUNCA evalúa fórmulas de lo que sube el usuario (exceljs no
 * tiene motor de fórmulas: solo lee el valor/texto que Excel ya calculó,
 * `cellToRaw` en engine.ts) — esto protege el sentido CONTRARIO: cuando un
 * valor que SE IMPORTÓ se vuelva a escribir en un archivo descargable.
 * Se aplica en el punto donde se genere ese archivo (hoy el importador no
 * tiene ninguno: "reporte de errores descargable" sigue sin construirse,
 * `result-panel.tsx` → `onDownloadReport` es un TODO).
 */
export function neutralizeFormulaPrefix(value: string): string {
  const s = String(value ?? "");
  if (s.length === 0) return s;
  return FORMULA_PREFIXES.has(s[0]) ? `'${s}` : s;
}
