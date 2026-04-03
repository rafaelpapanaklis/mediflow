export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PatientDetailClient } from "./patient-detail-client";
export default async function PatientDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const patient = await prisma.patient.findFirst({ where: { id: params.id, clinicId: user.clinicId }, include: { appointments: { orderBy: { date: "desc" }, take: 20, include: { doctor: { select: { id: true, firstName: true, lastName: true } } } }, records: { orderBy: { visitDate: "desc" }, include: { doctor: { select: { id: true, firstName: true, lastName: true } } } }, invoices: { include: { payments: true } } } });
  if (!patient) notFound();
  const doctors = await prisma.user.findMany({ where: { clinicId: user.clinicId, isActive: true }, select: { id: true, firstName: true, lastName: true } });
  const totalPaid    = patient.invoices.reduce((s, i) => s + i.paid, 0);
  const totalBalance = patient.invoices.reduce((s, i) => s + i.balance, 0);
  const totalPlan    = patient.invoices.reduce((s, i) => s + i.total, 0);
  return <PatientDetailClient patient={patient as any} records={patient.records as any} appointments={patient.appointments as any} invoices={patient.invoices as any} doctors={doctors} currentUser={{ id: user.id, firstName: user.firstName, lastName: user.lastName }} specialty={user.clinic.specialty} totalPaid={totalPaid} totalBalance={totalBalance} totalPlan={totalPlan} />;
}
