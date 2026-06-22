import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

// DELETE /api/prescriptions/[id]
// NOM-004 conservación / NOM-024 §7 — NO borra físico: ANULA lógicamente la
// receta (status=VOIDED + voidedAt + voidReason). El registro y el QR público
// se conservan; la verificación pública muestra "ANULADA". Solo el doctor que
// la emitió o admins. Motivo opcional en el body: { reason }.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasPermission(ctx.role as Role, "prescription.delete")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await prisma.prescription.findFirst({
    where:  { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, doctorId: true, patientId: true, status: true, voidedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });
  }

  const isOwner = existing.doctorId === ctx.userId;
  const isAdmin = ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Ya anulada — idempotente (no re-escribe motivo/fecha).
  if (existing.voidedAt || existing.status === "VOIDED") {
    return NextResponse.json({ success: true, voided: true });
  }

  // Motivo opcional del body (el DELETE puede venir sin cuerpo).
  let reason: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 2000);
    }
  } catch {
    /* sin body */
  }

  // NOM-004 conservación / NOM-024 §7 — anulación LÓGICA (jamás hard-delete).
  // El registro y el QR público se conservan; la verificación muestra "ANULADA".
  await prisma.prescription.update({
    where: { id: existing.id },
    data: {
      status:     "VOIDED",
      voidedAt:   new Date(),
      voidedBy:   ctx.userId,
      voidReason: reason,
    },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "prescription",
    entityId: params.id,
    action: "void",
    before: { patientId: existing.patientId, doctorId: existing.doctorId, status: existing.status ?? "ACTIVE" },
    after:  { status: "VOIDED", voidReason: reason },
  });

  revalidatePath("/dashboard/clinical");
  revalidatePath("/dashboard/patients");
  return NextResponse.json({ success: true, voided: true });
}
