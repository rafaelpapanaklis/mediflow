import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
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

  // Visibilidad: solo quien PUEDE ver al paciente acuña su enlace de portal. Sin
  // esto, un usuario excluido acuñaba un token de 30 días para CUALQUIER paciente
  // de la clínica y abría /portal/[token] (identidad + expediente, sin sesión) =
  // escalada. 404 idéntico a "no encontrado" — no revelar existencia.
  const denied = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (denied) return denied;

  // No pisar un token vigente: reacuñar rompería el enlace que el paciente ya
  // tiene. Reutilizamos el existente si no venció; si no, acuñamos uno nuevo.
  const now = Date.now();
  const hasValidToken =
    !!patient.portalToken &&
    !!patient.portalTokenExpiry &&
    patient.portalTokenExpiry.getTime() > now;

  let token: string;
  let expiry: Date;
  if (hasValidToken) {
    token = patient.portalToken!;
    expiry = patient.portalTokenExpiry!;
  } else {
    token = crypto.randomBytes(32).toString("hex");
    expiry = new Date(now + 30 * 24 * 60 * 60 * 1000); // 30 days
    await prisma.patient.update({
      where: { id: patientId },
      data: { portalToken: token, portalTokenExpiry: expiry },
    });
  }

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${token}`;
  return NextResponse.json({ portalUrl, token, expiresAt: expiry });
}
