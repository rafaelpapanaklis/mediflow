import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PagoClient } from "./pago-client";

export const metadata = { title: "Pagar teleconsulta — MediFlow" };

export default async function PagoPage({ params }: { params: { appointmentId: string } }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    include: {
      patient: { select: { firstName: true, lastName: true, email: true } },
      doctor: { select: { firstName: true, lastName: true } },
      clinic: { select: { name: true } },
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
      date={appointment.date instanceof Date ? appointment.date.toISOString() : String(appointment.date)}
      time={appointment.startTime}
      amount={appointment.paymentAmount ?? 0}
      paymentStatus={appointment.paymentStatus}
      teleRoomUrl={appointment.teleRoomUrl}
      telePatientToken={appointment.telePatientToken}
    />
  );
}
