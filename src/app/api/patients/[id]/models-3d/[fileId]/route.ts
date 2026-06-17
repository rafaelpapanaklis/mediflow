import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/patients/[id]/models-3d/[fileId] — borra el modelo 3D de Storage
// y su PatientFile. Multi-tenant: clinicId SIEMPRE de la sesión.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; fileId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!hasPermission(ctx.role as any, "medicalRecord.delete")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const file = await prisma.patientFile.findFirst({
    where: { id: params.fileId, patientId: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Ya borrado lógicamente — idempotente.
  if (file.deletedAt) return NextResponse.json({ success: true, softDeleted: true });

  // Motivo opcional del body.
  let reason: string | null = null;
  try {
    const body = await _req.json();
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 2000);
    }
  } catch {
    /* sin body */
  }

  // NOM-004 conservación / NOM-024 §7 — NO hard-delete: borrado LÓGICO. El blob
  // en Storage se PRESERVA (expediente, conservación ≥5 años); deletedAt oculta
  // el modelo 3D de la vista activa.
  await prisma.patientFile.updateMany({
    where: { id: params.fileId, clinicId: ctx.clinicId },
    data:  { deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason },
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient-file",
    entityId: params.fileId,
    action: "soft_delete",
    changes: {
      _deleted: {
        before: { name: file.name, category: file.category, url: file.url },
        after: { deletedAt: new Date().toISOString(), deleteReason: reason },
      },
    },
  });

  return NextResponse.json({ success: true, softDeleted: true });
}

// PATCH /api/patients/[id]/models-3d/[fileId] — guarda las notas clínicas
// (doctorNotes) y/o las marcas del visor (annotations) del modelo 3D.
// Multi-tenant: clinicId SIEMPRE de la sesión; el body nunca define la clínica.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; fileId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Valida que el PatientFile sea del paciente y de la clínica de la sesión.
  const file = await prisma.patientFile.findFirst({
    where: { id: params.fileId, patientId: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  let body: { doctorNotes?: unknown; annotations?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const data: { doctorNotes?: string; doctorNotesUpdatedAt?: Date; annotations?: unknown } = {};
  if (typeof body.doctorNotes === "string") {
    data.doctorNotes = body.doctorNotes;
    data.doctorNotesUpdatedAt = new Date();
  }
  // El cliente envía siempre un array de marcas (posiblemente vacío).
  if (Array.isArray(body.annotations)) {
    data.annotations = body.annotations;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  await prisma.patientFile.updateMany({
    where: { id: params.fileId, clinicId: ctx.clinicId },
    data: data as any,
  });

  return NextResponse.json({ success: true });
}
