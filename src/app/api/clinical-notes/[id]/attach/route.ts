import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

const AttachSchema = z.object({
  fileId: z.string().min(1),
});

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

interface Params { params: { id: string } }

/**
 * POST /api/clinical-notes/[id]/attach
 * Vincula un PatientFile (subido vía /api/xrays POST) a la nota clínica.
 * El link queda guardado en specialtyData.attachments[] como
 *   { id, name, mime, addedAt }
 * (sin migración de schema, mismo enfoque que status DRAFT/SIGNED).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(dbUser, "medicalRecord.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = AttachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const note = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: dbUser.clinicId },
    select: { id: true, doctorId: true, specialtyData: true },
  });
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const isOwner = note.doctorId === dbUser.id;
  const isAdmin = dbUser.role === "ADMIN" || dbUser.role === "SUPER_ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = await prisma.patientFile.findFirst({
    where: { id: parsed.data.fileId, clinicId: dbUser.clinicId },
    select: { id: true, name: true, mimeType: true },
  });
  if (!file) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

  const currentSpec = (note.specialtyData ?? {}) as Record<string, unknown>;
  const attachments = Array.isArray(currentSpec.attachments)
    ? (currentSpec.attachments as Array<Record<string, unknown>>)
    : [];

  // Idempotencia: si ya existe, no dupliques.
  if (attachments.some((a) => a.id === file.id)) {
    return NextResponse.json({ note: { id: note.id, attachments } });
  }

  attachments.push({
    id: file.id,
    name: file.name,
    mime: file.mimeType ?? "application/octet-stream",
    addedAt: new Date().toISOString(),
  });

  const updated = await prisma.medicalRecord.update({
    where: { id: note.id },
    data: {
      specialtyData: { ...currentSpec, attachments } as Prisma.InputJsonValue,
    },
    select: { id: true, specialtyData: true },
  });

  return NextResponse.json({ note: updated });
}
