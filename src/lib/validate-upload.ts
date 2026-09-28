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

/**
 * Veto duro de ejecutables para subidas de CUALQUIER formato (p. ej. la migración
 * asistida acepta xlsx/csv/zip/sql/txt…): inspecciona los primeros bytes y devuelve
 * el nombre del binario peligroso (MZ/ELF/Mach-O…) o null si no lo es. NO restringe
 * por extensión ni exige una firma concreta; solo bloquea ejecutables.
 */
export function detectDangerousExecutable(bytes: ArrayBuffer): string | null {
  return dangerousExecutable(headOf(bytes));
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

/**
 * Valida un set CBCT (.zip de cortes DICOM) por CONTENIDO.
 *
 * A propósito NO usa el allow-list de MIME de validateMagicNumber: `file-type`
 * clasifica los contenedores ZIP por lo que llevan dentro (ooxml, epub…) y para
 * algunos devuelve null, así que exigir exactamente "application/zip" rechazaría
 * sets legítimos — y en este flujo un rechazo BORRA el archivo que la clínica
 * acaba de tardar media hora en subir.
 *
 * Se comprueba lo que de verdad importa: que no sea un ejecutable disfrazado y
 * que empiece con la firma "PK" de ZIP. Devuelve null si OK, o un mensaje.
 */
export function validateCbctZip(bytes: ArrayBuffer): string | null {
  const head = headOf(bytes);

  const danger = dangerousExecutable(head);
  if (danger) return `el contenido es un ${danger}, no un set CBCT`;

  const PK = [0x50, 0x4b]; // "PK" — todo zip empieza así
  if (!startsWith(head, PK)) return "el contenido no es un archivo .zip válido";
  return null;
}

// ---------------------------------------------------------------------------
// Hojas de cálculo (XLSX / XLS / CSV)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Contenedor ZIP de un .xlsx: bombas zip y macros por CONTENIDO, sin descomprimir
// nada (exceljs nunca llega a tocar un archivo que no pase esto). Recorre el
// directorio central del ZIP a mano — los tamaños ahí declarados son los que un
// atacante controla, así que se desconfía de ellos en vez de confiar en exceljs.
// ---------------------------------------------------------------------------

const ZIP_EOCD_SIG = 0x06054b50; // "PK\x05\x06"
const ZIP_CDFH_SIG = 0x02014b50; // "PK\x01\x02"
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_ENTRY_UNCOMPRESSED = 120 * 1024 * 1024; // 120 MB por entrada interna
const MAX_ZIP_TOTAL_UNCOMPRESSED = 250 * 1024 * 1024; // 250 MB descomprimido en total
const MAX_ZIP_RATIO = 200; // descomprimido/comprimido
const ZIP_RATIO_FLOOR = 1 * 1024 * 1024; // no penaliza XML pequeño muy compresible

/**
 * Rechaza, SIN descomprimir: una macro embebida (xl/vbaProject.bin, aunque la
 * extensión diga .xlsx), más entradas de las razonables (bomba de muchas
 * entradas diminutas), o una entrada / el total que declare un tamaño
 * DESCOMPRIMIDO disparatado frente al comprimido (bomba zip clásica). Nunca
 * lanza: un zip mal formado se rechaza con mensaje, no revienta el parseo.
 */
function validateXlsxZipSafety(bytes: ArrayBuffer): string | null {
  const buf = Buffer.from(bytes);
  if (buf.length < 22) return "el contenido no es un .xlsx válido (demasiado corto)";

  // El End Of Central Directory vive en los últimos 64 KB + 22 (el comentario
  // del zip puede ocupar hasta 64 KB) — se busca desde el final hacia atrás.
  const searchFrom = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === ZIP_EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) return "el contenido no es un .xlsx válido (sin fin de directorio ZIP)";

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    return "el archivo usa ZIP64: no se acepta (un .xlsx normal no lo necesita)";
  }
  if (totalEntries > MAX_ZIP_ENTRIES) {
    return `el archivo tiene demasiadas entradas internas (${totalEntries}); no parece una hoja de cálculo real`;
  }
  if (cdOffset >= buf.length) return "el contenido no es un .xlsx válido (directorio ZIP corrupto)";

  let offset = cdOffset;
  let totalUncompressed = 0;
  let seen = 0;
  while (offset + 46 <= buf.length && seen < totalEntries) {
    if (buf.readUInt32LE(offset) !== ZIP_CDFH_SIG) break; // fin real del directorio
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const nameEnd = offset + 46 + nameLen;
    if (nameEnd > buf.length) break;
    const name = buf.toString("utf8", offset + 46, nameEnd).toLowerCase();

    if (name === "xl/vbaproject.bin" || name.endsWith("/vbaproject.bin")) {
      return "el archivo tiene macros (VBA): no se aceptan libros con macros";
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_UNCOMPRESSED) {
      return "una hoja interna del archivo declara un tamaño descomprimido excesivo";
    }
    if (compressedSize > 0 && uncompressedSize > ZIP_RATIO_FLOOR && uncompressedSize / compressedSize > MAX_ZIP_RATIO) {
      return "el archivo se comprime de forma anómala (posible bomba zip)";
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED) {
      return "el contenido descomprimido del archivo excede el límite permitido";
    }

    offset = nameEnd + extraLen + commentLen;
    seen++;
  }

  return null;
}

/**
 * Valida hojas de cálculo por CONTENIDO:
 *   - .xlsx: debe ser contenedor ZIP/OOXML (firma "PK"), sin macros y sin señales
 *     de bomba zip (`validateXlsxZipSafety`). Un .xlsx cifrado/protegido con
 *     contraseña es en realidad un contenedor OLE2 (firma D0 CF 11 E0) y se
 *     rechaza con un mensaje propio, no como ".xlsx inválido" a secas.
 *   - .xls : debe ser OLE2/Compound File (firma D0 CF 11 E0); acepta PK por si
 *            es realmente un .xlsx mal nombrado.
 *   - .csv : texto plano (sin firma); se rechaza solo si `file-type` detecta un
 *            binario concreto disfrazado.
 * Siempre rechaza ejecutables. Devuelve null si OK, o un mensaje de error.
 *
 * PUNTO DE ENCHUFE: si `src/lib/uploads/validar-archivo.ts` (validador
 * compartido de subidas de todo el panel, ws1-t8) llega a existir, esta
 * función — y en particular `validateXlsxZipSafety` — es lo que debería
 * llamar para la parte específica de hojas de cálculo; no dupliques esta
 * lógica allí.
 */
export async function validateSpreadsheet(bytes: ArrayBuffer, ext: string): Promise<string | null> {
  const head = headOf(bytes);
  const e = ext.toLowerCase();

  const danger = dangerousExecutable(head);
  if (danger) return `el contenido es un ${danger}, no una hoja de cálculo`;

  const PK = [0x50, 0x4b]; // "PK" — zip / xlsx / ooxml
  const CFB = [0xd0, 0xcf, 0x11, 0xe0]; // OLE2 — xls/doc antiguos, y también un .xlsx cifrado

  if (e === "xlsx") {
    if (startsWith(head, CFB)) return "el archivo está cifrado o protegido con contraseña: quita la protección antes de subirlo";
    if (!startsWith(head, PK)) return "el contenido no es un .xlsx válido (se esperaba un archivo de Office/ZIP)";
    return validateXlsxZipSafety(bytes);
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
