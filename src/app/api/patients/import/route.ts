import { NextRequest, NextResponse } from "next/server";
import * as ExcelJS from "exceljs";
import { Readable } from "stream";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { validateSpreadsheet } from "@/lib/validate-upload";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS  = 5000;
const BATCH     = 200;

const HEADER_VARIANTS: Record<string, string[]> = {
  firstName: ["nombre", "nombres", "firstname", "firstname", "primernombre"],
  lastName:  ["apellido", "apellidos", "lastname"],
  email:     ["email", "correo", "correoelectronico", "emailaddress"],
  phone:     ["telefono", "celular", "whatsapp", "phone", "movil"],
  dob:       ["fechadenacimiento", "nacimiento", "fechanac", "birthdate", "dob", "fechanacimiento"],
  gender:    ["genero", "sexo", "gender"],
  address:   ["direccion", "domicilio", "address"],
  bloodType: ["tiposangre", "tipodesangre", "bloodtype"],
  notes:     ["notas", "observaciones", "comentarios", "notes"],
};

const norm = (s: string) =>
  s.toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s|_|-/g, "").trim();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VALID_BLOOD = new Set(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);

interface ParsedRow {
  row: number;
  data: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    dob?: Date | null;
    gender?: "M" | "F" | "OTHER";
    bloodType?: string | null;
    address?: string | null;
    notes?: string | null;
  };
  status: "ok" | "error" | "duplicate";
  errors: string[];
  warnings: string[];
  patientNumber?: string;
}

function buildHeaderMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers) {
    const n = norm(header);
    for (const [canonical, variants] of Object.entries(HEADER_VARIANTS)) {
      if (variants.includes(n)) {
        map[header] = canonical;
        break;
      }
    }
  }
  return map;
}

function parseGender(v: string): "M" | "F" | "OTHER" {
  const n = v.toString().toLowerCase().trim();
  if (["m", "masc", "masculino", "hombre", "male"].includes(n)) return "M";
  if (["f", "fem", "femenino", "mujer", "female"].includes(n)) return "F";
  return "OTHER";
}

function parsePhone(v: string): string | null {
  const cleaned = v.toString().replace(/[\s\-()]/g, "").trim();
  return cleaned || null;
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const str = v.toString().trim();
  if (!str) return null;
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isRowEmpty(raw: Record<string, any>, headerMap: Record<string, string>): boolean {
  for (const key of Object.keys(headerMap)) {
    const v = raw[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Parseo del upload con exceljs.
//
// La lib `xlsx` (SheetJS 0.18.5) tiene 2 HIGH sin fix — GHSA-4r6h-8v6p-xvw6
// (prototype pollution) y GHSA-5pgg-2g8v-p4x9 (ReDoS) — y aquí el archivo lo
// SUBE el usuario: input no confiable. `xlsx` queda solo para GENERAR archivos
// (template de import, exports de reportes), que es output confiable.
//
// El formato .xls legacy (OLE2) deja de aceptarse: exceljs solo lee OOXML/CSV.
// La validación de extensión responde 400 "Solo .xlsx o .csv".
// ---------------------------------------------------------------------------

function utcDateToLocal(d: Date): Date {
  // exceljs ancla las fechas de celda a medianoche UTC; se re-anclan a
  // medianoche local para que la dob no retroceda un día al mostrarse en MX.
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
    // Sniff del separador en la primera línea (Excel en locales es-* exporta con ";").
    const firstLine = clean.subarray(0, Math.min(clean.length, 4096)).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    const delimiter = [",", ";", "\t"].reduce((a, b) => (firstLine.split(b).length > firstLine.split(a).length ? b : a));
    return wb.csv.read(Readable.from([clean]), {
      parserOptions: { delimiter },
      map: (v: any) => v, // valores crudos como texto, igual que el parser anterior
    });
  }
  await wb.xlsx.load(fileBytes);
  return wb.worksheets[0];
}

function worksheetToRows(ws: ExcelJS.Worksheet, maxRows: number): { rows: Record<string, any>[]; exceeded: boolean } {
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
    if (!hasValue) return; // fila en blanco: el parser anterior también la saltaba
    rows.push(obj);
    if (rows.length > maxRows) exceeded = true;
  });
  return { rows, exceeded };
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 3, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const dryRun = (formData.get("dryRun") as string) === "true";
  const skipDuplicates = (formData.get("skipDuplicates") as string) !== "false";

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  // .xls legacy (OLE2) ya NO se acepta: el parseo migró a exceljs (ver helpers).
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return NextResponse.json({ error: "Solo .xlsx o .csv" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Archivo supera 5MB" }, { status: 413 });
  }

  // Blindaje: valida la FIRMA real del contenido (no la extensión). .xlsx debe
  // ser un contenedor ZIP/OOXML, .xls un OLE2 y .csv texto. Frena un ejecutable
  // o binario renombrado a .xlsx antes de pasarlo al parser.
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  let fileBytes: ArrayBuffer;
  try {
    fileBytes = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
  }
  const magicError = await validateSpreadsheet(fileBytes, ext);
  if (magicError) {
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: magicError },
      { status: 400 },
    );
  }

  let rawRows: Record<string, any>[];
  let rowsExceeded = false;
  try {
    const sheet = await readUploadWorksheet(fileBytes, ext);
    if (!sheet) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
    const collected = worksheetToRows(sheet, MAX_ROWS);
    rawRows = collected.rows;
    rowsExceeded = collected.exceeded;
  } catch (e: any) {
    return NextResponse.json({ error: "No se pudo leer el archivo: " + (e?.message ?? "parse error") }, { status: 400 });
  }

  // Tope de filas ANTES de validar/tocar la DB.
  if (rowsExceeded) {
    return NextResponse.json({ error: `Máximo ${MAX_ROWS} filas. Divide el archivo.` }, { status: 413 });
  }
  if (rawRows.length === 0) {
    return NextResponse.json({ error: "Sin filas de datos" }, { status: 400 });
  }

  const headerMap = buildHeaderMap(Object.keys(rawRows[0]));
  if (Object.values(headerMap).filter(c => c === "firstName" || c === "lastName").length < 2) {
    return NextResponse.json({ error: "El archivo debe tener columnas 'nombre' y 'apellido'" }, { status: 400 });
  }

  // Procesar filas: normalizar + validar
  const seenInFile = { emails: new Set<string>(), phones: new Set<string>() };
  const parsed: ParsedRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    if (isRowEmpty(raw, headerMap)) continue;

    const row: ParsedRow = {
      row: i + 2, // +2 = 1-indexed + header row
      data: {},
      status: "ok",
      errors: [],
      warnings: [],
    };

    for (const [origKey, canonical] of Object.entries(headerMap)) {
      const v = raw[origKey];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      const sv = String(v).trim();

      switch (canonical) {
        case "firstName":
        case "lastName":
        case "address":
        case "notes":
          row.data[canonical] = sv;
          break;
        case "email": {
          if (EMAIL_RE.test(sv)) row.data.email = sv.toLowerCase();
          else { row.data.email = null; row.warnings.push(`Email inválido "${sv}" — guardado sin email`); }
          break;
        }
        case "phone":
          row.data.phone = parsePhone(sv);
          break;
        case "dob": {
          const d = parseDate(v);
          if (d) row.data.dob = d;
          else { row.data.dob = null; row.warnings.push(`Fecha "${sv}" inválida — guardada sin fecha`); }
          break;
        }
        case "gender":
          row.data.gender = parseGender(sv);
          break;
        case "bloodType": {
          const up = sv.toUpperCase();
          if (VALID_BLOOD.has(up)) row.data.bloodType = up;
          else { row.data.bloodType = null; row.warnings.push(`Tipo sangre "${sv}" inválido — guardado sin valor`); }
          break;
        }
      }
    }

    if (!row.data.firstName) row.errors.push("Falta nombre");
    if (!row.data.lastName)  row.errors.push("Falta apellido");
    if (row.errors.length > 0) row.status = "error";

    // Dedup dentro del archivo
    if (row.status === "ok") {
      if (row.data.email && seenInFile.emails.has(row.data.email)) {
        row.status = "duplicate";
        row.warnings.push("Email repetido en el archivo");
      } else if (row.data.phone && seenInFile.phones.has(row.data.phone)) {
        row.status = "duplicate";
        row.warnings.push("Teléfono repetido en el archivo");
      } else {
        if (row.data.email) seenInFile.emails.add(row.data.email);
        if (row.data.phone) seenInFile.phones.add(row.data.phone);
      }
    }

    parsed.push(row);
  }

  // Dedup contra DB en una sola query
  const validForDedup = parsed.filter(r => r.status === "ok");
  const emails = validForDedup.map(r => r.data.email).filter(Boolean) as string[];
  const phones = validForDedup.map(r => r.data.phone).filter(Boolean) as string[];

  if (emails.length > 0 || phones.length > 0) {
    const orClauses: any[] = [];
    if (emails.length > 0) orClauses.push({ email: { in: emails } });
    if (phones.length > 0) orClauses.push({ phone: { in: phones } });
    const existing = await prisma.patient.findMany({
      where: { clinicId: ctx.clinicId, OR: orClauses },
      select: { email: true, phone: true },
    });
    const dbEmails = new Set(existing.map(e => e.email).filter(Boolean) as string[]);
    const dbPhones = new Set(existing.map(e => e.phone).filter(Boolean) as string[]);
    for (const r of parsed) {
      if (r.status !== "ok") continue;
      if ((r.data.email && dbEmails.has(r.data.email)) || (r.data.phone && dbPhones.has(r.data.phone))) {
        r.status = "duplicate";
        r.warnings.push("Ya existe en la base de datos");
      }
    }
  }

  const counts = {
    total: parsed.length,
    validos: parsed.filter(r => r.status === "ok").length,
    invalidos: parsed.filter(r => r.status === "error").length,
    duplicados: parsed.filter(r => r.status === "duplicate").length,
  };

  if (dryRun) {
    return NextResponse.json({
      ...counts,
      preview: parsed.slice(0, 200).map(r => ({
        row: r.row,
        data: r.data,
        status: r.status,
        errors: r.errors,
        warnings: r.warnings,
      })),
    });
  }

  // Commit real
  const toInsert = parsed.filter(r => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));
  let created = 0;
  const currentCount = await prisma.patient.count({ where: { clinicId: ctx.clinicId } });
  toInsert.forEach((r, i) => {
    r.patientNumber = `P${String(currentCount + 1 + i).padStart(4, "0")}`;
  });

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    const buildData = () => slice.map(r => ({
      clinicId:      ctx.clinicId,
      patientNumber: r.patientNumber!,
      firstName:     r.data.firstName!,
      lastName:      r.data.lastName!,
      email:         r.data.email ?? null,
      phone:         r.data.phone ?? null,
      dob:           r.data.dob ?? null,
      gender:        (r.data.gender ?? "OTHER") as any,
      bloodType:     r.data.bloodType ?? null,
      address:       r.data.address ?? null,
      notes:         r.data.notes ?? null,
    }));
    try {
      const res = await prisma.patient.createMany({ data: buildData(), skipDuplicates: true });
      created += res.count;
    } catch (e: any) {
      if (e?.code === "P2002") {
        // race en patientNumber: recalcular y reintentar una vez
        const newCount = await prisma.patient.count({ where: { clinicId: ctx.clinicId } });
        slice.forEach((r, j) => { r.patientNumber = `P${String(newCount + 1 + j).padStart(4, "0")}`; });
        const res = await prisma.patient.createMany({ data: buildData(), skipDuplicates: true });
        created += res.count;
      } else {
        throw e;
      }
    }
  }

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient",
    action: "create",
    entityId: "bulk-import",
    changes: {
      bulk: {
        before: null,
        after: { count: created, fileName: file.name, skipped: toInsert.length - created, duplicatesInFile: counts.duplicados },
      },
    },
  });

  return NextResponse.json({
    created,
    skipped: toInsert.length - created,
    duplicates: counts.duplicados,
    errors: parsed.filter(r => r.status === "error").slice(0, 50).map(r => ({ row: r.row, errors: r.errors })),
  });
}
