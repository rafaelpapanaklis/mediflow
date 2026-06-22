import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const clinic = await prisma.clinic.update({
    where: { id: params.id },
    data: {
      ...(body.plan        ? { plan: body.plan as any } : {}),
      ...(body.trialEndsAt ? { trialEndsAt: new Date(body.trialEndsAt) } : {}),
      ...(body.name        ? { name: body.name } : {}),
    },
  });
  return NextResponse.json(clinic);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = params.id;

  // Guard: no archivar la única clínica activa del sistema (útil en QA/testing).
  const totalClinics = await prisma.clinic.count({ where: { archivedAt: null } });
  if (totalClinics <= 1) {
    return NextResponse.json(
      { error: "No se puede eliminar la única clínica del sistema" },
      { status: 400 },
    );
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, slug: true, email: true, createdAt: true, archivedAt: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // Ya archivada — idempotente.
  if (clinic.archivedAt) {
    return NextResponse.json({ success: true, clinicId: clinic.id, archived: true });
  }

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

  // NOM-004 / NOM-024 §7 — NO hard-delete: eliminar una clínica JAMÁS debe
  // cascada-destruir el expediente (pacientes, recetas, radiografías, bitácora,
  // blobs de Storage). Se ARCHIVA lógicamente: el expediente y los archivos se
  // CONSERVAN; solo se saca a la clínica de las superficies públicas
  // (isPublic / landingActive). Reactivación manual = poner archivedAt = null.
  const adminIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  try {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        archivedAt:    new Date(),
        archivedBy:    adminIp,
        archiveReason: reason,
        isPublic:      false,
        landingActive: false,
      },
    });
  } catch (err: any) {
    console.error("[admin/clinics DELETE] prisma archive failed:", err?.message ?? "unknown");
    return NextResponse.json(
      { error: "Error al archivar la clínica en la base de datos", detail: err?.message },
      { status: 500 },
    );
  }

  // Audit estructurado a Vercel Logs (la clínica se conserva; dejamos rastro del
  // archivado con identidad disponible — IP del admin — y motivo).
  console.log(JSON.stringify({
    type:            "admin.clinic.archived",
    at:              new Date().toISOString(),
    clinicId:        clinic.id,
    clinicName:      clinic.name,
    clinicSlug:      clinic.slug,
    clinicCreatedAt: clinic.createdAt.toISOString(),
    reason,
    adminIp,
    userAgent:       req.headers.get("user-agent") ?? null,
  }));

  return NextResponse.json({
    success: true,
    clinicId: clinic.id,
    archived: true,
  });
}
