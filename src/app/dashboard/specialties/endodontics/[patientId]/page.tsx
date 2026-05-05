// Endodontics — página detalle del paciente. Spec §6, §8.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ENDODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { EndodonticsTab } from "@/components/specialties/endodontics/EndodonticsTab";
import {
  loadEndoToothData,
  loadEndoToothSummaries,
} from "@/lib/helpers/loadEndoToothData";

export default async function EndodonticsPatientDetailPage({
  params,
  searchParams,
}: {
  params: { patientId: string };
  searchParams?: { tooth?: string };
}) {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, ENDODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ENDODONTICS_MODULE_KEY}`);
  }

  const patient = await prisma.patient.findFirst({
    where: { id: params.patientId, clinicId: user.clinicId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!patient) redirect("/dashboard/specialties/endodontics");

  const summaries = await loadEndoToothSummaries({
    clinicId: user.clinicId,
    patientId: patient.id,
  });

  const initialFdiRaw = Number(searchParams?.tooth);
  const initialFdi = Number.isInteger(initialFdiRaw) ? initialFdiRaw : null;
  const initialTooth = initialFdi
    ? await loadEndoToothData({
        clinicId: user.clinicId,
        patientId: patient.id,
        toothFdi: initialFdi,
      })
    : null;

  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const initials = fullName.split(" ").slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase();

  return (
    <div className="ped-detail">
      <div className="ped-detail__topbar">
        <Link href="/dashboard/specialties/endodontics" className="pedi-btn ped-detail__back">
          <ArrowLeft size={14} aria-hidden /> Volver a la lista
        </Link>
        <Link href={`/dashboard/patients/${patient.id}`} className="pedi-btn">
          <FileText size={14} aria-hidden /> Ver expediente completo
        </Link>
      </div>

      <header className="ped-detail__header">
        <div className="ped-detail__avatar" aria-hidden>{initials || "?"}</div>
        <div className="ped-detail__title-block">
          <h1 className="ped-detail__name">{fullName}</h1>
          <p className="ped-detail__meta">
            <span>Endodoncia · expediente diente-céntrico</span>
          </p>
        </div>
      </header>

      <EndodonticsTab
        patientId={patient.id}
        patientName={fullName}
        summaries={summaries}
        initialTooth={initialTooth}
      />
    </div>
  );
}
