// Orthodontics — endpoint de contexto para integraciones (modal de cita,
// SOAP pre-fill, badge en odontograma). SPEC §8.10.

import { NextResponse, type NextRequest } from "next/server";
import { differenceInMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { suggestOrthoAppointmentDuration } from "@/lib/orthodontics/appointment-durations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patientId = req.nextUrl.searchParams.get("patientId");
  const reason = req.nextUrl.searchParams.get("reason") ?? "";

  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ orthodontics: false });
  }
  const access = await canAccessModule(ctx.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ orthodontics: false });
  }

  // Sin patientId, devolvemos solo flag + suggestion de duración.
  if (!patientId) {
    return NextResponse.json({
      orthodontics: true,
      moduleActive: true,
      appointmentDuration: suggestOrthoAppointmentDuration(reason),
    });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({
      orthodontics: true,
      moduleActive: true,
      hasActivePlan: false,
      appointmentDuration: suggestOrthoAppointmentDuration(reason),
    });
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      patientId,
      clinicId: ctx.clinicId,
      deletedAt: null,
      status: { in: ["IN_PROGRESS", "RETENTION", "ON_HOLD"] },
    },
    include: {
      phases: {
        where: { status: "IN_PROGRESS" },
        select: { phaseKey: true },
      },
      paymentPlan: { select: { status: true } },
    },
  });

  return NextResponse.json({
    orthodontics: true,
    moduleActive: true,
    hasActivePlan: Boolean(plan),
    technique: plan?.technique ?? null,
    currentPhase: plan?.phases[0]?.phaseKey ?? null,
    monthInTreatment: plan?.installedAt
      ? Math.max(0, differenceInMonths(new Date(), plan.installedAt))
      : null,
    paymentStatus: plan?.paymentPlan?.status ?? null,
    appointmentDuration: suggestOrthoAppointmentDuration(reason),
  });
}
