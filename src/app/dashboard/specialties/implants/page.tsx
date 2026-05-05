// Implants — página dedicada index del módulo. Spec §6.17.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Anchor } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import {
  OverdueFollowUpsWidget,
  type OverdueFollowUpRow,
} from "@/components/specialties/implants/widgets/OverdueFollowUpsWidget";
import {
  ActiveComplicationsWidget,
  type ActiveComplicationRow,
} from "@/components/specialties/implants/widgets/ActiveComplicationsWidget";

export default async function ImplantsIndexPage() {
  const user = await getCurrentUser();

  if (user.clinic.category !== "DENTAL") {
    redirect("/dashboard");
  }
  const access = await canAccessModule(user.clinicId, IMPLANTS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${IMPLANTS_MODULE_KEY}`);
  }

  const now = new Date();

  const [overdueRaw, complicationsRaw, totalImplants] = await Promise.all([
    prisma.implantFollowUp.findMany({
      where: {
        clinicId: user.clinicId,
        scheduledAt: { not: null, lt: now },
        performedAt: null,
      },
      include: {
        implant: {
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 100,
    }),
    prisma.implantComplication.findMany({
      where: {
        clinicId: user.clinicId,
        resolvedAt: null,
      },
      include: {
        implant: {
          include: {
            patient: { select: { id: true, firstName: true, lastName: true } },
            placedByDoctor: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { detectedAt: "desc" },
      take: 50,
    }),
    prisma.implant.count({
      where: { clinicId: user.clinicId, currentStatus: { not: "REMOVED" } },
    }),
  ]);

  const overdueRows: OverdueFollowUpRow[] = overdueRaw.map((f) => ({
    followUpId: f.id,
    implantId: f.implantId,
    patientId: f.implant.patient.id,
    patientName: `${f.implant.patient.firstName} ${f.implant.patient.lastName}`,
    toothFdi: f.implant.toothFdi,
    milestone: f.milestone,
    scheduledAt: f.scheduledAt!,
    daysOverdue: Math.max(
      0,
      Math.floor((now.getTime() - f.scheduledAt!.getTime()) / 86_400_000),
    ),
    patientPhone: f.implant.patient.phone,
  }));

  const complicationRows: ActiveComplicationRow[] = complicationsRaw.map((c) => ({
    complicationId: c.id,
    implantId: c.implantId,
    patientId: c.implant.patient.id,
    patientName: `${c.implant.patient.firstName} ${c.implant.patient.lastName}`,
    toothFdi: c.implant.toothFdi,
    type: c.type,
    severity: c.severity,
    detectedAt: c.detectedAt,
    daysSinceDetection: Math.max(
      0,
      Math.floor((now.getTime() - c.detectedAt.getTime()) / 86_400_000),
    ),
    doctorName: c.implant.placedByDoctor
      ? `Dr/a. ${c.implant.placedByDoctor.firstName} ${c.implant.placedByDoctor.lastName}`
      : null,
  }));

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <Anchor className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Implantología</h1>
            <p className="text-xs text-gray-500">
              {totalImplants} implantes activos · {overdueRows.length} controles vencidos · {complicationRows.length} complicaciones activas
            </p>
          </div>
        </div>
      </header>

      <OverdueFollowUpsWidget rows={overdueRows} />
      <ActiveComplicationsWidget rows={complicationRows} />

      <p className="text-xs text-gray-500 text-center pt-2">
        Inventario y dashboard de tasa de éxito personal — disponibles en v2.0.
      </p>
    </div>
  );
}
