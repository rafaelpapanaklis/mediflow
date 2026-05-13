import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    subjective: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
    assessment: z.string().nullable().optional(),
    plan: z.string().nullable().optional(),
    status: z.enum(["DRAFT", "SIGNED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");

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
 * PATCH /api/clinical-notes/[id]
 * Actualiza fields SOAP y/o el status (DRAFT → SIGNED).
 * status vive en specialtyData.status para evitar migración del schema.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(dbUser, "medicalRecord.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: dbUser.clinicId },
    select: {
      id: true,
      doctorId: true,
      specialtyData: true,
      isPrivate: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Sólo el doctor dueño o admins pueden editar.
  const isOwner = existing.doctorId === dbUser.id;
  const isAdmin = dbUser.role === "ADMIN" || dbUser.role === "SUPER_ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.subjective !== undefined) data.subjective = parsed.data.subjective;
  if (parsed.data.objective !== undefined) data.objective = parsed.data.objective;
  if (parsed.data.assessment !== undefined) data.assessment = parsed.data.assessment;
  if (parsed.data.plan !== undefined) data.plan = parsed.data.plan;

  if (parsed.data.status !== undefined) {
    const currentSpec = (existing.specialtyData ?? {}) as Record<string, unknown>;
    data.specialtyData = {
      ...currentSpec,
      status: parsed.data.status,
      ...(parsed.data.status === "SIGNED" ? { signedAt: new Date().toISOString() } : {}),
    };
  }

  // Capturamos before-state completo (los campos que pueden cambiar) para
  // diff confiable. La query existing arriba no incluye SOAP fields.
  const beforeState = await prisma.medicalRecord.findUnique({
    where: { id: params.id },
    select: { subjective: true, objective: true, assessment: true, plan: true, specialtyData: true },
  });

  const updated = await prisma.medicalRecord.update({
    where: { id: params.id },
    data,
    select: {
      id: true,
      patientId: true,
      doctorId: true,
      subjective: true,
      objective: true,
      assessment: true,
      plan: true,
      specialtyData: true,
      updatedAt: true,
    },
  });

  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "record",
    entityId: params.id,
    action: "update",
    before: beforeState as any,
    after: { subjective: updated.subjective, objective: updated.objective, assessment: updated.assessment, plan: updated.plan, specialtyData: updated.specialtyData },
  });

  revalidateAfter("clinicalNotes");
  return NextResponse.json({ note: updated });
}
