import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });
  const records = await prisma.periodontalRecord.findMany({
    where: { patientId, clinicId: ctx.clinicId },
    orderBy: { recordedAt: "desc" },
    take: 10,
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { patientId, measurements, notes, bleedingIndex, plaquIndex } = await req.json();
  if (!patientId || !measurements) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const record = await prisma.periodontalRecord.create({
    data: { patientId, clinicId: ctx.clinicId, doctorId: ctx.userId, measurements, notes, bleedingIndex, plaquIndex },
  });
  return NextResponse.json(record, { status: 201 });
}
