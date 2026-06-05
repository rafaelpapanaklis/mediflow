import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS, extractStoragePath } from "@/lib/storage";
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

  // Borra de Storage. No fatal si falla — el registro igual se elimina.
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const storagePath = extractStoragePath(file.url, BUCKETS.PATIENT_FILES);
    if (storagePath) {
      await supabase.storage.from(BUCKETS.PATIENT_FILES).remove([storagePath]);
    }
  } catch (e) {
    console.error("[models-3d] storage delete error (non-fatal):", e);
  }

  await prisma.patientFile.deleteMany({
    where: { id: params.fileId, clinicId: ctx.clinicId },
  });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient-file",
    entityId: params.fileId,
    action: "delete",
    changes: {
      _deleted: {
        before: { name: file.name, category: file.category, url: file.url },
        after: null,
      },
    },
  });

  return NextResponse.json({ success: true });
}
