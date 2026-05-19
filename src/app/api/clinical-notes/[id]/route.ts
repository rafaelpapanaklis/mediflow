import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    subjective: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
    assessment: z.string().nullable().optional(),
    plan: z.string().nullable().optional(),
    status: z.enum(["DRAFT", "SIGNED"]).optional(),
    // specialtyData: payload completo del form de especialidad
    // (DentalForm.specialtyData con odontogram, procedures, periodontal,
    // occlusal, tmj, hygieneInstructions, xrays, nextVisit, type).
    // Se mergea con el existente para no perder campos no enviados.
    specialtyData: z.record(z.any()).optional(),
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

  // NOM-024: notas SIGNED son inalterables. Bloquear ANTES de owner check
  // para evitar leak de existencia. Una nota firmada no debe poder modificarse
  // por nadie (ni el doctor dueño, ni admin) — el equivalente PATCH del bloqueo
  // que el handler DELETE ya implementa.
  const currentStatus = ((existing.specialtyData ?? {}) as Record<string, unknown>).status;
  if (currentStatus === "SIGNED") {
    return NextResponse.json(
      { error: "Las notas firmadas no se pueden editar (NOM-024 inalterable)" },
      { status: 400 },
    );
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

  // Merge specialtyData: si viene specialtyData en el patch, hacer merge
  // shallow con el existente para preservar status/signedAt/attachments.
  // Si tambien viene status, ese tiene prioridad.
  const currentSpec = (existing.specialtyData ?? {}) as Record<string, unknown>;
  let nextSpec: Record<string, unknown> | undefined;
  if (parsed.data.specialtyData !== undefined) {
    // SECURITY: strippear status/signedAt del payload para que solo el flujo
    // controlado de parsed.data.status pueda mutar esos campos. Sin esto,
    // un atacante con cookie valida puede forjar firmas retroactivas via
    // specialtyData.{status,signedAt}.
    const { status: _s, signedAt: _sa, ...safeSpec } =
      parsed.data.specialtyData as Record<string, unknown>;
    nextSpec = { ...currentSpec, ...safeSpec };
  }
  if (parsed.data.status !== undefined) {
    nextSpec = {
      ...(nextSpec ?? currentSpec),
      status: parsed.data.status,
      ...(parsed.data.status === "SIGNED" ? { signedAt: new Date().toISOString() } : {}),
    };
  }
  if (nextSpec) {
    data.specialtyData = nextSpec;
  }

  // Capturamos before-state completo (los campos que pueden cambiar) para
  // diff confiable. La query existing arriba no incluye SOAP fields.
  const beforeState = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: dbUser.clinicId },
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

/**
 * DELETE /api/clinical-notes/[id]
 * Borra una nota SOAP. Solo notas DRAFT — SIGNED es inalterable por NOM-024.
 * Sólo el doctor dueño o admins. Multi-tenant por clinicId.
 * Cascada: diagnósticos CIE-10 (MedicalRecordDiagnosis) por FK; prescriptions
 * quedan con medicalRecordId=NULL (SetNull configurado en PR #32).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!hasPermission(dbUser.role, "medicalRecord.delete")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: dbUser.clinicId },
    select: { id: true, doctorId: true, patientId: true, specialtyData: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const status = ((existing.specialtyData ?? {}) as Record<string, unknown>).status;
  if (status === "SIGNED") {
    return NextResponse.json(
      { error: "Las notas firmadas no se pueden eliminar (NOM-024)" },
      { status: 400 },
    );
  }

  const isOwner = existing.doctorId === dbUser.id;
  const isAdmin = dbUser.role === "ADMIN" || dbUser.role === "SUPER_ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.medicalRecord.delete({ where: { id: params.id } });

  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "record",
    entityId: params.id,
    action: "delete",
    before: { patientId: existing.patientId, doctorId: existing.doctorId, status },
  });

  revalidateAfter("clinicalNotes");
  return NextResponse.json({ success: true });
}
