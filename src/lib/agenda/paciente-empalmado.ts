// «Este paciente ya tiene otra cita a esa hora» (ws1-t1, ronda de arreglos de la auditoría de uso, C-87).
//
// EL FALLO QUE CIERRA: el índice `appt_doctor_no_overlap` impide que un DOCTOR tenga dos citas a la vez, pero
// nada miraba al PACIENTE: se podía agendar a la misma persona a las 10:00 con Mariana y a las 10:00 con
// Alejandro, y la respuesta traía `scheduleWarning: null`.
//
// Decisión de Rafael (valor conservador, ronda de arreglos): AVISAR, no bloquear — igual que el aviso de fuera
// de horario. La cita se guarda y el aviso viaja por `scheduleWarning`, que las pantallas del staff (alta,
// edición, arrastre, Sabina) ya pintan como toast. Si además hay aviso de horario o de bloqueo, van los dos
// en el mismo texto.

import { prisma } from "@/lib/prisma";
import type { ScheduleViolation } from "@/lib/agenda/clinic-hours";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";

export interface CitaQueEmpalma {
  startsAt: Date;
  endsAt: Date;
  doctor: { firstName: string | null; lastName: string | null } | null;
}

/** El texto del aviso. Puro, para probarlo sin base. */
export function avisoDePacienteEmpalmado(otra: CitaQueEmpalma, timezone: string | null | undefined): ScheduleViolation {
  const doctor = [otra.doctor?.firstName, otra.doctor?.lastName].filter(Boolean).join(" ").trim();
  const hora = `${formatTimeInTz(otra.startsAt.toISOString(), timezone)}–${formatTimeInTz(otra.endsAt.toISOString(), timezone)}`;
  return {
    reason: "patient_overlap",
    message:
      `Ojo: este paciente ya tiene otra cita a esa hora (${hora}${doctor ? ` con ${doctor}` : ""}). ` +
      "Se guardó igual; si fue un error, cancela una de las dos.",
    openTime: null,
    closeTime: null,
  };
}

/** Junta el aviso de horario/bloqueo con el del paciente: los dos se dicen, en un solo toast. */
export function juntarAvisos(
  horario: ScheduleViolation | null,
  paciente: ScheduleViolation | null,
): ScheduleViolation | null {
  if (!horario) return paciente;
  if (!paciente) return horario;
  return { ...horario, message: `${horario.message} ${paciente.message}` };
}

/**
 * ¿El paciente tiene otra cita viva que se pisa con [startsAt, endsAt) con OTRO doctor? (Con el mismo doctor ya
 * la frena el índice de exclusión.) Nunca lanza: un aviso no puede tumbar el guardado.
 */
export async function buscarPacienteEmpalmado(args: {
  clinicId: string;
  patientId: string | null | undefined;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  /** La propia cita, al moverla. */
  excluirId?: string;
  timezone: string | null | undefined;
}): Promise<ScheduleViolation | null> {
  // (c) de la casa: sin clinicId ni paciente no se consulta.
  if (!args.clinicId || !args.patientId) return null;
  try {
    const otra = await prisma.appointment.findFirst({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        doctorId: { not: args.doctorId },
        ...(args.excluirId ? { id: { not: args.excluirId } } : {}),
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: args.endsAt },
        endsAt: { gt: args.startsAt },
      },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true, endsAt: true, doctor: { select: { firstName: true, lastName: true } } },
    });
    return otra ? avisoDePacienteEmpalmado(otra, args.timezone) : null;
  } catch (e) {
    console.error("[agenda/paciente-empalmado]", e);
    return null;
  }
}
