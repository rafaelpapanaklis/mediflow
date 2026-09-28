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
import { analizarMonto, montoSinConfirmar, separarFechaHora, type HoraDeReloj } from "./valores";
import {
  AMOUNT_FORMAT_FIELD,
  type ColumnMapping,
  type CommitResult,
  type Entity,
  type PreviewResult,
  type PreviewRow,
  type SheetInfo,
  type UnresolvedValue,
  type ValueMapping,
  type ValueOption,
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
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  // Celda de fecha sin formato de fecha: llega el número de serie de Excel
  // (46300 = 5-oct-2026). Con parte decimal, la hora se ignora aquí (la lee
  // parseHora). Por debajo de 10000 es un año o un entero cualquiera, no una fecha.
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 10000 || v >= 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  // «05/10/2026 15:30» o «2026-10-05T15:30:00»: aquí solo importa el día.
  const str = separarFechaHora(String(v)).fecha;
  if (!str) return null;
  // AAAA-MM-DD a mano: `new Date("2026-10-05")` es la medianoche UTC, que un
  // servidor al oeste de Greenwich lee como el día 4.
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]), mo = Number(iso[2]), day = Number(iso[3]);
    const d = new Date(y, mo - 1, day);
    if (Number.isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== mo - 1) return null;
    return d;
  }
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
 * Monto como número (negativo = saldo a favor) o null. Un monto AMBIGUO
 * («45.000») se lee como miles SIN pedir confirmación: las entidades usan
 * `crearLectorMontos` (valores.ts), que sí lo marca. Se conserva por compatibilidad.
 */
export function parseAmount(v: any): number | null {
  return montoSinConfirmar(v);
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

/**
 * Fecha de una celda de .xlsx SIN perder la hora. exceljs devuelve la celda como
 * un Date cuyas componentes UTC son el reloj de la hoja (no una zona): «5-oct-2026
 * 15:30» es 2026-10-05T15:30Z y una celda de solo hora («15:30») es
 * 1899-12-30T15:30Z. Antes las dos se re-anclaban a la medianoche y la hora
 * moría en silencio (todas las citas a las 00:00).
 *
 * El valor sigue siendo un Date de medianoche local (lo que esperan las demás
 * entidades); si la celda traía hora, se le pega en `hora` (no enumerable, no
 * viaja por JSON) y `parseHora`/las citas la leen de ahí.
 */
function fechaDeCelda(d: Date): Date {
  const out = utcDateToLocal(d);
  const msDelDia = d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const soloHora = d.getUTCFullYear() < 1900;
  if (soloHora || msDelDia > 0) {
    const min = Math.min(1439, Math.round(msDelDia / 60_000));
    const hora: HoraDeReloj = { h: Math.floor(min / 60), m: min % 60 };
    Object.defineProperty(out, "hora", { value: hora, enumerable: false });
  }
  return out;
}

function cellToRaw(cell: ExcelJS.Cell): any {
  const v = cell.value as any;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return fechaDeCelda(v);
  if (typeof v === "object") {
    if (v.result instanceof Date) return fechaDeCelda(v.result);
    return cell.text ?? ""; // richText / hyperlink / fórmula → texto renderizado
  }
  return v; // string | number | boolean
}

/**
 * La pestaña que PROPONE el nombre de la entidad («Saldos» para saldos). Solo es una
 * propuesta: con varias hojas el usuario siempre la confirma o la cambia. Si ninguna se
 * llama así, no propone nada: NUNCA cae en «la primera» en silencio.
 */
function suggestSheet(sheets: ExcelJS.Worksheet[], sheetNames?: string[]): string | null {
  if (!sheetNames || sheetNames.length === 0) return null;
  const wanted = new Set(sheetNames.map(norm));
  return sheets.find((s) => wanted.has(norm(s.name)))?.name ?? null;
}

async function readUploadSheets(fileBytes: ArrayBuffer, ext: string): Promise<ExcelJS.Worksheet[]> {
  const wb = new ExcelJS.Workbook();
  if (ext === "csv") {
    const buf = Buffer.from(fileBytes);
    // Excel "CSV UTF-8" antepone BOM; sin quitarlo el primer header no matchea.
    const clean =
      buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
    // Sniff del separador en la primera línea (Excel es-* exporta con ";").
    const firstLine = clean.subarray(0, Math.min(clean.length, 4096)).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    const delimiter = [",", ";", "\t"].reduce((a, b) => (firstLine.split(b).length > firstLine.split(a).length ? b : a));
    const ws = await wb.csv.read(Readable.from([clean]), {
      parserOptions: { delimiter },
      map: (val: any) => val, // valores crudos como texto
    });
    return ws ? [ws] : [];
  }
  await wb.xlsx.load(fileBytes);
  return wb.worksheets;
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

const SAMPLE_SHEET_ROWS = 5;

/** Texto de una celda para la muestra de una pestaña (las fechas con su hora, si la traen). */
function sampleCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) {
    const hora = (v as Date & { hora?: HoraDeReloj }).hora;
    const hhmm = hora ? `${String(hora.h).padStart(2, "0")}:${String(hora.m).padStart(2, "0")}` : "";
    if (v.getFullYear() < 1900 && hhmm) return hhmm;
    const dia = `${String(v.getDate()).padStart(2, "0")}/${String(v.getMonth() + 1).padStart(2, "0")}/${v.getFullYear()}`;
    return hhmm ? `${dia} ${hhmm}` : dia;
  }
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export interface ParsedSpreadsheet {
  columns: string[];
  rows: Record<string, any>[];
  /** Solo con varias pestañas. */
  sheets?: SheetInfo[];
  suggestedSheet?: string | null;
  /** Varias pestañas y ninguna elegida: no se leyó ninguna (columns/rows vacíos). */
  needsSheet?: boolean;
  /** La pestaña leída (solo con varias). */
  sheet?: string;
}

/**
 * Valida y parsea el archivo subido. Conserva los códigos/mensajes del endpoint
 * original. Devuelve los headers (columns) y las filas crudas (keyed por header).
 * Lanza ImportError (la ruta lo mapea a NextResponse).
 *
 * Un .xlsx de VARIAS pestañas nunca se lee «por la primera»: sin `sheet` devuelve
 * `needsSheet` con la lista de pestañas y sus primeras filas (y la que propone el
 * nombre); con `sheet` lee esa. Un .csv o un libro de una sola hoja no cambia.
 */
export async function parseSpreadsheet(
  file: File,
  sheetNames?: string[],
  sheet?: string | null,
): Promise<ParsedSpreadsheet> {
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
  let extra: Pick<ParsedSpreadsheet, "sheets" | "suggestedSheet" | "needsSheet" | "sheet"> = {};
  try {
    const sheets = await readUploadSheets(fileBytes, ext);
    if (sheets.length === 0) throw new ImportError(400, "Archivo vacío");
    if (sheets.length === 1) {
      const collected = worksheetToRows(sheets[0], MAX_ROWS);
      columns = collected.columns;
      rows = collected.rows;
      exceeded = collected.exceeded;
    } else {
      // Se lee cada pestaña una vez: sirve para describirla y, la elegida, para importarla.
      const leidas = sheets.map((ws) => ({ ws, c: worksheetToRows(ws, MAX_ROWS) }));
      const infos: SheetInfo[] = leidas.map(({ ws, c }) => ({
        name: ws.name,
        rows: c.rows.length,
        columns: c.columns,
        sample: c.rows.slice(0, SAMPLE_SHEET_ROWS).map((r) => c.columns.map((col) => sampleCell(r[col]))),
      }));
      const suggested = suggestSheet(sheets, sheetNames);
      if (!sheet) {
        return { columns: [], rows: [], sheets: infos, suggestedSheet: suggested, needsSheet: true };
      }
      const elegida = leidas.find((l) => l.ws.name === sheet);
      if (!elegida) throw new ImportError(400, `El archivo no tiene una pestaña llamada «${sheet}»`);
      columns = elegida.c.columns;
      rows = elegida.c.rows;
      exceeded = elegida.c.exceeded;
      extra = { sheets: infos, suggestedSheet: suggested, sheet };
    }
  } catch (e: any) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(400, "No se pudo leer el archivo: " + (e?.message ?? "parse error"));
  }

  if (exceeded) throw new ImportError(413, `Máximo ${MAX_ROWS} filas. Divide el archivo.`);
  if (rows.length === 0) throw new ImportError(400, "Sin filas de datos");
  return { columns, rows, ...extra };
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
  /** Pestaña elegida en un .xlsx de varias hojas. */
  sheet: string | null;
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
  const sheetRaw = formData.get("sheet");
  const sheet = typeof sheetRaw === "string" && sheetRaw.trim() ? sheetRaw.trim().slice(0, 120) : null;
  return { file, dryRun, skipDuplicates, columnMapping, origin, valueMapping, sheet };
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

/**
 * Autodetección header -> campo canónico usando las variantes de la entidad.
 * Un mismo alias puede servir para más de un campo (p. ej. "tratamiento" es
 * título O procedimiento, según si la hoja ya trae una columna de procedimiento
 * aparte): los headers SIN ambigüedad se resuelven primero, para que un campo
 * inequívoco no se quede sin dueño por culpa de uno ambiguo; los ambiguos se
 * resuelven después, cediendo el campo que ya tenga dueño y quedándose con el
 * declarado más tarde en `headerVariants` cuando ninguno está tomado (mismo
 * criterio que antes para una hoja con una sola columna así).
 */
export function autodetect(columns: string[], headerVariants: Record<string, string[]>): ColumnMapping {
  const campos = Object.keys(headerVariants);
  const map: ColumnMapping = {};
  const claimed = new Set<string>();
  const candidatos = new Map<string, string[]>();
  for (const header of columns) {
    const n = norm(header);
    const coincide = campos.filter((campo) => headerVariants[campo].includes(n));
    if (coincide.length > 0) candidatos.set(header, coincide);
  }
  for (const [header, coincide] of candidatos) {
    if (coincide.length === 1) { map[header] = coincide[0]; claimed.add(coincide[0]); }
  }
  for (const [header, coincide] of candidatos) {
    if (coincide.length <= 1) continue;
    const libre = [...coincide].reverse().find((c) => !claimed.has(c));
    const campo = libre ?? coincide[coincide.length - 1];
    map[header] = campo;
    claimed.add(campo);
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
  /**
   * Con qué sistema se emparejan los ID externos: el id del perfil («dentalink»). Un ID
   * «123» de Dentalink no es el «123» de otro. VACÍO si no se eligió un sistema con perfil
   * («Mi Excel», «Otro»): ahí una columna «id» suele ser un número de fila cualquiera y NO
   * se usa como ID externo (ni para emparejar ni para recordar).
   */
  originId: string;
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

/**
 * Las filas con error (o omitidas) salen del handler sin `data`: en la vista previa
 * quedaban como «—» aunque el archivo traía el nombre. Se les pega lo que decía el
 * archivo (nombre y teléfono tal cual) para que se sepa de QUIÉN es cada fila.
 */
function conNombreDelArchivo(r: PreviewRow, m?: Record<string, any>): PreviewRow {
  if (!m) return r;
  const texto = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const nombre = texto(m.fullName) || [m.name, m.lastName].map(texto).filter(Boolean).join(" ") || [m.firstName, m.lastName].map(texto).filter(Boolean).join(" ");
  const tel = texto(m.phone);
  if (!nombre && !tel) return r;
  return { ...r, data: { ...r.data, ...(nombre ? { origName: nombre } : {}), ...(tel ? { origPhone: tel } : {}) } };
}

const SAMPLE_MAX = 80;

/** Primer valor no vacío de cada columna, como texto (las fechas de celda, en AAAA-MM-DD). */
function columnSamples(columns: string[], rows: Record<string, any>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    for (const r of rows) {
      const v = r[c];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      const hora = v instanceof Date ? (v as Date & { hora?: HoraDeReloj }).hora : undefined;
      const hhmm = hora ? `${String(hora.h).padStart(2, "0")}:${String(hora.m).padStart(2, "0")}` : "";
      const s = v instanceof Date
        // Una celda de solo hora (año 1899) se enseña como hora; una de fecha y hora, con las dos.
        ? v.getFullYear() < 1900 && hhmm
          ? hhmm
          : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}${hhmm ? ` ${hhmm}` : ""}`
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
    omitidos: preview.filter((r) => r.status === "skipped").length,
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
    if (!r.unresolved) continue;
    for (const u of r.unresolved) {
      // Una fila con error no se importa, así que sus procedimientos sin equivalente
      // no cuentan… salvo el formato de los montos: es justo lo que la deja con error
      // hasta que el usuario lo confirme.
      if (r.status === "error" && u.field !== AMOUNT_FORMAT_FIELD) continue;
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
    /** Pestaña de un .xlsx de varias hojas (obligatoria si hay varias). */
    sheet?: string | null;
  },
): Promise<PreviewResult | CommitResult> {
  // `clinicId: undefined` en Prisma NO filtra: se corta antes de tocar la base.
  if (typeof opts.clinicId !== "string" || !opts.clinicId) {
    throw new ImportError(401, "Sin clínica en la sesión");
  }
  // El perfil del origen puede nombrar además la pestaña que sus instrucciones mandan bajar
  // («Pacientes morosos» para saldos): también se PROPONE (nunca se elige sola).
  const profile = opts.origin ? getOriginProfile(opts.origin) : null;
  const parsed = await parseSpreadsheet(
    opts.file,
    [...(handler.sheetNames ?? []), ...(profile?.sheetNames?.[handler.entity as Exclude<Entity, "patients">] ?? [])],
    opts.sheet,
  );
  if (parsed.needsSheet) {
    // Varias pestañas y ninguna elegida: se le dice al usuario cuáles hay (con sus primeras filas
    // y la que propone el nombre) y NO se procesa nada. Importar sin elegir es un error.
    if (!opts.dryRun) {
      throw new ImportError(400, "El archivo tiene varias pestañas: elige cuál importar antes de continuar", undefined, "SHEET_REQUIRED");
    }
    return {
      entity: handler.entity,
      total: 0,
      validos: 0,
      invalidos: 0,
      duplicados: 0,
      columns: [],
      suggestedMapping: {},
      preview: [],
      sheets: parsed.sheets,
      suggestedSheet: parsed.suggestedSheet ?? null,
      needsSheet: true,
    };
  }
  const { columns, rows: rawRows } = parsed;
  const sheetInfo = parsed.sheets
    ? { sheets: parsed.sheets, suggestedSheet: parsed.suggestedSheet ?? null, sheet: parsed.sheet }
    : {};

  // Sugerencia = autodetección genérica + lo que sabe el perfil del origen
  // (manda el perfil donde opina: es específico de ese sistema).
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
        ...sheetInfo,
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

  const mappedPorFila = new Map(mapped.map((m) => [m.row, m.mapped]));

  const ctx: ImportContext = {
    userId: opts.userId,
    role: opts.role ?? "",
    originName: profile?.hasProfile ? profile.name : null,
    originId: profile?.hasProfile ? profile.id : "",
    fileName: opts.file.name,
    valueMapping: opts.valueMapping ?? {},
    now: new Date(),
  };

  const preview = await handler.process(mapped, opts.clinicId, ctx);
  const counts = tally(preview);

  if (opts.dryRun) {
    const unresolved = aggregateUnresolved(preview);
    let options: Record<string, ValueOption[]> | undefined =
      unresolved.length > 0 && handler.valueOptions ? await handler.valueOptions(opts.clinicId) : undefined;
    // Montos ambiguos: las dos lecturas posibles, con el primer ejemplo del archivo.
    const ambiguo = unresolved.find((u) => u.field === AMOUNT_FORMAT_FIELD);
    if (ambiguo) {
      const a = analizarMonto(ambiguo.value);
      const ej = a.tipo === "ambiguo" ? a : null;
      options = { ...(options ?? {}) };
      options[AMOUNT_FORMAT_FIELD] = [
        { id: "miles", label: ej ? `«${ej.raw}» es ${ej.miles.toLocaleString("es-MX")} (el ${ej.separador === "." ? "punto" : "coma"} separa los miles)` : "El separador es de miles" },
        { id: "decimales", label: ej ? `«${ej.raw}» es ${ej.decimal.toLocaleString("es-MX", { maximumFractionDigits: 3 })} (el ${ej.separador === "." ? "punto" : "coma"} es decimal)` : "El separador es decimal" },
      ];
    }
    return {
      entity: handler.entity,
      total: counts.total,
      validos: counts.validos,
      invalidos: counts.invalidos,
      duplicados: counts.duplicados,
      ...(counts.omitidos > 0 ? { omitidos: counts.omitidos } : {}),
      ...sheetInfo,
      columns,
      suggestedMapping: suggested,
      samples: columnSamples(columns, rawRows),
      preview: preview.slice(0, 200).map((r) => conNombreDelArchivo(handler.toPreview ? handler.toPreview(r) : r, mappedPorFila.get(r.row))),
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
    ...(counts.omitidos > 0 ? { omitted: counts.omitidos } : {}),
    errors: preview.filter((r) => r.status === "error").slice(0, 50).map((r) => ({ row: r.row, errors: r.errors })),
  };
}
