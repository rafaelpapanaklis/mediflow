import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

function buildVerifyUrl(req: NextRequest, id: string) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host  = req.headers.get("host") ?? "mediflow.app";
  return `${proto}://${host}/portal/prescription/${id}/verify`;
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });

  const list = await prisma.prescription.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { issuedAt: "desc" },
  });
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { medicalRecordId, patientId, medications, indications, cofeprisGroup, cofeprisFolio, expiresAt } = body;

  if (!medicalRecordId || !patientId || !Array.isArray(medications) || medications.length === 0) {
    return NextResponse.json({ error: "medicalRecordId, patientId y medications son requeridos" }, { status: 400 });
  }

  const record = await prisma.medicalRecord.findFirst({
    where: { id: medicalRecordId, clinicId: ctx.clinicId, patientId },
  });
  if (!record) return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });

  const qrCode = randomBytes(16).toString("hex");

  const created = await prisma.prescription.create({
    data: {
      medicalRecordId,
      patientId,
      doctorId: ctx.userId,
      clinicId: ctx.clinicId,
      medications,
      indications: indications ?? null,
      qrCode,
      verifyUrl: "",
      cofeprisGroup: cofeprisGroup ?? null,
      cofeprisFolio: cofeprisFolio ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  const verifyUrl = buildVerifyUrl(req, created.id);
  const updated = await prisma.prescription.update({
    where: { id: created.id },
    data: { verifyUrl },
  });

  revalidatePath("/dashboard/clinical");
  return NextResponse.json(updated, { status: 201 });
}
