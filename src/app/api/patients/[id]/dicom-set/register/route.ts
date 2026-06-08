import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { signMaybeUrl } from "@/lib/storage";

// Registra como PatientFile un set CBCT (.zip) ya subido a Storage vía la signed
// upload URL. Guarda SOLO el path interno; la signed URL se firma bajo demanda.
//
// POST /api/patients/[id]/dicom-set/register  body: { path, name, size }
//
// SEGURIDAD (magic number): solo recibe el path + tamaño de un .zip ya subido
// directo al bucket; los bytes nunca pasan por el servidor, así que no hay firma
// de contenido que validar aquí. La defensa es el límite de tamaño del bucket en
// Supabase. El path sí se valida (debe pertenecer a esta clínica + paciente).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const path = String(body?.path ?? "");
  const name = String(body?.name ?? "estudio.zip").slice(0, 120);
  const size = Number(body?.size) || null;

  // Seguridad: el path debe pertenecer EXACTAMENTE a esta clínica + paciente
  // (evita registrar un archivo de otra clínica conociendo su path).
  if (path !== "" && !path.startsWith(`${ctx.clinicId}/dicom-sets/${params.id}/`)) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }
  if (!path) return NextResponse.json({ error: "Falta el path" }, { status: 400 });

  const record = await prisma.patientFile.create({
    data: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      uploadedBy: ctx.userId,
      name,
      url: path,
      size,
      mimeType: "application/zip",
      category: "SCAN_STL" as any,
    },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true },
  });

  const signedUrl = await signMaybeUrl(record.url).catch(() => "");
  return NextResponse.json({ ...record, url: signedUrl }, { status: 201 });
}
