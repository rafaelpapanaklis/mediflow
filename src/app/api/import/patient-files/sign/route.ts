// PASO 2 de "Archivos en bloque": firma la subida DIRECTA de cada archivo YA
// emparejado con un paciente (paso 1, /match).
//
// POST /api/import/patient-files/sign
//   body: { files: [{ index, patientId, name, size, contentType? }] }
//   → { signed: [{ index, path, token, signedUrl, contentType }],
//       skipped: [{ index, reason: "duplicate" }],
//       errors: [{ index, error, code? }] }
//
// QUÉ SE VALIDA (todo en el servidor, nada se cree del cliente):
//   · sesión + permiso (xrays.upload) + rol
//   · cada patientId es de ESTA clínica y visible para quien importa
//   · extensión dentro de la whitelist (jpg/png/gif/webp/bmp/tiff/pdf) y
//     tamaño DECLARADO <= 50 MB (mismo tope que /api/xrays)
//   · reintento sin duplicar: si YA existe un PatientFile con el mismo
//     paciente + nombre + tamaño, ese archivo se OMITE (no se firma ni se
//     vuelve a subir) — así reintentar el lote entero no duplica lo que ya
//     entró en un intento anterior
//   · cuota del plan con la SUMA de lo que de verdad se va a firmar (chequeo
//     barato; el cobro definitivo, con el tamaño REAL, lo hace /confirm)
//   · el PATH lo compone SIEMPRE el servidor (clinicId de la sesión + patientId
//     ya validado + un UUID nuevo), nunca el cliente
//
// Cada archivo se evalúa por su cuenta: uno inválido no aborta el lote.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import {
  BULK_FILE_EXT,
  MAX_BULK_FILE_BYTES,
  MAX_BULK_FILE_LABEL,
  bulkFileStoragePath,
  extOfName,
  isBulkFileExt,
  mimeForBulkFileExt,
  safeBulkFileName,
} from "@/lib/uploads/patient-bulk-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_FILES = 2000;

interface FileIn {
  index: number;
  patientId: string;
  name: string;
  size: number;
  contentType?: string;
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.upload");
  if (deniedPerm) return deniedPerm;

  const body = await req.json().catch(() => ({}));
  const files = Array.isArray(body?.files) ? (body.files as FileIn[]) : null;
  if (!files) return NextResponse.json({ error: "Falta la lista de archivos" }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ signed: [], skipped: [], errors: [] });
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_BATCH_FILES} archivos por lote` }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  // Pacientes referidos: de ESTA clínica y visibles para quien importa (una
  // sola consulta para todo el lote, no una por archivo).
  const patientIds = Array.from(new Set(files.map((f) => f.patientId).filter(Boolean)));
  const patients = await prisma.patient.findMany({
    where: { clinicId: ctx.clinicId, id: { in: patientIds }, deletedAt: null },
    select: { id: true, visibleUserIds: true },
  });
  const patientesValidos = new Set(
    patients
      .filter((p) => canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, p.visibleUserIds))
      .map((p) => p.id),
  );

  const signed: Array<{ index: number; path: string; token: string; signedUrl: string; contentType: string }> = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  const errors: Array<{ index: number; error: string; code?: string }> = [];
  const porFirmar: Array<{ f: FileIn; ext: string; path: string; contentType: string }> = [];

  for (const f of files) {
    if (!f.patientId || !patientesValidos.has(f.patientId)) {
      errors.push({ index: f.index, error: "Paciente no encontrado o sin visibilidad" });
      continue;
    }
    const name = String(f.name ?? "").trim();
    if (!name) { errors.push({ index: f.index, error: "Falta el nombre del archivo" }); continue; }
    const ext = extOfName(name);
    if (!isBulkFileExt(ext)) {
      errors.push({ index: f.index, error: `Formato no permitido. Se aceptan: ${BULK_FILE_EXT.map((e) => `.${e}`).join(", ")}.` });
      continue;
    }
    const size = Number(f.size);
    if (!Number.isFinite(size) || size <= 0) { errors.push({ index: f.index, error: "Falta el tamaño del archivo" }); continue; }
    if (size > MAX_BULK_FILE_BYTES) {
      errors.push({ index: f.index, error: `Archivo demasiado grande (máx ${MAX_BULK_FILE_LABEL}).`, code: "FILE_TOO_LARGE" });
      continue;
    }

    // Reintento sin duplicar: mismo paciente + nombre + tamaño ya registrado.
    const existing = await prisma.patientFile.findFirst({
      where: { clinicId: ctx.clinicId, patientId: f.patientId, name, size },
      select: { id: true },
    });
    if (existing) { skipped.push({ index: f.index, reason: "duplicate" }); continue; }

    const safeName = safeBulkFileName(name);
    const path = bulkFileStoragePath(ctx.clinicId, f.patientId, randomUUID(), safeName);
    const contentType = mimeForBulkFileExt(ext);
    porFirmar.push({ f, ext, path, contentType });
  }

  if (porFirmar.length === 0) return NextResponse.json({ signed, skipped, errors });

  // Cuota agregada de lo que de verdad se va a firmar (fail-open: el cobro
  // real, con el tamaño medido en Storage, lo hace /confirm por archivo).
  const totalDeclarado = porFirmar.reduce((a, x) => a + Number(x.f.size), 0);
  try {
    const quotaErr = await storageQuotaError(ctx.clinicId, totalDeclarado);
    if (quotaErr) return quotaErr;
  } catch (e) {
    console.error("[import/patient-files/sign] no se pudo evaluar la cuota, se deja pasar:", e);
  }

  const supabase = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  for (const { f, path, contentType } of porFirmar) {
    const { data, error } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      console.error("[import/patient-files/sign] createSignedUploadUrl:", error);
      errors.push({ index: f.index, error: "No se pudo preparar la subida. Intenta de nuevo." });
      continue;
    }
    signed.push({ index: f.index, path, token: data.token, signedUrl: data.signedUrl, contentType });
  }

  return NextResponse.json({ signed, skipped, errors });
}
