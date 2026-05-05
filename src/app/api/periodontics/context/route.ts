// Periodontics — endpoint de contexto para integraciones (modal de cita,
// SOAP pre-fill, badge perio en odontograma, banner de mantenimiento vencido).
// SPEC §10.

import { NextResponse, type NextRequest } from "next/server";
import { differenceInDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { suggestPerioAppointmentDuration } from "@/lib/helpers/perioAppointmentDurations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patientId = req.nextUrl.searchParams.get("patientId");
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  if (!patientId) {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }

  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ perio: false });
  }
  const access = await canAccessModule(ctx.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ perio: false });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ perio: false });

  const [latestRecord, plan, lastRisk] = await Promise.all([
    prisma.periodontalRecord.findFirst({
      where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { classification: true },
    }),
    prisma.periodontalTreatmentPlan.findFirst({
      where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    }),
    prisma.periodontalRiskAssessment.findFirst({
      where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
      orderBy: { evaluatedAt: "desc" },
    }),
  ]);

  const now = new Date();
  const overdueDays =
    plan?.nextEvaluationAt && plan.nextEvaluationAt < now
      ? differenceInDays(now, plan.nextEvaluationAt)
      : null;

  return NextResponse.json({
    perio: true,
    hasRecord: Boolean(latestRecord),
    classification: latestRecord?.classification
      ? {
          stage: latestRecord.classification.stage,
          grade: latestRecord.classification.grade,
          extension: latestRecord.classification.extension,
        }
      : null,
    metrics: latestRecord
      ? {
          bopPct: latestRecord.bopPercentage,
          plaqueIndexOleary: latestRecord.plaqueIndexOleary,
          sites6PlusMm: latestRecord.sites6PlusMm,
        }
      : null,
    plan: plan
      ? {
          currentPhase: plan.currentPhase,
          nextEvaluationAt: plan.nextEvaluationAt?.toISOString() ?? null,
          overdueDays,
        }
      : null,
    risk: lastRisk
      ? {
          category: lastRisk.riskCategory,
          recallMonths: lastRisk.recommendedRecallMonths,
        }
      : null,
    appointmentDuration: suggestPerioAppointmentDuration(reason),
  });
}
