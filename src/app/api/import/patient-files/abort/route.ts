// LIMPIEZA de "Archivos en bloque": borra los objetos que quedaron en el
// bucket cuando una subida se canceló o falló y por tanto NUNCA se confirmó.
//
// POST /api/import/patient-files/abort   body: { files: [{ patientId, path }] }
//   → { deleted: number }
//
// Mismas tres defensas que el abort de un solo archivo
// (src/app/api/patients/[id]/uploads/abort/route.ts): sesión + visibilidad,
// el path debe caer en la carpeta de esta clínica + paciente, y solo se borran
// objetos SIN ningún PatientFile que los registre (un archivo ya en el
// expediente no se toca desde aquí, ni siquiera si está borrado lógicamente).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { removeFileFromStorage } from "@/lib/storage";
import { bulkFilePathPrefix, extOfName, isBulkFileExt } from "@/lib/uploads/patient-bulk-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;
const MAX_BATCH_FILES = 2000;

interface FileIn {
  patientId: string;
  path: string;
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.upload");
  if (deniedPerm) return deniedPerm;

  const body = await req.json().catch(() => ({}));
  const files = Array.isArray(body?.files) ? (body.files as FileIn[]) : null;
  if (!files) return NextResponse.json({ error: "Falta la lista de archivos" }, { status: 400 });
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_BATCH_FILES} archivos por lote` }, { status: 400 });
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

  let deleted = 0;
  for (const f of files) {
    if (!f.patientId || !patientesValidos.has(f.patientId)) continue;
    const path = String(f.path ?? "");
    if (!path || !SAFE_PATH.test(path) || path.includes("..")) continue;
    const ext = extOfName(path);
    if (!isBulkFileExt(ext) || !path.startsWith(bulkFilePathPrefix(ctx.clinicId, f.patientId))) continue;

    const registered = await prisma.patientFile.findFirst({
      where: { clinicId: ctx.clinicId, patientId: f.patientId, url: path },
      select: { id: true },
    });
    if (registered) continue; // ya es parte del expediente: no se toca desde aquí

    try {
      await removeFileFromStorage(path);
      deleted++;
    } catch (e) {
      console.error("[import/patient-files/abort] no se pudo borrar el objeto huérfano:", path, e);
    }
  }

  return NextResponse.json({ deleted });
}
