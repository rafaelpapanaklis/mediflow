import { fileTypeFromBuffer } from "file-type";

/**
 * Valida magic number del archivo contra la whitelist MIME.
 * El browser MIME (file.type) es falseable — este chequea los primeros bytes.
 * Sirve para formatos que `file-type` SÍ reconoce (imágenes, pdf, zip, etc.).
 * Devuelve null si todo OK, o un mensaje de error.
 */
export async function validateMagicNumber(
  bytes: ArrayBuffer | Uint8Array,
  allowed: string[],
): Promise<string | null> {
  const buf = ArrayBuffer.isView(bytes)
    ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Buffer.from(bytes);
  const detected = await fileTypeFromBuffer(buf);
  if (!detected) {
    return "No se pudo detectar el tipo de archivo";
  }
  if (!allowed.includes(detected.mime)) {
    return `Tipo real del archivo (${detected.mime}) no permitido`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers de bytes y firmas peligrosas
// ---------------------------------------------------------------------------

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/** Vista (sin copia) de los primeros bytes del archivo para inspección. */
function headOf(bytes: ArrayBuffer, max = 4100): Buffer {
  return Buffer.from(bytes, 0, Math.min(bytes.byteLength, max));
}

/**
 * Detecta ejecutables/binarios que NUNCA deben aceptarse como modelo 3D,
 * imagen, hoja de cálculo ni documento, sin importar la extensión declarada.
 * Devuelve el nombre del formato peligroso, o null si no coincide.
 */
function dangerousExecutable(buf: Buffer): string | null {
  const sigs: Array<[string, number[]]> = [
    ["ejecutable de Windows (.exe/.dll)", [0x4d, 0x5a]], // MZ
    ["ejecutable de Linux (ELF)", [0x7f, 0x45, 0x4c, 0x46]], // \x7fELF
    ["ejecutable de macOS (Mach-O)", [0xfe, 0xed, 0xfa, 0xce]],
    ["ejecutable de macOS (Mach-O)", [0xfe, 0xed, 0xfa, 0xcf]],
    ["ejecutable de macOS (Mach-O)", [0xce, 0xfa, 0xed, 0xfe]],
    ["ejecutable de macOS (Mach-O)", [0xcf, 0xfa, 0xed, 0xfe]],
    ["binario Java/Mach-O universal", [0xca, 0xfe, 0xba, 0xbe]],
  ];
  for (const [name, magic] of sigs) {
    if (startsWith(buf, magic)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Modelos 3D y tomografías (STL / PLY / OBJ / DICOM)
// ---------------------------------------------------------------------------

/**
 * Valida modelos 3D y tomografías por CONTENIDO.
 *
 * `file-type` NO reconoce STL/PLY/OBJ (mallas sin firma binaria estándar), así
 * que un allow-list de MIME los rechazaría a todos. Estrategia:
 *   1. Rechazar ejecutables disfrazados (gate duro de seguridad).
 *   2. DICOM: `file-type` SÍ lo reconoce (firma "DICM" en offset 128) → se exige.
 *   3. STL/PLY/OBJ: si `file-type` reconoce CUALQUIER tipo concreto, el archivo
 *      está disfrazado (una malla real no tiene firma) → se rechaza. Si no
 *      reconoce nada (caso normal de un modelo real) → se permite.
 *
 * Resultado: un STL/PLY/OBJ legítimo siempre pasa, y un .exe/.png/.zip
 * renombrado a .stl se bloquea. Devuelve null si OK, o un mensaje de error.
 */
export async function validateModel3D(bytes: ArrayBuffer, ext: string): Promise<string | null> {
  const head = headOf(bytes);
  const e = ext.toLowerCase();

  const danger = dangerousExecutable(head);
  if (danger) return `el contenido es un ${danger}, no un modelo 3D`;

  const detected = await fileTypeFromBuffer(head);

  if (e === "dcm" || e === "dicom") {
    if (detected?.mime === "application/dicom") return null;
    if (head.length >= 132 && head.toString("ascii", 128, 132) === "DICM") return null;
    if (detected) return `el contenido es ${detected.mime}, no un archivo DICOM`;
    // DICOM atípico sin preámbulo "DICM"; ya descartamos ejecutables → se permite.
    console.warn("[validate-upload] DICOM sin firma DICM reconocible; se permite por tolerancia");
    return null;
  }

  // STL / PLY / OBJ y demás mallas. `file-type` reconoce algunas como "model/*"
  // (p. ej. STL ASCII → model/stl) y otras no las ficha (STL binario, PLY/OBJ).
  // Aceptamos cualquier malla "model/*" y los no reconocidos; solo rechazamos si
  // detecta un tipo concreto AJENO (imagen, zip, pdf, audio/video, ejecutable…).
  if (detected && !detected.mime.startsWith("model/")) {
    return `el contenido es ${detected.mime}, no coincide con la extensión .${e}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hojas de cálculo (XLSX / XLS / CSV)
// ---------------------------------------------------------------------------

/**
 * Valida hojas de cálculo por CONTENIDO:
 *   - .xlsx: debe ser contenedor ZIP/OOXML (firma "PK").
 *   - .xls : debe ser OLE2/Compound File (firma D0 CF 11 E0); acepta PK por si
 *            es realmente un .xlsx mal nombrado.
 *   - .csv : texto plano (sin firma); se rechaza solo si `file-type` detecta un
 *            binario concreto disfrazado.
 * Siempre rechaza ejecutables. Devuelve null si OK, o un mensaje de error.
 */
export async function validateSpreadsheet(bytes: ArrayBuffer, ext: string): Promise<string | null> {
  const head = headOf(bytes);
  const e = ext.toLowerCase();

  const danger = dangerousExecutable(head);
  if (danger) return `el contenido es un ${danger}, no una hoja de cálculo`;

  const PK = [0x50, 0x4b]; // "PK" — zip / xlsx / ooxml
  const CFB = [0xd0, 0xcf, 0x11, 0xe0]; // OLE2 — xls/doc antiguos

  if (e === "xlsx") {
    if (startsWith(head, PK)) return null;
    return "el contenido no es un .xlsx válido (se esperaba un archivo de Office/ZIP)";
  }
  if (e === "xls") {
    if (startsWith(head, CFB) || startsWith(head, PK)) return null;
    return "el contenido no es un .xls válido";
  }

  // .csv u otros formatos de texto.
  const detected = await fileTypeFromBuffer(head);
  if (detected) return `el contenido es ${detected.mime}, no un .csv de texto`;
  return null;
}
