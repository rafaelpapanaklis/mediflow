import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { BUCKETS, extractStoragePath, signMaybeUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  const photos = await prisma.beforeAfterPhoto.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { takenAt: "desc" },
  });

  // Firma cada URL on-demand (TTL 5 min). Tolera tanto paths nuevos como
  // URLs legacy guardadas antes de la migración a bucket privado.
  const signed = await Promise.all(
    photos.map(async (p) => ({
      ...p,
      url: await signMaybeUrl(p.url).catch(() => ""),
    })),
  );

  return NextResponse.json(signed);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
