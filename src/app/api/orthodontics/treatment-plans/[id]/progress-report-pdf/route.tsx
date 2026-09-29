// Orthodontics — endpoint PDF "Reporte de progreso T0 vs T2". SPEC §9.3.

import { NextResponse } from "next/server";
import { differenceInMonths } from "date-fns";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getAuthContext } from "@/lib/auth-context";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { puedeVerExpediente } from "@/lib/orthodontics/permiso-expediente";
import { ProgressReportPdf } from "@/lib/orthodontics/pdf-templates/progress-report";
import { PHOTO_VIEW_ORDER, VIEW_TO_COLUMN } from "@/lib/orthodontics/photo-set-helpers";
import { techniqueLabel } from "@/lib/orthodontics/consent-texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  }
  // Revisión cruzada (Ola 1): canAccessModule abría este PDF durante el
  // trial de cualquier clínica dental. Migrado a hasActiveOrthodonticsModule.
  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return NextResponse.json({ error: MENSAJE_SIN_ACCESO_ORTODONCIA }, { status: 403 });
  }
  // ws1-t5 (ronda 6, X5): este PDF lleva fotos clínicas y es parte del
  // expediente. Pide la MISMA llave que los otros tres PDF del caso, que
  // pasan por getOrthoActionContext({ write: false }). Sin esto, recepción o
  // un usuario de solo lectura lo bajaba con solo conocer la dirección.
  if (!puedeVerExpediente(ctx)) {
    return NextResponse.json({ error: "No tienes permiso para ver el expediente de este paciente." }, { status: 403 });
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      diagnosis: { select: { diagnosedById: true } },
      photoSets: {
        where: { setType: { in: ["T0", "T2", "T1", "CONTROL"] } },
        orderBy: { capturedAt: "desc" },
        include: {
          photoFrontal: { select: { id: true } },
          photoProfile: { select: { id: true } },
          photoSmile: { select: { id: true } },
          photoIntraFrontal: { select: { id: true } },
          photoIntraLateralR: { select: { id: true } },
          photoIntraLateralL: { select: { id: true } },
          photoOcclusalUpper: { select: { id: true } },
          photoOcclusalLower: { select: { id: true } },
        },
      },
      consents: { where: { consentType: "PHOTO_USE" }, select: { id: true } },
    },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  }

  // Visibilidad por paciente: no renderizar el reporte de un paciente restringido.
  const denied = await assertPatientVisible(plan.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (denied) return denied;

  const t0 = plan.photoSets.find((s) => s.setType === "T0");
  const after =
    plan.photoSets.find((s) => s.setType === "T2") ??
    plan.photoSets.find((s) => s.setType === "T1") ??
    plan.photoSets.find((s) => s.setType === "CONTROL");
  if (!t0 || !after) {
    return NextResponse.json(
      { error: "Faltan sets fotográficos para el comparativo" },
      { status: 400 },
    );
  }

  const [doctor, clinic] = await Promise.all([
    prisma.user.findUnique({
      where: { id: plan.diagnosis.diagnosedById },
      select: { firstName: true, lastName: true },
    }),
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true },
    }),
  ]);

  const fmt = (d: Date) => d.toLocaleDateString("es-MX");
  const resolveUrl = (fileId: string) => `/api/patient-files/${fileId}`;

  const pairs = PHOTO_VIEW_ORDER.map((view) => {
    const col = VIEW_TO_COLUMN[view] as keyof typeof t0;
    const beforeFile = t0[col] as { id: string } | null | undefined;
    const afterFile = after[col] as { id: string } | null | undefined;
    return {
      view,
      beforeUrl: beforeFile?.id ? resolveUrl(beforeFile.id) : null,
      afterUrl: afterFile?.id ? resolveUrl(afterFile.id) : null,
    };
  });

  const durationMonths = plan.installedAt
    ? Math.max(0, differenceInMonths(new Date(), plan.installedAt))
    : plan.estimatedDurationMonths;

  const buffer = await renderToBuffer(
    <ProgressReportPdf
      data={{
        patientName: `${plan.patient.firstName} ${plan.patient.lastName}`.trim(),
        doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}` : "—",
        clinicName: clinic?.name ?? "Clínica",
        durationMonthsActual: durationMonths,
        techniqueLabel: techniqueLabel(plan.technique),
        retentionPlanText: plan.retentionPlanText,
        beforeLabel: `${t0.setType} · ${fmt(t0.capturedAt)}`,
        afterLabel: `${after.setType} · ${fmt(after.capturedAt)}`,
        pairs,
        hasPhotoUseConsent: plan.consents.length > 0,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="progress-report-${params.id}.pdf"`,
    },
  });
}
