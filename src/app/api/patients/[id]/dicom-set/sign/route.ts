import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { assertPatientVisible } from "@/lib/patient-visibility";

// Subida DIRECTA a Storage de un set CBCT (.zip de cortes DICOM). Como los CBCT
// pesan cientos de MB, no pasan por el route handler (límite de body): el cliente
// pide aquí una signed upload URL y sube el .zip directo al bucket.
//
// POST /api/patients/[id]/dicom-set/sign  body: { name }
// → { path, token }   (el cliente: supabase.storage.from(...).uploadToSignedUrl(path, token, file))
//
// SEGURIDAD (magic number): el .zip viaja del cliente DIRECTO al bucket y nunca
// pasa por el servidor, así que aquí NO se puede validar la firma del contenido
// (no tenemos los bytes). La defensa contra un archivo enorme o disfrazado es el
// LÍMITE DE TAMAÑO del bucket en Supabase Storage. No se bloquea aquí a propósito.

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Visibilidad por paciente: 404 si el viewer no puede ver este paciente.
  const denied = await assertPatientVisible(params.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  // Multi-tenant: el paciente debe ser de la clínica de la sesión.
  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "estudio.zip");
  if (!/\.zip$/i.test(name)) {
    return NextResponse.json({ error: "El set debe subirse como un .zip" }, { status: 400 });
  }

  const path = `${ctx.clinicId}/dicom-sets/${params.id}/${randomUUID()}.zip`;
  const supabase = getAdminSupabase();
  const { data, error } = await supabase.storage
    .from("patient-files")
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[dicom-set/sign] createSignedUploadUrl:", error);
    return NextResponse.json(
      { error: "No se pudo preparar la subida (¿el bucket permite archivos grandes?)" },
      { status: 500 },
    );
  }

  return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
}
