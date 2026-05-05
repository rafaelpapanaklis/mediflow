// Endodontics — endpoint de contexto para integraciones (modal de cita,
// SOAP pre-fill, banner de TC activo). Spec §10.1, §10.2

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ENDODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { suggestEndoAppointmentDuration } from "@/lib/helpers/endoAppointmentDurations";

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
    return NextResponse.json({ endo: false });
  }
  const access = await canAccessModule(ctx.clinicId, ENDODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ endo: false });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ endo: false });

  const activeTreatment = await prisma.endodonticTreatment.findFirst({
    where: {
      clinicId: ctx.clinicId,
      patientId,
      outcomeStatus: "EN_CURSO",
      deletedAt: null,
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      toothFdi: true,
      treatmentType: true,
      isMultiSession: true,
      currentStep: true,
      startedAt: true,
    },
  });

  const pendingFollowUp = await prisma.endodonticFollowUp.findFirst({
    where: {
      treatment: { clinicId: ctx.clinicId, patientId, deletedAt: null },
      performedAt: null,
      deletedAt: null,
      scheduledAt: { lte: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) },
    },
    orderBy: { scheduledAt: "asc" },
    include: { treatment: { select: { toothFdi: true } } },
  });

  const suggestedDuration = reason ? suggestEndoAppointmentDuration(reason) : null;

  return NextResponse.json({
    endo: true,
    activeTreatment: activeTreatment
      ? {
          id: activeTreatment.id,
          toothFdi: activeTreatment.toothFdi,
          treatmentType: activeTreatment.treatmentType,
          isMultiSession: activeTreatment.isMultiSession,
          currentStep: activeTreatment.currentStep,
          startedAt: activeTreatment.startedAt.toISOString(),
        }
      : null,
    pendingFollowUp: pendingFollowUp
      ? {
          id: pendingFollowUp.id,
          toothFdi: pendingFollowUp.treatment.toothFdi,
          milestone: pendingFollowUp.milestone,
          scheduledAt: pendingFollowUp.scheduledAt.toISOString(),
        }
      : null,
    suggestedDurationMin: suggestedDuration,
  });
}
