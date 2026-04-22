import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json(photos);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientId, category, angle, url, sessionId, notes } = body;

  if (!patientId || !category || !angle || !url) {
    return NextResponse.json({ error: "patientId, category, angle, and url are required" }, { status: 400 });
  }

  // Validar que la URL sea HTTPS y apunte al dominio de Supabase Storage de la clínica
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return NextResponse.json({ error: "URL debe usar https" }, { status: 400 });
    }
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
    if (supabaseHost && parsed.host !== supabaseHost) {
      return NextResponse.json({ error: "URL no permitida" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
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
      url,
      sessionId: sessionId ?? null,
      notes: notes ?? null,
    },
  });

  return NextResponse.json(photo, { status: 201 });
}
