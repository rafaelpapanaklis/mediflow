// Endodontics — panel agregado del módulo. Spec §6, §11.4, §11.5.
// Sección primaria: 4 KPIs spec + filtros + tabla + modal nuevo TC.
// Sección secundaria: SuccessRateChart + PendingFollowUpsList + PendingRestorationList.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ENDODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import {
  PendingFollowUpsList,
  type PendingFollowUpRow,
} from "@/components/specialties/endodontics/PendingFollowUpsList";
import {
  PendingRestorationList,
  type PendingRestorationRow,
} from "@/components/specialties/endodontics/PendingRestorationList";
import { SuccessRateChart } from "@/components/specialties/endodontics/SuccessRateChart";
import {
  breakdownByToothCategory,
  computeSuccessKpis,
} from "@/lib/helpers/successRateCalculator";
import { loadEndodonticPatients } from "@/lib/endodontics/load-patients";
import { EndodonticsSpecialtyClient } from "@/components/specialties/endodontics/EndodonticsSpecialtyClient";

export default async function EndodonticsIndexPage() {
  const user = await getCurrentUser();

  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, ENDODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ENDODONTICS_MODULE_KEY}`);
  }

  const now = new Date();

  const [aggregate, completedNoRestoration, allTreatments, allFollowUps] = await Promise.all([
    loadEndodonticPatients(user.clinicId),
    prisma.endodonticTreatment.findMany({
      where: {
        clinicId: user.clinicId,
        completedAt: { not: null, lt: now },
        postOpRestorationCompletedAt: null,
        deletedAt: null,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { completedAt: "asc" },
      take: 30,
    }),
    prisma.endodonticTreatment.findMany({
      where: { clinicId: user.clinicId, deletedAt: null },
      take: 200,
    }),
    prisma.endodonticFollowUp.findMany({
      where: {
        treatment: { clinicId: user.clinicId, deletedAt: null },
        deletedAt: null,
      },
      include: {
        treatment: {
          include: {
            patient: { select: { id: true, firstName: true, lastName: true } },
            doctor: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 200,
    }),
  ]);

  const pendingFollowUps: PendingFollowUpRow[] = allFollowUps
    .filter((f) => f.performedAt === null)
    .map((f) => ({
      id: f.id,
      patientId: f.treatment.patient.id,
      patientName: `${f.treatment.patient.firstName} ${f.treatment.patient.lastName}`,
      toothFdi: f.treatment.toothFdi,
      milestone: f.milestone,
      scheduledAt: f.scheduledAt,
      doctorName: f.treatment.doctor
        ? `Dr/a. ${f.treatment.doctor.firstName} ${f.treatment.doctor.lastName}`
        : null,
      daysOverdue: Math.max(
        0,
        Math.floor((now.getTime() - f.scheduledAt.getTime()) / 86_400_000),
      ),
    }));

  const pendingRestorations: PendingRestorationRow[] = completedNoRestoration.map((t) => ({
    treatmentId: t.id,
    patientId: t.patient.id,
    patientName: `${t.patient.firstName} ${t.patient.lastName}`,
    toothFdi: t.toothFdi,
    completedAt: t.completedAt!,
    daysSinceCompletion: Math.max(
      0,
      Math.floor((now.getTime() - t.completedAt!.getTime()) / 86_400_000),
    ),
    postOpRestorationPlan: t.postOpRestorationPlan,
  }));

  const successKpis = computeSuccessKpis({ treatments: allTreatments, followUps: allFollowUps });
  const breakdown = breakdownByToothCategory({ treatments: allTreatments, followUps: allFollowUps });

  const rowsSerializable = aggregate.rows.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    nextFollowUpAt: r.nextFollowUpAt ? r.nextFollowUpAt.toISOString() : null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <EndodonticsSpecialtyClient
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
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-3)", margin: 0 }}>
            Métricas clínicas
          </p>
          <h2 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
            Tasa de éxito y pendientes
          </h2>
        </header>

        <section className="endo-section endo-kpis">
          <Kpi label="Tratamientos totales" value={successKpis.totalTreatments} suffix="" />
          <Kpi label="% éxito 12m" value={successKpis.successRate12m} suffix="%" tone="success" />
          <Kpi label="% éxito 24m" value={successKpis.successRate24m} suffix="%" tone="info" />
          <Kpi label="% retratamientos" value={successKpis.retreatmentRate} suffix="%" tone="warning" />
          <Kpi label="Adherencia controles" value={successKpis.followUpAdherence} suffix="%" />
        </section>

        <SuccessRateChart data={breakdown} />

        <PendingFollowUpsList rows={pendingFollowUps} />
        <PendingRestorationList rows={pendingRestorations} />
      </section>
    </div>
  );
}

function Kpi(props: {
  label: string;
  value: number;
  suffix: string;
  tone?: "success" | "info" | "warning";
}) {
  return (
    <div className={`endo-kpi endo-kpi--${props.tone ?? "neutral"}`}>
      <div className="endo-kpi__label">{props.label}</div>
      <div className="endo-kpi__value">
        {props.value}
        <span className="endo-kpi__suffix">{props.suffix}</span>
      </div>
    </div>
  );
}
