// Pediatrics — página dedicada del paciente pediátrico. Spec: §7 (sprint 2)

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { isPediatric } from "@/lib/pediatrics/age";
import { PEDIATRICS_MODULE_KEY, DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";
import { loadPediatricsData } from "@/lib/pediatrics/load-data";
import { PediatricsTab } from "@/components/patient-detail/pediatrics/PediatricsTab";

export default async function PediatricsPatientDetailPage({
  params,
}: {
  params: { patientId: string };
}) {
  const user = await getCurrentUser();

  if (user.clinic.category !== "DENTAL" && user.clinic.category !== "MEDICINE") {
    redirect("/dashboard");
  }

  const access = await canAccessModule(user.clinicId, PEDIATRICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PEDIATRICS_MODULE_KEY}`);
  }

  const data = await loadPediatricsData({
    clinicId: user.clinicId,
    patientId: params.patientId,
  });

  if (!data) {
    redirect("/dashboard/specialties/pediatrics");
  }

  if (!isPediatric(data.patientDob, DEFAULT_PEDIATRICS_CUTOFF_YEARS)) {
    redirect("/dashboard/specialties/pediatrics");
  }

  const initials = data.patientName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div className="ped-detail">
      <div className="ped-detail__topbar">
        <Link href="/dashboard/specialties/pediatrics" className="pedi-btn ped-detail__back">
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
            <span className="ped-detail__age">{data.ageFormatted}</span>
            <span className="ped-detail__sep" aria-hidden>·</span>
            <span className="ped-detail__dentition">Dentición {data.dentition}</span>
            {data.primaryGuardian ? (
              <>
                <span className="ped-detail__sep" aria-hidden>·</span>
                <span>Tutor: {data.primaryGuardian.fullName}</span>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <PediatricsTab data={data} variant="full-page" />
    </div>
  );
}
