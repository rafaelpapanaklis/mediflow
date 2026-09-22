// Motor genérico de importación ("Importar mi clínica"). Extraído y generalizado
// desde el endpoint original /api/patients/import. Aquí vive TODO lo agnóstico a
// la entidad: parseo seguro de la hoja, mapeo de columnas, autodetección, y el
// pipeline preview()/commit(). La lógica POR entidad (validar/dedup/insertar)
// vive en entities.ts vía la interfaz EntityHandler (inyección de dependencias:
// engine.ts NO importa entities.ts → sin ciclos).
//
// Seguridad conservada del original: magic bytes (validateSpreadsheet), tope de
// 5MB y 5000 filas, parseo con exceljs (no SheetJS — input no confiable).

import { NextRequest, NextResponse } from "next/server";
import * as ExcelJS from "exceljs";
import { Readable } from "stream";
import { validateSpreadsheet } from "@/lib/validate-upload";
import { logAudit, type AuditEntityType } from "@/lib/audit";
import { getOriginProfile, profileMappingFor } from "./profiles";
import type {
  ColumnMapping,
  CommitResult,
  Entity,
  PreviewResult,
  PreviewRow,
  UnresolvedValue,
  ValueMapping,
  ValueOption,
} from "./types";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const BATCH = 200;

// ---------------------------------------------------------------------------
// Error tipado → se mapea a NextResponse con su status. Conserva los códigos y
// mensajes EXACTOS del endpoint original (compatibilidad del modal viejo).
// ---------------------------------------------------------------------------
export class ImportError extends Error {
  status: number;
  detalle?: string;
  /** Código de error de máquina (p. ej. "PLAN_LIMIT_PATIENTS"), opcional. */
  code?: string;
  constructor(status: number, message: string, detalle?: string, code?: string) {
    super(message);
    this.name = "ImportError";
    this.status = status;
    this.detalle = detalle;
    this.code = code;
  }
}

/** Mapea un error capturado en la ruta a NextResponse. ImportError → su status. */
export function importErrorResponse(e: unknown): NextResponse {
  if (e instanceof ImportError) {
    return NextResponse.json(
      {
        error: e.message,
        ...(e.detalle ? { detalle: e.detalle } : {}),
        ...(e.code ? { code: e.code } : {}),
      },
      { status: e.status },
    );
  }
  console.error("[import] error inesperado:", e);
  return NextResponse.json({ error: "Error al procesar la importación" }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Helpers de normalización/parseo compartidos por los validadores de entidad.
// ---------------------------------------------------------------------------

/** Normaliza un header/valor para comparar: minúsculas, sin acentos ni separadores. */
export const norm = (s: any) =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s|_|-/g, "").trim();

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const VALID_BLOOD = new Set(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);

const HONORIFICS = ["doctora", "doctor", "odontologa", "odontologo", "dra", "dr", "lic", "md"];

/** Normaliza un nombre de persona para matching: como norm() + quita honoríficos y puntos. */
export function normName(s: any): string {
  let n = norm(s).replace(/\./g, "");
  for (const h of HONORIFICS) {
    if (n.startsWith(h)) { n = n.slice(h.length); break; }
  }
  return n;
}

/** Últimos 10 dígitos del teléfono (convención de match multi-fuente, ignora lada país). */
export function last10(v: any): string {
  return String(v).replace(/\D/g, "").slice(-10);
}

export function parseGender(v: any): "M" | "F" | "OTHER" {
  const n = String(v).toLowerCase().trim();
  if (["m", "masc", "masculino", "hombre", "male"].includes(n)) return "M";
  if (["f", "fem", "femenino", "mujer", "female"].includes(n)) return "F";
  return "OTHER";
}

export function parsePhone(v: any): string | null {
  const cleaned = String(v).replace(/[\s\-()]/g, "").trim();
  return cleaned || null;
}

export function parseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const str = String(v).trim();
  if (!str) return null;
  // dd/mm/yyyy, dd-mm-yyyy o dd.mm.yyyy (formato MX más común en exports), y
  // también con año de 2 dígitos: "05/03/21" caía en `new Date(str)`, que lo lee
  // al estilo EE. UU. (3 de mayo). Dos dígitos: hasta el año en curso es 20xx,
  // lo demás 19xx ("85" es 1985, una fecha de nacimiento).
  const dmy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) {
      const siglo = new Date().getFullYear() % 100;
      year += year <= siglo ? 2000 : 1900;
    }
    const d = new Date(year, month - 1, day);
    // "31/02/2024" no existe: el Date de JS lo convertía EN SILENCIO en el 2 de
    // marzo. Una fecha imposible es inválida, no otra fecha.
    if (Number.isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== month - 1) return null;
    return d;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parsea un monto monetario tolerante a formato MX: "$1,250.00", "1250", "1.250,50".
 * Devuelve number (puede ser negativo = saldo a favor) o null si no es numérico.
 */
export function parseAmount(v: any): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[^0-9,.\-]/g, ""); // quita $, "MXN", espacios, etc.
  if (!s || s === "-" || s === "." || s === ",") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // El último separador es el decimal; el otro es de miles.
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")  // 1.250,50 → 1250.50
      : s.replace(/,/g, "");                     // 1,250.50 → 1250.50
  } else if (hasComma) {
    const parts = s.split(",");
    // Coma como decimal solo si deja 1-2 dígitos al final (1.250 sería miles).
    s = parts[parts.length - 1].length <= 2
      ? parts.slice(0, -1).join("") + "." + parts[parts.length - 1]
      : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Parseo del upload con exceljs (idéntico al endpoint original).
// xlsx vía wb.xlsx.load; csv con sniff de delimitador + BOM. SheetJS queda fuera
// por sus 2 HIGH sin fix (input no confiable). .xls legacy (OLE2) no se acepta.
// ---------------------------------------------------------------------------

function utcDateToLocal(d: Date): Date {
  // exceljs ancla fechas de celda a medianoche UTC; se re-anclan a medianoche
  // local para que la fecha no retroceda un día al mostrarse en MX.
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function cellToRaw(cell: ExcelJS.Cell): any {
  const v = cell.value as any;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return utcDateToLocal(v);
  if (typeof v === "object") {
    if (v.result instanceof Date) return utcDateToLocal(v.result);
    return cell.text ?? ""; // richText / hyperlink / fórmula → texto renderizado
  }
  return v; // string | number | boolean
}

/**
 * La hoja que le toca a la entidad. Un .xlsx de varias pestañas (la plantilla
 * trae una por entidad) se lee por el NOMBRE de la pestaña; si ninguna se llama
 * como la entidad, o el libro tiene una sola hoja, manda la primera, como antes.
 */
function pickWorksheet(wb: ExcelJS.Workbook, sheetNames?: string[]): ExcelJS.Worksheet | undefined {
  const sheets = wb.worksheets;
  if (sheets.length > 1 && sheetNames && sheetNames.length > 0) {
    const wanted = new Set(sheetNames.map(norm));
    const hit = sheets.find((s) => wanted.has(norm(s.name)));
    if (hit) return hit;
  }
  return sheets[0];
}

async function readUploadWorksheet(
  fileBytes: ArrayBuffer,
  ext: string,
  sheetNames?: string[],
): Promise<ExcelJS.Worksheet | undefined> {
  const wb = new ExcelJS.Workbook();
  if (ext === "csv") {
    const buf = Buffer.from(fileBytes);
    // Excel "CSV UTF-8" antepone BOM; sin quitarlo el primer header no matchea.
    const clean =
      buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
    // Sniff del separador en la primera línea (Excel es-* exporta con ";").
    const firstLine = clean.subarray(0, Math.min(clean.length, 4096)).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    const delimiter = [",", ";", "\t"].reduce((a, b) => (firstLine.split(b).length > firstLine.split(a).length ? b : a));
    return wb.csv.read(Readable.from([clean]), {
      parserOptions: { delimiter },
      map: (val: any) => val, // valores crudos como texto
    });
  }
  await wb.xlsx.load(fileBytes);
  return pickWorksheet(wb, sheetNames);
}

function worksheetToRows(ws: ExcelJS.Worksheet, maxRows: number): { columns: string[]; rows: Record<string, any>[]; exceeded: boolean } {
  // Headers desde la fila 1; duplicados con sufijo _N (mismo criterio que sheet_to_json).
  const headers: { col: number; key: string }[] = [];
  const seen = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    let key = String(cell.text ?? "").trim();
    if (!key) return;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}_${n}`;
    headers.push({ col, key });
  });

  const rows: Record<string, any>[] = [];
  let exceeded = false;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1 || exceeded || headers.length === 0) return;
    const obj: Record<string, any> = {};
    let hasValue = false;
    for (const h of headers) {
      const raw = cellToRaw(row.getCell(h.col));
      obj[h.key] = raw;
      if (String(raw ?? "").trim() !== "") hasValue = true;
    }
    if (!hasValue) return; // fila en blanco
    rows.push(obj);
    if (rows.length > maxRows) exceeded = true;
  });
  return { columns: headers.map((h) => h.key), rows, exceeded };
}

/**
 * Valida y parsea el archivo subido. Conserva los códigos/mensajes del endpoint
 * original. Devuelve los headers (columns) y las filas crudas (keyed por header).
 * Lanza ImportError (la ruta lo mapea a NextResponse).
 */
export async function parseSpreadsheet(
  file: File,
  sheetNames?: string[],
): Promise<{ columns: string[]; rows: Record<string, any>[] }> {
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new ImportError(400, "Solo .xlsx o .csv");
  if (file.size > MAX_BYTES) throw new ImportError(413, "Archivo supera 5MB");

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  let fileBytes: ArrayBuffer;
  try {
    fileBytes = await file.arrayBuffer();
  } catch {
    throw new ImportError(400, "No se pudo leer el archivo");
  }

  // Blindaje: valida la FIRMA real del contenido, no la extensión.
  const magicError = await validateSpreadsheet(fileBytes, ext);
  if (magicError) {
    throw new ImportError(400, "Archivo no válido: el contenido no coincide con la extensión", magicError);
  }

  let columns: string[];
  let rows: Record<string, any>[];
  let exceeded: boolean;
  try {
    const sheet = await readUploadWorksheet(fileBytes, ext, sheetNames);
    if (!sheet) throw new ImportError(400, "Archivo vacío");
    const collected = worksheetToRows(sheet, MAX_ROWS);
    columns = collected.columns;
    rows = collected.rows;
    exceeded = collected.exceeded;
  } catch (e: any) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(400, "No se pudo leer el archivo: " + (e?.message ?? "parse error"));
  }

  if (exceeded) throw new ImportError(413, `Máximo ${MAX_ROWS} filas. Divide el archivo.`);
  if (rows.length === 0) throw new ImportError(400, "Sin filas de datos");
  return { columns, rows };
}

// Topes del valueMapping que manda el cliente: es JSON arbitrario del body.
const MAX_VALUE_KEYS = 2000;
const MAX_VALUE_KEY_LENGTH = 300;
const MAX_VALUE_ID_LENGTH = 100;

/** Sanea el valueMapping del cliente: solo strings, con topes. El id se vuelve a validar contra la clínica. */
function parseValueMapping(raw: unknown): ValueMapping | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // inválido → se ignora, como el columnMapping
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: ValueMapping = {};
  for (const [field, values] of Object.entries(parsed as Record<string, unknown>)) {
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const clean: Record<string, string> = {};
    let n = 0;
    for (const [key, id] of Object.entries(values as Record<string, unknown>)) {
      if (n >= MAX_VALUE_KEYS) break;
      if (typeof id !== "string" || !id || id.length > MAX_VALUE_ID_LENGTH) continue;
      if (!key || key.length > MAX_VALUE_KEY_LENGTH) continue;
      clean[key] = id;
      n++;
    }
    out[field] = clean;
  }
  return out;
}

// ---------------------------------------------------------------------------
// FormData → opciones de importación. clinicId NUNCA viene del body (lo pone la
// ruta desde getAuthContext). columnMapping es opcional y se sanea contra la
// entidad en runImport. `origin` solo elige un perfil estático por id (lista
// blanca); `valueMapping` se vuelve a validar contra el catálogo de la clínica.
// ---------------------------------------------------------------------------
export async function parseImportForm(req: NextRequest): Promise<{
  file: File;
  dryRun: boolean;
  skipDuplicates: boolean;
  columnMapping: ColumnMapping | null;
  origin: string | null;
  valueMapping: ValueMapping | null;
}> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    throw new ImportError(400, "FormData inválido");
  }

  const file = formData.get("file");
  const dryRun = (formData.get("dryRun") as string) === "true";
  const skipDuplicates = (formData.get("skipDuplicates") as string) !== "false"; // default true
  if (!file || !(file instanceof File)) throw new ImportError(400, "Falta el archivo");

  let columnMapping: ColumnMapping | null = null;
  const cmRaw = formData.get("columnMapping");
  if (typeof cmRaw === "string" && cmRaw.trim()) {
    try {
      const parsed = JSON.parse(cmRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        columnMapping = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") columnMapping[k] = v;
        }
      }
    } catch {
      /* mapping inválido → se ignora y se usa autodetección */
    }
  }
  const originRaw = formData.get("origin");
  const origin = typeof originRaw === "string" && originRaw.trim() ? originRaw.trim().slice(0, 40) : null;
  const valueMapping = parseValueMapping(formData.get("valueMapping"));
  return { file, dryRun, skipDuplicates, columnMapping, origin, valueMapping };
}

// ---------------------------------------------------------------------------
// Mapeo de columnas.
// ---------------------------------------------------------------------------

/**
 * Transforma filas keyed-por-header a filas keyed-por-campo según el mapping.
 * Si varias columnas mapean al mismo campo, gana el primer valor no vacío.
 */
export function applyMapping(rows: Record<string, any>[], mapping: ColumnMapping): Record<string, any>[] {
  const pairs = Object.entries(mapping).filter(([, campo]) => campo);
  return rows.map((raw) => {
    const out: Record<string, any> = {};
    for (const [header, campo] of pairs) {
      const v = raw[header];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      if (out[campo] === undefined) out[campo] = v;
    }
    return out;
  });
}

/** Autodetección header -> campo canónico usando las variantes de la entidad. */
export function autodetect(columns: string[], headerVariants: Record<string, string[]>): ColumnMapping {
  const map: ColumnMapping = {};
  for (const header of columns) {
    const n = norm(header);
    for (const [campo, variants] of Object.entries(headerVariants)) {
      if (variants.includes(n)) { map[header] = campo; break; }
    }
  }
  return map;
}

/**
 * Sugerencias del PERFIL del origen para esta entidad: columna conocida del
 * sistema (p. ej. "Evolución" en Dentalink) → campo canónico. Se casan por
 * header normalizado y solo con campos que la entidad acepta: el perfil puede
 * traer campos que el validador no conoce (rfc, balance…) y esos se ignoran.
 */
function profileSuggestions(
  columns: string[],
  profileMap: Record<string, string>,
  headerVariants: Record<string, string[]>,
): ColumnMapping {
  const valid = new Set(Object.keys(headerVariants));
  const byNorm = new Map<string, string>();
  for (const [header, campo] of Object.entries(profileMap)) {
    if (valid.has(campo)) byNorm.set(norm(header), campo);
  }
  const out: ColumnMapping = {};
  for (const header of columns) {
    const campo = byNorm.get(norm(header));
    if (campo) out[header] = campo;
  }
  return out;
}

/** Filtra el mapping del cliente: solo headers reales y campos válidos de la entidad. */
function sanitizeMapping(provided: ColumnMapping, columns: string[], headerVariants: Record<string, string[]>): ColumnMapping {
  const validCampos = new Set(Object.keys(headerVariants));
  const colSet = new Set(columns);
  const out: ColumnMapping = {};
  for (const [header, campo] of Object.entries(provided)) {
    if (campo && colSet.has(header) && validCampos.has(campo)) out[header] = campo;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contrato de entidad. Cada entidad (entities.ts) implementa esto.
// ---------------------------------------------------------------------------

/** Una fila tras aplicar el mapping: valores keyed por campo canónico + su nº de fila. */
export interface MappedRow {
  row: number;
  mapped: Record<string, any>;
}

/**
 * Lo que la importación sabe además de la clínica. Las entidades viejas no lo
 * necesitan (lo ignoran); las clínicas sí: una nota migrada lleva quién la
 * importó, de qué sistema y cuándo.
 */
export interface ImportContext {
  /** Quién importa (de la sesión). */
  userId: string;
  /** Su rol (de la sesión): decide qué pacientes restringidos puede emparejar. */
  role: string;
  /** Nombre del sistema de origen ("Dentalink") si se eligió uno con perfil; si no, null. */
  originName: string | null;
  fileName: string;
  /** Decisiones del usuario sobre valores sin equivalente (vacío si no mandó ninguna). */
  valueMapping: ValueMapping;
  /** Un solo reloj por importación. */
  now: Date;
}

export interface EntityHandler {
  entity: Entity;
  /** entityType para el audit log (patient | invoice | appointment | record | quote). */
  auditEntityType: AuditEntityType;
  /** Acción del audit log. Default "create"; "update" para lo que completa filas existentes. */
  auditAction?: "create" | "update";
  /** campo canónico -> variantes normalizadas del header (para autodetección). */
  headerVariants: Record<string, string[]>;
  /** Nombres de la pestaña de esta entidad en un .xlsx de varias hojas (se comparan con norm). */
  sheetNames?: string[];
  /** Validación estructural del set de campos mapeados. Devuelve mensaje de error o null. */
  validateMapping(campos: Set<string>): string | null;
  /** Valida + normaliza + dedup + resuelve FKs. data queda listo para insertar. */
  process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]>;
  /** Inserta las filas OK (+ duplicados si !skipDuplicates). Devuelve conteos. */
  commit(
    rows: PreviewRow[],
    clinicId: string,
    skipDuplicates: boolean,
    ctx: ImportContext,
  ): Promise<{ created: number; skipped: number }>;
  /** Recorta `data` para la respuesta del dry-run (p. ej. el texto largo de una nota). */
  toPreview?(row: PreviewRow): PreviewRow;
  /** Catálogo de la clínica para elegir equivalente de los `unresolved`, por campo. */
  valueOptions?(clinicId: string): Promise<Record<string, ValueOption[]>>;
}

const SAMPLE_MAX = 80;

/** Primer valor no vacío de cada columna, como texto (las fechas de celda, en AAAA-MM-DD). */
function columnSamples(columns: string[], rows: Record<string, any>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    for (const r of rows) {
      const v = r[c];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      const s = v instanceof Date
        ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
        : String(v).replace(/\s+/g, " ").trim();
      out[c] = s.length > SAMPLE_MAX ? `${s.slice(0, SAMPLE_MAX)}…` : s;
      break;
    }
  }
  return out;
}

function tally(preview: PreviewRow[]) {
  return {
    total: preview.length,
    validos: preview.filter((r) => r.status === "ok").length,
    invalidos: preview.filter((r) => r.status === "error").length,
    duplicados: preview.filter((r) => r.status === "duplicate").length,
  };
}

/**
 * Agrega los valores sin equivalente de TODAS las filas (no solo de las 200 del
 * preview): el usuario decide una vez por valor, no por fila. Las filas con
 * error no cuentan: no se van a importar de todos modos.
 */
function aggregateUnresolved(preview: PreviewRow[]): UnresolvedValue[] {
  const byKey = new Map<string, UnresolvedValue>();
  for (const r of preview) {
    if (r.status === "error" || !r.unresolved) continue;
    for (const u of r.unresolved) {
      const k = `${u.field}\u0000${u.key}`;
      const hit = byKey.get(k);
      if (hit) hit.rows++;
      else byKey.set(k, { ...u, rows: 1 });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value, "es"));
}

/**
 * Pipeline genérico: parse → mapping → validación estructural → process →
 * (dry-run ? preview : commit + audit). El handler aporta la lógica de entidad.
 * Multi-tenant: clinicId SIEMPRE proviene de la sesión (opts.clinicId).
 */
export async function runImport(
  handler: EntityHandler,
  opts: {
    file: File;
    clinicId: string;
    userId: string;
    /** Rol de la sesión. Sin él se trata como NO admin (lo restrictivo). */
    role?: string;
    dryRun: boolean;
    skipDuplicates: boolean;
    columnMapping?: ColumnMapping | null;
    /** Id del perfil de origen (dentalink, excel…). Desconocido = sin perfil. */
    origin?: string | null;
    valueMapping?: ValueMapping | null;
  },
): Promise<PreviewResult | CommitResult> {
  // `clinicId: undefined` en Prisma NO filtra: se corta antes de tocar la base.
  if (typeof opts.clinicId !== "string" || !opts.clinicId) {
    throw new ImportError(401, "Sin clínica en la sesión");
  }
  const { columns, rows: rawRows } = await parseSpreadsheet(opts.file, handler.sheetNames);

  // Sugerencia = autodetección genérica + lo que sabe el perfil del origen
  // (manda el perfil donde opina: es específico de ese sistema).
  const profile = opts.origin ? getOriginProfile(opts.origin) : null;
  const suggested: ColumnMapping = {
    ...autodetect(columns, handler.headerVariants),
    ...(profile ? profileSuggestions(columns, profileMappingFor(profile, handler.entity), handler.headerVariants) : {}),
  };
  // Mapping efectivo: el del cliente (saneado) si vino; si no, la sugerencia.
  const mapping =
    opts.columnMapping && Object.keys(opts.columnMapping).length > 0
      ? sanitizeMapping(opts.columnMapping, columns, handler.headerVariants)
      : suggested;

  const campos = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const structErr = handler.validateMapping(campos);
  if (structErr) {
    // Un archivo con columnas que no reconocemos NO es un error del usuario: es
    // que hay que emparejarlas a mano. En dry-run se devuelven las columnas y el
    // motivo, y el asistente se queda en el paso de mapeo pidiendo ayuda. Al
    // importar de verdad sí se corta.
    if (opts.dryRun) {
      return {
        entity: handler.entity,
        total: rawRows.length,
        validos: 0,
        invalidos: 0,
        duplicados: 0,
        columns,
        suggestedMapping: suggested,
        samples: columnSamples(columns, rawRows),
        preview: [],
        mappingError: structErr,
      };
    }
    throw new ImportError(400, structErr);
  }

  const mappedAll = applyMapping(rawRows, mapping);
  const mapped: MappedRow[] = [];
  for (let i = 0; i < mappedAll.length; i++) {
    if (Object.keys(mappedAll[i]).length === 0) continue; // fila sin datos mapeados
    mapped.push({ row: i + 2, mapped: mappedAll[i] }); // +2 = 1-indexed + header
  }
  if (mapped.length === 0) throw new ImportError(400, "Sin filas de datos");

  const ctx: ImportContext = {
    userId: opts.userId,
    role: opts.role ?? "",
    originName: profile?.hasProfile ? profile.name : null,
    fileName: opts.file.name,
    valueMapping: opts.valueMapping ?? {},
    now: new Date(),
  };

  const preview = await handler.process(mapped, opts.clinicId, ctx);
  const counts = tally(preview);

  if (opts.dryRun) {
    const unresolved = aggregateUnresolved(preview);
    const options =
      unresolved.length > 0 && handler.valueOptions ? await handler.valueOptions(opts.clinicId) : undefined;
    return {
      entity: handler.entity,
      total: counts.total,
      validos: counts.validos,
      invalidos: counts.invalidos,
      duplicados: counts.duplicados,
      columns,
      suggestedMapping: suggested,
      samples: columnSamples(columns, rawRows),
      preview: preview.slice(0, 200).map((r) => (handler.toPreview ? handler.toPreview(r) : r)),
      ...(unresolved.length > 0 ? { unresolved } : {}),
      ...(options ? { options } : {}),
    };
  }

  const { created, skipped } = await handler.commit(preview, opts.clinicId, opts.skipDuplicates, ctx);

  await logAudit({
    clinicId: opts.clinicId,
    userId: opts.userId,
    entityType: handler.auditEntityType,
    action: handler.auditAction ?? "create",
    entityId: "bulk-import",
    changes: {
      bulk: {
        before: null,
        after: {
          entity: handler.entity,
          count: created,
          fileName: opts.file.name,
          skipped,
          duplicates: counts.duplicados,
          ...(ctx.originName ? { origin: ctx.originName } : {}),
        },
      },
    },
  });

  return {
    entity: handler.entity,
    created,
    skipped,
    duplicates: counts.duplicados,
    errors: preview.filter((r) => r.status === "error").slice(0, 50).map((r) => ({ row: r.row, errors: r.errors })),
  };
}
