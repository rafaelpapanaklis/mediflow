// Página PÚBLICA (sin login): confirmar asistencia a una cita por link con
// token aleatorio. Server component: valida token y pasa datos mínimos al
// client (sin ids internos, sin PII extra).

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatApptDateParts } from "@/lib/reminders/config";
import { ConfirmClient } from "./confirm-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Confirmar cita — DaleControl" };

interface Props {
  params: { token: string };
}

export default async function ConfirmAppointmentPage({ params }: Props) {
  const token = params.token;
  if (!token || token.length > 64) notFound();

  // Minimización de datos: select explícito de SOLO lo que la página renderiza.
  // Sin ids internos ni PII extra hacia el HTML público.
  const appt = await prisma.appointment.findUnique({
    where: { confirmToken: token },
    select: {
      startsAt: true,
      status: true,
      clinic: {
        select: {
          name: true,
          logoUrl: true,
          phone: true,
          address: true,
          city: true,
          timezone: true,
        },
      },
      patient: { select: { firstName: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
  });

  if (!appt) notFound();

  const { fecha, hora } = formatApptDateParts(appt.startsAt, appt.clinic.timezone);

  // Cita en el pasado (y no cancelada): estado final server-side, sin botones.
  if (appt.startsAt < new Date() && appt.status !== "CANCELLED") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-white text-center">
        <div className="w-full max-w-md mx-auto">
          <div className="text-5xl mb-4">📅</div>
          <h1 className="text-2xl font-bold mb-2">Esta cita ya pasó</h1>
          <p className="text-slate-400">
            Era el {fecha} a las {hora} en {appt.clinic.name}.
          </p>
          <p className="text-slate-400 mt-2">
            Si necesitas una nueva cita, contacta a la clínica.
          </p>
          <p className="text-xs text-slate-600 mt-8">Powered by DaleControl</p>
        </div>
      </div>
    );
  }

  const clinicAddress =
    [appt.clinic.address, appt.clinic.city].filter(Boolean).join(", ") || null;

  return (
    <ConfirmClient
      token={token}
      info={{
        clinicName: appt.clinic.name,
        clinicLogoUrl: appt.clinic.logoUrl,
        clinicPhone: appt.clinic.phone,
        clinicAddress,
        patientFirstName: appt.patient.firstName,
        doctorName: `Dr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}`,
        fecha,
        hora,
        status: appt.status,
      }}
    />
  );
}
