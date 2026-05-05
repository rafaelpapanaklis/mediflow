// Orthodontics — vista embebida del módulo dentro del expediente del paciente.
// Patrón Periodontics §1.7 + Implant.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY, PEDIATRICS_MODULE_KEY } from "@/lib/specialties/keys";
import { loadOrthoData } from "@/lib/orthodontics/load-data";
import { OrthodonticsClient } from "@/components/specialties/orthodontics/OrthodonticsClient";

export default async function PatientOrthodonticsPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect(`/dashboard/patients/${params.id}`);
  const access = await canAccessModule(user.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ORTHODONTICS_MODULE_KEY}`);
  }
  const pediAccess = await canAccessModule(user.clinicId, PEDIATRICS_MODULE_KEY);

  const data = await loadOrthoData({ clinicId: user.clinicId, patientId: params.id });
  if (!data) redirect(`/dashboard/patients/${params.id}`);

  const resolveFileUrl = (fileId: string) => `/api/patient-files/${fileId}`;
  const agreementPdfHref = data.paymentPlan
    ? `/api/orthodontics/payment-plans/${data.paymentPlan.id}/financial-agreement-pdf`
    : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16 }}>
      <Link
        href={`/dashboard/patients/${params.id}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-2)",
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={14} aria-hidden /> Volver al expediente
      </Link>

      <h1 style={{ margin: 0, fontSize: 18, color: "var(--text-1)" }}>
        Ortodoncia · {data.patientName}
      </h1>

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
