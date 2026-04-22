import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

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

  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Delete from Supabase Storage
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const urlPath = new URL(file.url).pathname;
    const storagePath = urlPath.split("/patient-files/").pop();
    if (storagePath) {
      await supabase.storage.from("patient-files").remove([storagePath]);
    }
  } catch (e) {
    console.error("Storage delete error (non-fatal):", e);
  }

  await prisma.patientFile.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
  return NextResponse.json({ success: true });
}
