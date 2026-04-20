import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = params.id;

  // Guard: no permitir eliminar la única clínica del sistema (útil en QA/testing).
  const totalClinics = await prisma.clinic.count();
  if (totalClinics <= 1) {
    return NextResponse.json(
      { error: "No se puede eliminar la única clínica del sistema" },
      { status: 400 },
    );
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, slug: true, email: true, createdAt: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // 1. Listar archivos de esa clínica desde la tabla PatientFile (y landingGallery / logoUrl / etc.)
  // Usar la DB como fuente de verdad — solo borramos lo que conocemos.
  const patientFiles = await prisma.patientFile.findMany({
    where: { clinicId },
    select: { url: true },
  });

  const storagePaths = patientFiles
    .map(f => {
      try {
        const urlPath = new URL(f.url).pathname;
        return urlPath.split("/patient-files/").pop()?.split("?")[0] ?? "";
      } catch { return ""; }
    })
    .filter(Boolean);

  // 2. Borrar archivos de Supabase Storage ANTES de la DB, en lotes de 100.
  //    Si falla la DB después, queda algún archivo huérfano, pero preferible
  //    a tener records de DB sin archivos (UX rota).
  let storageDeleted = 0;
  let storageErrors  = 0;
  if (storagePaths.length > 0 && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
    for (let i = 0; i < storagePaths.length; i += 100) {
      const batch = storagePaths.slice(i, i + 100);
      const { error } = await supabase.storage.from("patient-files").remove(batch);
      if (error) {
        storageErrors += batch.length;
        console.error("[admin/clinics DELETE] storage batch failed:", error);
      } else {
        storageDeleted += batch.length;
      }
    }
  }

  // 3. Borrar la clínica — onDelete: Cascade en Prisma se encarga del resto
  //    (patients, appointments, records, invoices, users, files, audit_logs...).
  //    Algunos modelos no cascadeen (no aplica aquí — todos los que referencian
  //    Clinic usan onDelete: Cascade en el schema).
  try {
    await prisma.clinic.delete({ where: { id: clinicId } });
  } catch (err: any) {
    console.error("[admin/clinics DELETE] prisma delete failed:", err);
    return NextResponse.json(
      { error: "Error al eliminar la clínica de la base de datos", detail: err?.message },
      { status: 500 },
    );
  }

  // 4. Audit log — como la clínica ya no existe, no podemos usar AuditLog
  //    (cascade lo habría borrado de todos modos). Loggeamos estructurado
  //    al console para que quede en Vercel Logs y se pueda auditar desde ahí.
  console.log(JSON.stringify({
    type:           "admin.clinic.deleted",
    at:             new Date().toISOString(),
    clinicId:       clinic.id,
    clinicName:     clinic.name,
    clinicSlug:     clinic.slug,
    clinicCreatedAt: clinic.createdAt.toISOString(),
    storageFilesDeleted: storageDeleted,
    storageErrors,
    adminIp:        req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
    userAgent:      req.headers.get("user-agent") ?? null,
  }));

  return NextResponse.json({
    success: true,
    clinicId: clinic.id,
    storageDeleted,
    storageErrors,
  });
}
