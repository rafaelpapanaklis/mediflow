// Implants — endpoint de contexto para integraciones (modal de cita,
// SOAP pre-fill, banner de implante activo). Patrón equivalente a
// /api/endodontics/context. Spec §8.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import { suggestImplantAppointmentDuration } from "@/lib/implants/appointment-types";
import { buildImplantSoapPrefill } from "@/lib/implants/soap-prefill";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const patientId = req.nextUrl.searchParams.get("patientId");
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  if (!patientId) {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }

  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ implants: false });
  }
  const access = await canAccessModule(ctx.clinicId, IMPLANTS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ implants: false });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ implants: false });
  }

  const now = new Date();
  const [activeImplants, overdueFollowUp, activeComplication] = await Promise.all([
    prisma.implant.findMany({
      where: {
        clinicId: ctx.clinicId,
        patientId,
        currentStatus: { not: "REMOVED" },
      },
      select: {
        id: true,
        toothFdi: true,
        brand: true,
        modelName: true,
        currentStatus: true,
        placedAt: true,
        healingPhase: { select: { isqLatest: true } },
        followUps: {
          where: { performedAt: { not: null } },
          orderBy: { performedAt: "desc" },
          take: 1,
          select: {
            pdMaxMm: true,
            radiographicBoneLossMm: true,
            meetsAlbrektssonCriteria: true,
          },
        },
      },
      orderBy: { placedAt: "desc" },
      take: 20,
    }),
    prisma.implantFollowUp.findFirst({
      where: {
        clinicId: ctx.clinicId,
        implant: { patientId },
        scheduledAt: { not: null, lt: now },
        performedAt: null,
      },
      orderBy: { scheduledAt: "asc" },
      include: { implant: { select: { toothFdi: true } } },
    }),
    prisma.implantComplication.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId,
        resolvedAt: null,
      },
      orderBy: { detectedAt: "desc" },
      include: { implant: { select: { toothFdi: true } } },
    }),
  ]);

  const suggestedDuration = reason ? suggestImplantAppointmentDuration(reason) : null;

  const soapPrefill = buildImplantSoapPrefill({
    implants: activeImplants.map((i) => ({
      toothFdi: i.toothFdi,
      brand: i.brand,
      modelName: i.modelName,
      currentStatus: i.currentStatus,
      isqLatest: i.healingPhase?.isqLatest ?? null,
      pdMaxLastFollowUp: i.followUps[0]?.pdMaxMm ? Number(i.followUps[0].pdMaxMm) : null,
      boneLossAccumulatedMm: i.followUps[0]?.radiographicBoneLossMm
        ? Number(i.followUps[0].radiographicBoneLossMm)
        : null,
      meetsAlbrektsson: i.followUps[0]?.meetsAlbrektssonCriteria ?? null,
    })),
  });

  return NextResponse.json({
    implants: true,
    activeImplants: activeImplants.map((i) => ({
      id: i.id,
      toothFdi: i.toothFdi,
      brand: i.brand,
      modelName: i.modelName,
      currentStatus: i.currentStatus,
      placedAt: i.placedAt.toISOString(),
    })),
    overdueFollowUp: overdueFollowUp
      ? {
          id: overdueFollowUp.id,
          toothFdi: overdueFollowUp.implant.toothFdi,
          milestone: overdueFollowUp.milestone,
          scheduledAt: overdueFollowUp.scheduledAt!.toISOString(),
        }
      : null,
    activeComplication: activeComplication
      ? {
          id: activeComplication.id,
          toothFdi: activeComplication.implant.toothFdi,
          type: activeComplication.type,
          severity: activeComplication.severity,
          detectedAt: activeComplication.detectedAt.toISOString(),
        }
      : null,
    suggestedDurationMin: suggestedDuration,
    soapPrefill,
  });
}
