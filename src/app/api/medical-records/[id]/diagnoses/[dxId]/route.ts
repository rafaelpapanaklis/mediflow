import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string; dxId: string } }

/**
 * DELETE /api/medical-records/[id]/diagnoses/[dxId]
 * Multi-tenant: validamos que el medical_record pertenezca a ctx.clinicId.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN", "DOCTOR"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const record = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!record) return NextResponse.json({ error: "record_not_found" }, { status: 404 });

  const dx = await prisma.medicalRecordDiagnosis.findFirst({
    where: { id: params.dxId, medicalRecordId: params.id },
    select: { id: true, cie10Code: true, isPrimary: true },
  });
  if (!dx) return NextResponse.json({ error: "diagnosis_not_found" }, { status: 404 });

  await prisma.medicalRecordDiagnosis.delete({ where: { id: params.dxId } });

  await logMutation({
    req,
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "record",
    entityId: params.id,
    action: "update",
    before: { diagnosisRemoved: { code: dx.cie10Code, isPrimary: dx.isPrimary } },
  });

  return NextResponse.json({ deleted: true });
}
