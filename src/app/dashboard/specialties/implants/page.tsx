// Implants — panel agregado del módulo. Spec §6.17.
// Sección primaria: 4 KPIs spec + filtros + tabla + modal nuevo plan.
// Sección secundaria: widgets de overdue follow-ups y complicaciones activas.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import { loadImplantPatients } from "@/lib/implants/load-patients";
import { ImplantsSpecialtyClient } from "@/components/specialties/implants/ImplantsSpecialtyClient";
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

  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, IMPLANTS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${IMPLANTS_MODULE_KEY}`);
  }

  const now = new Date();

  const [aggregate, overdueRaw, complicationsRaw] = await Promise.all([
    loadImplantPatients(user.clinicId),
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
  ]);

  const overdueRows: OverdueFollowUpRow[] = overdueRaw.map((f) => ({
    followUpId: f.id,
    implantId: f.implantId,
    patientId: f.implant.patient.id,
    patientName: `${f.implant.patient.firstName} ${f.implant.patient.lastName}`,
    toothFdi: f.implant.toothFdi,
    milestone: f.milestone,
    scheduledAt: f.scheduledAt!,
    daysOverdue: Math.max(0, Math.floor((now.getTime() - f.scheduledAt!.getTime()) / 86_400_000)),
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

  const rowsSerializable = aggregate.rows.map((r) => ({
    ...r,
    placedAt: r.placedAt.toISOString(),
    nextControlAt: r.nextControlAt ? r.nextControlAt.toISOString() : null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <ImplantsSpecialtyClient
        rows={rowsSerializable}
        kpis={aggregate.kpis}
        doctors={aggregate.doctors}
      />

      <section
        style={{
          padding: "0 16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          borderTop: "1px solid var(--border)",
          paddingTop: 20,
        }}
      >
        <header>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "var(--text-3)",
              margin: 0,
            }}
          >
            Pendientes operativos
          </p>
          <h2 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
            Controles vencidos y complicaciones
          </h2>
        </header>

        <OverdueFollowUpsWidget rows={overdueRows} />
        <ActiveComplicationsWidget rows={complicationRows} />
      </section>
    </div>
  );
}
