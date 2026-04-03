export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClinicalClient } from "./clinical-client";
export default async function ClinicalPage({ searchParams }: { searchParams: { patientId?: string } }) {
  const user = await getCurrentUser();
  const patients = await prisma.patient.findMany({ where: { clinicId: user.clinicId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, patientNumber: true, gender: true, dob: true }, orderBy: { firstName: "asc" } });
  let records: any[] = [];
  let selectedPatient: any = null;
  let sessionCount = 0;
  if (searchParams.patientId) {
    selectedPatient = await prisma.patient.findFirst({ where: { id: searchParams.patientId, clinicId: user.clinicId } });
    if (selectedPatient) {
      records = await prisma.medicalRecord.findMany({ where: { patientId: searchParams.patientId, clinicId: user.clinicId }, include: { doctor: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { visitDate: "desc" } });
      sessionCount = records.length + 1;
    }
  }
  return <ClinicalClient specialty={user.clinic.specialty} patients={patients} selectedPatient={selectedPatient} records={records} sessionCount={sessionCount} currentPatientId={searchParams.patientId} />;
}
