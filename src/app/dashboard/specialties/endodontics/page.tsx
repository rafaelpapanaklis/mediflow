// Endodontics — página index del módulo. Spec §6, §11.4, §11.5

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ENDODONTICS_MODULE_KEY } from "@/app/actions/endodontics";
import { PendingFollowUpsList, type PendingFollowUpRow } from "@/components/specialties/endodontics/PendingFollowUpsList";
import { PendingRestorationList, type PendingRestorationRow } from "@/components/specialties/endodontics/PendingRestorationList";
import { SuccessRateChart } from "@/components/specialties/endodontics/SuccessRateChart";
import {
  breakdownByToothCategory,
  computeSuccessKpis,
} from "@/lib/helpers/successRateCalculator";

export default async function EndodonticsIndexPage() {
  const user = await getCurrentUser();

  if (user.clinic.category !== "DENTAL") {
    redirect("/dashboard");
  }
  const access = await canAccessModule(user.clinicId, ENDODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ENDODONTICS_MODULE_KEY}`);
  }

  const now = new Date();

  // Tratamientos activos (en curso) + completados sin restauración + tratamientos completados con controles pendientes.
  const [activeTreatments, completedNoRestoration, allTreatments, allFollowUps] = await Promise.all([
    prisma.endodonticTreatment.findMany({
      where: {
        clinicId: user.clinicId,
        outcomeStatus: "EN_CURSO",
        deletedAt: null,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
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
      doctorName: f.treatment.doctor ? `Dr/a. ${f.treatment.doctor.firstName} ${f.treatment.doctor.lastName}` : null,
      daysOverdue: Math.max(0, Math.floor((now.getTime() - f.scheduledAt.getTime()) / 86_400_000)),
    }));

  const pendingRestorations: PendingRestorationRow[] = completedNoRestoration.map((t) => ({
    treatmentId: t.id,
    patientId: t.patient.id,
    patientName: `${t.patient.firstName} ${t.patient.lastName}`,
    toothFdi: t.toothFdi,
    completedAt: t.completedAt!,
    daysSinceCompletion: Math.max(0, Math.floor((now.getTime() - t.completedAt!.getTime()) / 86_400_000)),
    postOpRestorationPlan: t.postOpRestorationPlan,
  }));

  const kpis = computeSuccessKpis({ treatments: allTreatments, followUps: allFollowUps });
  const breakdown = breakdownByToothCategory({ treatments: allTreatments, followUps: allFollowUps });

  return (
    <div className="endo-index">
      <header className="endo-index__header">
        <div>
          <h1 className="ped-list__title">Endodoncia</h1>
          <p className="ped-list__subtitle">
            Tratamientos activos, controles pendientes y tasa de éxito personal del doctor.
          </p>
        </div>
      </header>

      <section className="endo-section endo-kpis">
        <Kpi label="Tratamientos totales" value={kpis.totalTreatments} suffix="" />
        <Kpi label="% éxito 12m" value={kpis.successRate12m} suffix="%" tone="success" />
        <Kpi label="% éxito 24m" value={kpis.successRate24m} suffix="%" tone="info" />
        <Kpi label="% retratamientos" value={kpis.retreatmentRate} suffix="%" tone="warning" />
        <Kpi label="Adherencia controles" value={kpis.followUpAdherence} suffix="%" />
      </section>

      <SuccessRateChart data={breakdown} />

      <section className="endo-section">
        <header className="endo-pending__header">
          <p className="endo-section__eyebrow">Tratamientos en curso</p>
          <h2 className="endo-section__title">
            {activeTreatments.length} {activeTreatments.length === 1 ? "tratamiento activo" : "tratamientos activos"}
          </h2>
        </header>
        {activeTreatments.length === 0 ? (
          <p className="endo-section__placeholder">Sin tratamientos en curso.</p>
        ) : (
          <table className="endo-table">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Diente</th>
                <th>Tipo</th>
                <th>Inicio</th>
                <th>Doctor</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {activeTreatments.map((t) => (
                <tr key={t.id}>
                  <td>{t.patient.firstName} {t.patient.lastName}</td>
                  <td className="endo-table__mono">{t.toothFdi}</td>
                  <td>{labelTreatmentType(t.treatmentType)}</td>
                  <td>{t.startedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td>{t.doctor ? `${t.doctor.firstName} ${t.doctor.lastName}` : "—"}</td>
                  <td>
                    <Link
                      href={`/dashboard/specialties/endodontics/${t.patient.id}?tooth=${t.toothFdi}`}
                      className="pedi-btn pedi-btn--xs"
                    >
                      Continuar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <PendingFollowUpsList rows={pendingFollowUps} />
      <PendingRestorationList rows={pendingRestorations} />
    </div>
  );
}

function Kpi(props: { label: string; value: number; suffix: string; tone?: "success" | "info" | "warning" }) {
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

function labelTreatmentType(t: string): string {
  const map: Record<string, string> = {
    TC_PRIMARIO: "TC primario",
    RETRATAMIENTO: "Retratamiento",
    APICECTOMIA: "Apicectomía",
    PULPOTOMIA_EMERGENCIA: "Pulpotomía emergencia",
    TERAPIA_REGENERATIVA: "Terapia regenerativa",
  };
  return map[t] ?? t;
}
