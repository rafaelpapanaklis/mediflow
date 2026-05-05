// Periodontics — detalle del paciente. SPEC §6, §8.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { PeriodonticsClient } from "@/components/specialties/periodontics/PeriodonticsClient";
import { loadPerioData } from "@/lib/periodontics/load-data";

export default async function PeriodonticsPatientDetailPage({
  params,
}: {
  params: { patientId: string };
}) {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PERIODONTICS_MODULE_KEY}`);
  }

  const data = await loadPerioData({
    clinicId: user.clinicId,
    patientId: params.patientId,
  });
  if (!data) redirect("/dashboard/specialties/periodontics");

  const initials = data.patientName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div className="ped-detail">
      <div className="ped-detail__topbar">
        <Link href="/dashboard/specialties/periodontics" className="pedi-btn ped-detail__back">
          <ArrowLeft size={14} aria-hidden /> Volver a la lista
        </Link>
        <Link href={`/dashboard/patients/${data.patientId}`} className="pedi-btn">
          <FileText size={14} aria-hidden /> Ver expediente completo
        </Link>
      </div>

      <header className="ped-detail__header">
        <div className="ped-detail__avatar" aria-hidden>{initials || "?"}</div>
        <div className="ped-detail__title-block">
          <h1 className="ped-detail__name">{data.patientName}</h1>
          <p className="ped-detail__meta">
            <span>Periodoncia · clasificación 2017 + riesgo Berna</span>
          </p>
        </div>
      </header>

      <PeriodonticsClient
        patientId={data.patientId}
        patientName={data.patientName}
        recordId={data.recordId}
        initialSites={data.initialSites}
        initialTeeth={data.initialTeeth}
        initialMetrics={data.initialMetrics}
        classification={data.classification}
        riskCategory={data.riskCategory}
        recallMonths={data.recallMonths}
        nextMaintenanceAt={data.nextMaintenanceAt}
        bopHistory={data.bopHistory}
        alerts={data.alerts}
        systemicFactors={data.systemicFactors}
        plan={data.plan}
        surgeries={data.surgeries}
        maintenanceHistory={data.maintenanceHistory}
      />
    </div>
  );
}
