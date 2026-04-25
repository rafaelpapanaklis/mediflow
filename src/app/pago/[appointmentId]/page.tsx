import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PagoClient } from "./pago-client";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";

export const metadata = { title: "Pagar teleconsulta — MediFlow" };

export default async function PagoPage({ params }: { params: { appointmentId: string } }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    include: {
      patient: { select: { firstName: true, lastName: true, email: true } },
      doctor: { select: { firstName: true, lastName: true } },
      clinic: { select: { name: true, timezone: true } },
    },
  });
  if (!appointment || appointment.mode !== "TELECONSULTATION") notFound();

  return (
    <PagoClient
      appointmentId={appointment.id}
      patientName={`${appointment.patient.firstName} ${appointment.patient.lastName}`}
      doctorName={`Dr/a. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`}
      clinicName={appointment.clinic.name}
      appointmentType={appointment.type}
      date={appointment.startsAt.toISOString()}
      time={timeHHMMInTz(appointment.startsAt, appointment.clinic.timezone)}
      amount={appointment.paymentAmount ?? 0}
      paymentStatus={appointment.paymentStatus}
      teleRoomUrl={appointment.teleRoomUrl}
      telePatientToken={appointment.telePatientToken}
    />
  );
}
