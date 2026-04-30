// Pediatrics — endpoint que da el contexto pediátrico para el modal de
// nueva cita (sugerir duración, warning Frankl bajo, tutor para notas).
// Spec: §4.B.8

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { calculateAge, isPediatric } from "@/lib/pediatrics/age";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PEDIATRICS_MODULE_KEY, DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, dob: true },
  });
  if (!patient) return NextResponse.json({ pediatric: false });

  if (!isPediatric(patient.dob, DEFAULT_PEDIATRICS_CUTOFF_YEARS)) {
    return NextResponse.json({ pediatric: false });
  }
  if (ctx.clinicCategory !== "DENTAL" && ctx.clinicCategory !== "MEDICINE") {
    return NextResponse.json({ pediatric: false });
  }
  const access = await canAccessModule(ctx.clinicId, PEDIATRICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ pediatric: false });
  }

  const [recentFrankl, guardian] = await Promise.all([
    prisma.behaviorAssessment.findMany({
      where: { patientId, clinicId: ctx.clinicId, scale: "frankl", deletedAt: null },
      orderBy: { recordedAt: "desc" },
      take: 2,
      select: { value: true },
    }),
    prisma.guardian.findFirst({
      where: { patientId, clinicId: ctx.clinicId, deletedAt: null, principal: true },
      select: { fullName: true },
    }),
  ]);

  const recentLow = recentFrankl.length > 0 && recentFrankl.every((b) => b.value <= 2);
  const age = patient.dob ? calculateAge(patient.dob) : null;

  return NextResponse.json({
    pediatric: true,
    ageFormatted: age?.formatted ?? null,
    suggestedDurationMin: 30,
    suggestedDurationMaxMin: 45,
    recentFranklLow: recentLow,
    longerBlockSuggestion: recentLow ? { minMin: 50, maxMin: 60 } : null,
    primaryGuardianName: guardian?.fullName ?? null,
  });
}
