import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
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
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    return NextResponse.json({ error: "Solo .xlsx, .xls o .csv" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Archivo supera 10MB" }, { status: 413 });
  }

  let rawRows: Record<string, any>[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb  = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
    rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: false, defval: "" });
  } catch (e: any) {
    return NextResponse.json({ error: "No se pudo leer el archivo: " + (e?.message ?? "parse error") }, { status: 400 });
  }

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "Sin filas de datos" }, { status: 400 });
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Máximo ${MAX_ROWS} filas. Divide el archivo.` }, { status: 400 });
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
