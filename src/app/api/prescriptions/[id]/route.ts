import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

// DELETE /api/prescriptions/[id]
// Elimina una receta. Solo el doctor que la emitio o admins.
// Cascade: PrescriptionItem se borra por FK; MedicalRecord queda intacto.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasPermission(ctx.role as Role, "prescription.delete")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await prisma.prescription.findFirst({
    where:  { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, doctorId: true, patientId: true, cofeprisFolio: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });
  }

  const isOwner = existing.doctorId === ctx.userId;
  const isAdmin = ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Receta con folio COFEPRIS asignado: bloquear delete (compliance).
  if (existing.cofeprisFolio) {
    return NextResponse.json(
      { error: "No se puede eliminar una receta con folio COFEPRIS. Reemplaza por una nueva." },
      { status: 400 },
    );
  }

  await prisma.prescription.delete({ where: { id: params.id } });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "prescription",
    entityId: params.id,
    action: "delete",
    before: { patientId: existing.patientId, doctorId: existing.doctorId },
  });

  revalidatePath("/dashboard/clinical");
  revalidatePath("/dashboard/patients");
  return NextResponse.json({ success: true });
}
