import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { packageId, patientId } = body;

  if (!packageId || !patientId) {
    return NextResponse.json({ error: "packageId and patientId are required" }, { status: 400 });
  }

  // Validate package belongs to clinic
  const pkg = await prisma.servicePackage.findFirst({
    where: { id: packageId, clinicId: ctx.clinicId },
  });
  if (!pkg) return NextResponse.json({ error: "Package not found in this clinic" }, { status: 404 });

  // Validate patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + pkg.validDays);

  const redemption = await prisma.packageRedemption.create({
    data: {
      packageId,
      patientId,
      clinicId: ctx.clinicId,
      expiresAt,
      totalSessions: pkg.totalSessions,
    },
  });

  return NextResponse.json(redemption, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { redeemId } = body;

  if (!redeemId) {
    return NextResponse.json({ error: "redeemId is required" }, { status: 400 });
  }

  const redemption = await prisma.packageRedemption.findFirst({
    where: { id: redeemId, clinicId: ctx.clinicId },
  });
  if (!redemption) return NextResponse.json({ error: "Redemption not found" }, { status: 404 });

  if (redemption.status !== "ACTIVE") {
    return NextResponse.json({ error: "Redemption is not active" }, { status: 400 });
  }

  const newSessionsUsed = redemption.sessionsUsed + 1;
  const newStatus = newSessionsUsed >= redemption.totalSessions ? "COMPLETED" : "ACTIVE";

  const updated = await prisma.packageRedemption.update({
    where: { id: redeemId },
    data: {
      sessionsUsed: newSessionsUsed,
      status: newStatus,
    },
  });

  return NextResponse.json(updated);
}
