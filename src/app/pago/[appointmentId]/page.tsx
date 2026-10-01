import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PagoClient } from "./pago-client";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { esTokenDePagoValido } from "@/lib/teleconsulta/pago-token";

export const metadata = { title: "Pagar teleconsulta — DaleControl" };

// M7 (auditoría 30-sep-2026): el id de la cita no es un secreto. La liga que la
// clínica le manda al paciente lleva `?t=<token>` (HMAC, ver pago-token.ts); sin
// él esta página es un 404 y ni siquiera se consulta la cita. Tampoco se entrega
// nunca la URL de la sala ni el token del paciente: ya pagada, la liga de la
// videollamada le llega por WhatsApp (webhook de Stripe).
export default async function PagoPage({
  params,
  searchParams,
}: {
  params: { appointmentId: string };
  searchParams: { t?: string };
}) {
  if (!esTokenDePagoValido(params.appointmentId, searchParams?.t)) notFound();

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
      payToken={searchParams.t as string}
    />
  );
}
