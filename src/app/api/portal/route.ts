import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// POST /api/portal — generate portal token for a patient (called by doctor)
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { patientId } = await req.json();

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Generate secure token
  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await prisma.patient.update({
    where: { id: patientId },
    data: { portalToken: token, portalTokenExpiry: expiry },
  });

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${token}`;
  return NextResponse.json({ portalUrl, token, expiresAt: expiry });
}
