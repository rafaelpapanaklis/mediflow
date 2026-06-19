import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";

/* ═══════════════════════════════════════════════════════════════════ */
/*  PATCH — actualiza las notas clínicas del doctor sobre el archivo   */
/* ═══════════════════════════════════════════════════════════════════ */

const UpdateNotesSchema = z.object({
  doctorNotes: z.string().max(5000, "Las notas no pueden exceder 5000 caracteres"),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = UpdateNotesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Body inválido" }, { status: 400 });
  }

  // Multi-tenant guard
  const existing = await prisma.patientFile.findFirst({
    where:  { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, doctorNotes: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  const updated = await prisma.patientFile.update({
    where: { id: existing.id },
    data:  {
      doctorNotes:          parsed.data.doctorNotes,
      doctorNotesUpdatedAt: new Date(),
    },
    select: {
      doctorNotes:          true,
      doctorNotesUpdatedAt: true,
    },
  });

  await logAudit({
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "patient-file",
    entityId:   existing.id,
    action:     "FILE_NOTES_UPDATED",
    changes: {
      doctorNotes: {
        before: existing.doctorNotes ?? "",
        after:  parsed.data.doctorNotes,
      },
    },
  });

  return NextResponse.json({
    doctorNotes:          updated.doctorNotes ?? "",
    doctorNotesUpdatedAt: updated.doctorNotesUpdatedAt?.toISOString() ?? null,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasPermission(ctx.role as any, "medicalRecord.delete")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Ya borrado lógicamente — idempotente.
  if (file.deletedAt) return NextResponse.json({ success: true, softDeleted: true });

  // Motivo opcional del body.
  let reason: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 2000);
    }
  } catch {
    /* sin body */
  }

  // NOM-004 conservación / NOM-024 §7 — NO hard-delete: borrado LÓGICO. El blob
  // en Storage se PRESERVA (parte del expediente, conservación ≥5 años); solo se
  // marca deletedAt para ocultarlo de las vistas activas.
  await prisma.patientFile.updateMany({
    where: { id: params.id, clinicId: ctx.clinicId },
    data:  { deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason },
  });

  await logAudit({
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "patient-file",
    entityId:   params.id,
    action:     "soft_delete",
    changes: {
      _deleted: {
        before: { name: file.name, category: file.category, url: file.url },
        after:  { deletedAt: new Date().toISOString(), deleteReason: reason },
      },
    },
  });

  return NextResponse.json({ success: true, softDeleted: true });
}
