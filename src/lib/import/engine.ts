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
import type {
  ColumnMapping,
  CommitResult,
  Entity,
  PreviewResult,
  PreviewRow,
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
  constructor(status: number, message: string, detalle?: string) {
    super(message);
    this.name = "ImportError";
    this.status = status;
    this.detalle = detalle;
  }
}

/** Mapea un error capturado en la ruta a NextResponse. ImportError → su status. */
export function importErrorResponse(e: unknown): NextResponse {
  if (e instanceof ImportError) {
    return NextResponse.json(
      e.detalle ? { error: e.message, detalle: e.detalle } : { error: e.message },
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
  // dd/mm/yyyy o dd-mm-yyyy (formato MX más común en exports).
  const dmy = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
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

async function readUploadWorksheet(fileBytes: ArrayBuffer, ext: string): Promise<ExcelJS.Worksheet | undefined> {
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
  return wb.worksheets[0];
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
export async function parseSpreadsheet(file: File): Promise<{ columns: string[]; rows: Record<string, any>[] }> {
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
    const sheet = await readUploadWorksheet(fileBytes, ext);
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

// ---------------------------------------------------------------------------
// FormData → opciones de importación. clinicId NUNCA viene del body (lo pone la
// ruta desde getAuthContext). columnMapping es opcional y se sanea contra la
// entidad en runImport.
// ---------------------------------------------------------------------------
export async function parseImportForm(req: NextRequest): Promise<{
  file: File;
  dryRun: boolean;
  skipDuplicates: boolean;
  columnMapping: ColumnMapping | null;
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
  return { file, dryRun, skipDuplicates, columnMapping };
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

export interface EntityHandler {
  entity: Entity;
  /** entityType para el audit log (patient | invoice | appointment). */
  auditEntityType: AuditEntityType;
  /** campo canónico -> variantes normalizadas del header (para autodetección). */
  headerVariants: Record<string, string[]>;
  /** Validación estructural del set de campos mapeados. Devuelve mensaje de error o null. */
  validateMapping(campos: Set<string>): string | null;
  /** Valida + normaliza + dedup + resuelve FKs. data queda listo para insertar. */
  process(rows: MappedRow[], clinicId: string): Promise<PreviewRow[]>;
  /** Inserta las filas OK (+ duplicados si !skipDuplicates). Devuelve conteos. */
  commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean): Promise<{ created: number; skipped: number }>;
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
    dryRun: boolean;
    skipDuplicates: boolean;
    columnMapping?: ColumnMapping | null;
  },
): Promise<PreviewResult | CommitResult> {
  const { columns, rows: rawRows } = await parseSpreadsheet(opts.file);

  // Mapping efectivo: el del cliente (saneado) si vino; si no, autodetección.
  const suggested = autodetect(columns, handler.headerVariants);
  const mapping =
    opts.columnMapping && Object.keys(opts.columnMapping).length > 0
      ? sanitizeMapping(opts.columnMapping, columns, handler.headerVariants)
      : suggested;

  const campos = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const structErr = handler.validateMapping(campos);
  if (structErr) throw new ImportError(400, structErr);

  const mappedAll = applyMapping(rawRows, mapping);
  const mapped: MappedRow[] = [];
  for (let i = 0; i < mappedAll.length; i++) {
    if (Object.keys(mappedAll[i]).length === 0) continue; // fila sin datos mapeados
    mapped.push({ row: i + 2, mapped: mappedAll[i] }); // +2 = 1-indexed + header
  }
  if (mapped.length === 0) throw new ImportError(400, "Sin filas de datos");

  const preview = await handler.process(mapped, opts.clinicId);
  const counts = tally(preview);

  if (opts.dryRun) {
    return {
      entity: handler.entity,
      total: counts.total,
      validos: counts.validos,
      invalidos: counts.invalidos,
      duplicados: counts.duplicados,
      columns,
      suggestedMapping: suggested,
      preview: preview.slice(0, 200),
    };
  }

  const { created, skipped } = await handler.commit(preview, opts.clinicId, opts.skipDuplicates);

  await logAudit({
    clinicId: opts.clinicId,
    userId: opts.userId,
    entityType: handler.auditEntityType,
    action: "create",
    entityId: "bulk-import",
    changes: {
      bulk: {
        before: null,
        after: { entity: handler.entity, count: created, fileName: opts.file.name, skipped, duplicates: counts.duplicados },
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
