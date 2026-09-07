import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { BUCKETS, extractStoragePath, signMaybeUrl, signMaybeUrls } from "@/lib/storage";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  // Visibilidad por paciente: sin este gate se leían las fotos de un paciente
  // restringido con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const photos = await prisma.beforeAfterPhoto.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { takenAt: "desc" },
  });

  // Firma cada URL on-demand (TTL 5 min). Tolera tanto paths nuevos como
  // URLs legacy guardadas antes de la migración a bucket privado.
  // Firma todas las URLs en UN round-trip (createSignedUrls) en vez de N×.
  const urls = await signMaybeUrls(photos.map((p) => p.url));
  const signed = photos.map((p, i) => ({ ...p, url: urls[i] }));

  return NextResponse.json(signed);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: subir una foto de antes/después es SUBIR UN ARCHIVO del
  // paciente, que es literalmente lo que cubre "xrays.upload" — el catálogo lo
  // dice en su propia nota ("POST /api/xrays es también la subida genérica de
  // archivos del paciente: fotos, PDFs, adjuntos de la nota"), y es la key que
  // recepción tiene por default porque es quien toma la foto en la ficha.
  //
  // La asimetría con su hermana DELETE —que exige "medicalRecord.edit"— es
  // deliberada y ya existe igual en radiografías: POST /api/xrays pide
  // "xrays.upload" y DELETE/PATCH de /api/xrays/[id] piden "medicalRecord.edit".
  // Añadir evidencia clínica no es destruirla. Lo que esta línea cierra es la
  // escritura de un READONLY, que es el hallazgo.
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.upload");
  if (deniedPerm) return deniedPerm;

  const body = await req.json();
  const { patientId, category, angle, url, sessionId, notes } = body;

  if (!patientId || !category || !angle || !url) {
    return NextResponse.json({ error: "patientId, category, angle, and url are required" }, { status: 400 });
  }

  // Aceptamos tanto un path interno como una URL de Supabase Storage del
  // bucket privado. Cualquier otra cosa se rechaza para que no entren URLs
  // arbitrarias en la tabla.
  let storedPath: string | null = null;
  if (!url.startsWith("http")) {
    storedPath = url;
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return NextResponse.json({ error: "URL debe usar https" }, { status: 400 });
      }
      const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
      if (supabaseHost && parsed.host !== supabaseHost) {
        return NextResponse.json({ error: "URL no permitida" }, { status: 400 });
      }
      storedPath = extractStoragePath(url, BUCKETS.PATIENT_FILES);
      if (!storedPath) {
        return NextResponse.json({ error: "URL no pertenece al bucket de archivos" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL inválida" }, { status: 400 });
    }
  }

  // Verify patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  // Visibilidad por paciente: no crear fotos sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const photo = await prisma.beforeAfterPhoto.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      category,
      angle,
      url: storedPath,
      sessionId: sessionId ?? null,
      notes: notes ?? null,
    },
  });

  // Devolvemos URL ya firmada al cliente para render inmediato.
  const signedUrl = await signMaybeUrl(storedPath).catch(() => "");
  return NextResponse.json({ ...photo, url: signedUrl }, { status: 201 });
}
