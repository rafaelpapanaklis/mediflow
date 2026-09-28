// PASO 3 de "Archivos en bloque": el objeto YA está en el bucket (lo subió el
// navegador con la signed upload URL del paso 2). Aquí el servidor decide si
// esa subida se convierte en un registro del expediente de cada paciente.
//
// POST /api/import/patient-files/confirm
//   body: { files: [{ index, patientId, path, name, category }] }
//   → { created: [{ index, id, name, url, size, mimeType, category }],
//       errors: [{ index, error, code? }] }
//
// NO se cree NADA de lo que diga el cliente:
//   · el `path` debe caer exactamente en la carpeta de ESTA clínica + paciente
//   · el tamaño se le pregunta a STORAGE (getStorageObjectSize), nunca al cliente
//   · con ese tamaño real se re-evalúa la cuota; si no cabe, el objeto se BORRA
//   · la firma real del contenido (magic number) se valida siempre: el tope de
//     este flujo (50 MB) es chico de sobra para descargarlo y revisarlo
//   · la categoría se valida contra la whitelist de FileCategory; si no casa,
//     entra como OTHER (nunca se inventa una categoría clínica)
//
// Idempotente: si /confirm se repite (reintento, doble clic) con el mismo
// `path`, devuelve la fila que ya existe en vez de duplicar.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { BUCKETS, getStorageObjectSize, removeFileFromStorage, signMaybeUrl } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import { validateMagicNumber } from "@/lib/validate-upload";
import { createClient as createAdmin } from "@supabase/supabase-js";
import {
  BULK_FILE_ALLOWED_MIME,
  bulkFilePathPrefix,
  extOfName,
  guessFileCategory,
  isBulkFileExt,
  isFileCategory,
  mimeForBulkFileExt,
} from "@/lib/uploads/patient-bulk-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BATCH_FILES = 2000;
const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;

interface FileIn {
  index: number;
  patientId: string;
  path: string;
  name: string;
  category?: string;
}

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Tamaño real del objeto, con reintentos cortos (justo tras el PUT puede tardar un instante en listarse). */
async function sizeWithRetry(path: string): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const size = await getStorageObjectSize(path);
    if (size != null) return size;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return null;
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
  if (files.length === 0) return NextResponse.json({ created: [], errors: [] });
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_BATCH_FILES} archivos por lote` }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

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

  const created: Array<{ index: number; id: string; name: string; url: string; size: number; mimeType: string; category: string }> = [];
  const errors: Array<{ index: number; error: string; code?: string }> = [];
  const supabase = getAdminSupabase();

  for (const f of files) {
    if (!f.patientId || !patientesValidos.has(f.patientId)) {
      errors.push({ index: f.index, error: "Paciente no encontrado o sin visibilidad" });
      continue;
    }
    const path = String(f.path ?? "");
    if (!path || !SAFE_PATH.test(path) || path.includes("..")) {
      errors.push({ index: f.index, error: "Path inválido" });
      continue;
    }
    const ext = extOfName(path);
    if (!isBulkFileExt(ext) || !path.startsWith(bulkFilePathPrefix(ctx.clinicId, f.patientId))) {
      errors.push({ index: f.index, error: "Path inválido" });
      continue;
    }

    // Idempotencia: /confirm repetido con el mismo path devuelve lo ya creado.
    const existing = await prisma.patientFile.findFirst({
      where: { patientId: f.patientId, clinicId: ctx.clinicId, url: path, deletedAt: null },
      select: { id: true, name: true, url: true, size: true, mimeType: true, category: true },
    });
    if (existing) {
      const signedUrl = await signMaybeUrl(existing.url).catch(() => "");
      created.push({ index: f.index, id: existing.id, name: existing.name, url: signedUrl, size: existing.size ?? 0, mimeType: existing.mimeType ?? "", category: existing.category });
      continue;
    }

    const realSize = await sizeWithRetry(path);
    if (realSize == null) {
      errors.push({ index: f.index, error: "No pudimos verificar el archivo subido. Vuelve a intentarlo.", code: "SIZE_UNVERIFIED" });
      continue;
    }

    let quotaErr: Awaited<ReturnType<typeof storageQuotaError>> = null;
    try {
      quotaErr = await storageQuotaError(ctx.clinicId, realSize);
    } catch (e) {
      console.error("[import/patient-files/confirm] no se pudo evaluar la cuota, se deja pasar:", e);
    }
    if (quotaErr) {
      await removeFileFromStorage(path).catch((e) => console.error("[import/patient-files/confirm] no se pudo borrar el objeto sobre cuota:", e));
      const j = await quotaErr.json().catch(() => ({}));
      errors.push({ index: f.index, error: String(j?.error ?? "Sin espacio en tu plan"), code: "PLAN_LIMIT_STORAGE" });
      continue;
    }

    // 50 MB es chico de sobra para descargar y validar SIEMPRE la firma real
    // del contenido (a diferencia de los estudios de hasta 2 GB, aquí no hace
    // falta el umbral de "archivo grande sin inspeccionar").
    const dl = await supabase.storage.from(BUCKETS.PATIENT_FILES).download(path);
    if (dl.error || !dl.data) {
      console.warn("[import/patient-files/confirm] no se pudo descargar para validar:", dl.error);
      errors.push({ index: f.index, error: "No se pudo leer el archivo subido. Vuelve a intentarlo." });
      continue;
    }
    const bytes = await dl.data.arrayBuffer();
    const magicError = await validateMagicNumber(bytes, BULK_FILE_ALLOWED_MIME);
    if (magicError) {
      await removeFileFromStorage(path).catch((e) => console.error("[import/patient-files/confirm] no se pudo borrar el objeto inválido:", e));
      errors.push({ index: f.index, error: "Archivo no válido: el contenido no coincide con la extensión", code: "INVALID_CONTENT" });
      continue;
    }

    const originalName = String(f.name ?? "").trim().slice(0, 120) || "archivo";
    const category = isFileCategory(f.category) ? f.category : guessFileCategory(originalName);
    const contentType = mimeForBulkFileExt(ext);

    const record = await prisma.patientFile.create({
      data: {
        patientId: f.patientId,
        clinicId: ctx.clinicId,
        uploadedBy: ctx.userId,
        name: originalName,
        url: path,
        size: realSize,
        mimeType: contentType,
        category: category as any,
      },
      select: { id: true, name: true, url: true, size: true, mimeType: true, category: true },
    });
    const signedUrl = await signMaybeUrl(record.url).catch(() => "");
    created.push({ index: f.index, id: record.id, name: record.name, url: signedUrl, size: record.size ?? 0, mimeType: record.mimeType ?? "", category: record.category });
  }

  return NextResponse.json({ created, errors });
}
