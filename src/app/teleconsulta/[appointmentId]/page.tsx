import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { TeleconsultaClient } from "./teleconsulta-client";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";

export const metadata = { title: "Teleconsulta — MediFlow" };

export default async function TeleconsultaPage({ params, searchParams }: { params: { appointmentId: string }; searchParams: { role?: string; token?: string } }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
      clinic: { select: { name: true, timezone: true } },
    },
  });
  if (!appointment || appointment.mode !== "TELECONSULTATION") notFound();

  const role = searchParams.role === "doctor" ? "doctor" : "patient";
  const token = role === "doctor" ? appointment.teleDoctorToken : (searchParams.token ?? appointment.telePatientToken);

  return (
    <TeleconsultaClient
      appointmentId={appointment.id}
      roomUrl={appointment.teleRoomUrl}
      token={token}
      role={role}
      patientName={`${appointment.patient.firstName} ${appointment.patient.lastName}`}
      doctorName={`Dr/a. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`}
      clinicName={appointment.clinic.name}
      appointmentType={appointment.type}
      appointmentTime={timeHHMMInTz(appointment.startsAt, appointment.clinic.timezone)}
      paymentStatus={appointment.paymentStatus}
    />
  );
}
