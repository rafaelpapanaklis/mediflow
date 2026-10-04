// ¿El paciente que se agrega (o se inicia) en la Fila de espera ya tiene una cita VIVA hoy? (ws1-t1, tercera
// ronda — N-37)
//
// EL FALLO QUE CIERRA: Rosa estaba «En sillón» con Alejandro (08:00) y entró a la Fila sin aviso; «Iniciar» le creó
// OTRA cita con Mariana. El mismo paciente en dos lugares y dos citas hoy.
//
// Criterio conservador (anotado para Rafael): al AGREGAR se avisa y se deja agregar (puede ser otra persona o
// recepción lo sabe); al INICIAR no se crea una segunda cita: se dice cuál tiene y que se atienda desde ella.

import { prisma } from "@/lib/prisma";
import { calendarDayRangeUtc, todayInTz } from "@/lib/agenda/time-utils";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";

/** Estados en los que la cita sigue viva (no cancelada, no no-show, no terminada). */
export const ESTADOS_VIVOS = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] as const;

const ESTADO_EN_PALABRAS: Record<string, string> = {
  SCHEDULED: "agendada",
  CONFIRMED: "confirmada",
  CHECKED_IN: "en sala de espera",
  IN_CHAIR: "en sillón",
  IN_PROGRESS: "en consulta",
};

export interface CitaVivaDeHoy {
  id: string;
  hora: string;
  doctor: string;
  estado: string;
}

/** «Ya tiene cita hoy a las 08:00 con Alejandro Beltrán (en sillón).» Puro. */
export function textoCitaVivaDeHoy(c: CitaVivaDeHoy): string {
  return `Ya tiene cita hoy a las ${c.hora}${c.doctor ? ` con ${c.doctor}` : ""} (${ESTADO_EN_PALABRAS[c.estado] ?? c.estado.toLowerCase()}).`;
}

export function textoNoIniciarOtraCita(c: CitaVivaDeHoy): string {
  return `${textoCitaVivaDeHoy(c)} Atiéndelo desde esa cita en la Agenda, o cancélala antes de iniciar otra; así no quedan dos citas hoy.`;
}

export async function citaVivaDeHoy(args: {
  clinicId: string;
  patientId: string | null | undefined;
  timezone: string | null | undefined;
}): Promise<CitaVivaDeHoy | null> {
  // (c) de la casa: sin clinicId o sin paciente no se consulta.
  if (!args.clinicId || !args.patientId) return null;
  const tz = args.timezone || "America/Mexico_City";
  const hoy = todayInTz(tz);
  const { startUtc, endUtc } = calendarDayRangeUtc(hoy, tz);
  const cita = await prisma.appointment.findFirst({
    where: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      status: { in: [...ESTADOS_VIVOS] },
      startsAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, status: true, doctor: { select: { firstName: true, lastName: true } } },
  });
  if (!cita) return null;
  return {
    id: cita.id,
    hora: formatTimeInTz(cita.startsAt.toISOString(), tz),
    doctor: [cita.doctor?.firstName, cita.doctor?.lastName].filter(Boolean).join(" "),
    estado: cita.status,
  };
}
