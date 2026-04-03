export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppointmentsClient } from "./appointments-client";
export default async function AppointmentsPage() {
  const user = await getCurrentUser();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);
  const todayAppts = await prisma.appointment.findMany({ where: { clinicId: user.clinicId, date: { gte: today, lte: todayEnd } }, include: { patient: true, doctor: true }, orderBy: { startTime: "asc" } });
  const patients = await prisma.patient.findMany({ where: { clinicId: user.clinicId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, patientNumber: true }, orderBy: { firstName: "asc" } });
  const doctors = await prisma.user.findMany({ where: { clinicId: user.clinicId, isActive: true }, select: { id: true, firstName: true, lastName: true, role: true } });
  return <AppointmentsClient todayAppts={todayAppts as any} patients={patients} doctors={doctors} currentUserId={user.id} />;
}
