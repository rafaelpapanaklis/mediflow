// Orthodontics — página detalle del paciente. SPEC §6.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY, PEDIATRICS_MODULE_KEY } from "@/lib/specialties/keys";
import { loadOrthoData } from "@/lib/orthodontics/load-data";
import { OrthodonticsClient } from "@/components/specialties/orthodontics/OrthodonticsClient";

export default async function OrthodonticsPatientDetailPage({
  params,
}: {
  params: { patientId: string };
}) {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ORTHODONTICS_MODULE_KEY}`);
  }
  const pediAccess = await canAccessModule(user.clinicId, PEDIATRICS_MODULE_KEY);

  const data = await loadOrthoData({
    clinicId: user.clinicId,
    patientId: params.patientId,
  });
  if (!data) redirect("/dashboard/specialties/orthodontics");

  const initials = data.patientName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  const resolveFileUrl = (fileId: string) => `/api/patient-files/${fileId}`;
  const agreementPdfHref = data.paymentPlan
    ? `/api/orthodontics/payment-plans/${data.paymentPlan.id}/financial-agreement-pdf`
    : undefined;

  return (
    <div className="ped-detail">
      <div className="ped-detail__topbar">
        <Link href="/dashboard/specialties/orthodontics" className="pedi-btn ped-detail__back">
          <ArrowLeft size={14} aria-hidden /> Volver al kanban
        </Link>
        <Link href={`/dashboard/patients/${data.patientId}`} className="pedi-btn">
          <FileText size={14} aria-hidden /> Expediente completo
        </Link>
      </div>

      <header className="ped-detail__header">
        <div className="ped-detail__avatar" aria-hidden>{initials || "?"}</div>
        <div className="ped-detail__title-block">
          <h1 className="ped-detail__name">{data.patientName}</h1>
          <p className="ped-detail__meta">
            <span>
              Ortodoncia · {data.patientAge != null ? `${data.patientAge} años` : "edad —"}
            </span>
          </p>
        </div>
      </header>

      <OrthodonticsClient
        patientId={data.patientId}
        patientName={data.patientName}
        isMinor={data.isMinor}
        pediatricsModuleActive={pediAccess.hasAccess}
        hasPediatricProfile={data.hasPediatricProfile}
        guardianName={data.guardianName}
        pediatricHabits={data.pediatricHabits}
        diagnosis={data.diagnosis}
        plan={data.plan}
        phases={data.phases}
        monthInTreatment={data.monthInTreatment}
        paymentPlan={data.paymentPlan}
        installments={data.installments}
        photoSets={data.photoSets}
        controls={data.controls}
        digitalRecords={data.digitalRecords}
        resolveFileUrl={resolveFileUrl}
        agreementPdfHref={agreementPdfHref}
      />
    </div>
  );
}
