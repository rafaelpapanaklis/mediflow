/**
 * Qué citas ve un DOCTOR con «solo sus citas», y el filtro de doctores de la
 * agenda, con la cita «Sin doctor» (ws1-t11 · fase 2 · P1, decisión D3).
 *
 * Un DOCTOR ve las SUYAS y las «Sin doctor» de pacientes que puede ver
 * (`patientVisibilityFilter`: sin lista, todo el equipo; con lista, quien está
 * en ella). Así, en una clínica que agenda «Sin doctor» por defecto, el doctor
 * ve las citas que puede tomar; la de un paciente restringido que no es suyo
 * sigue sin verla. Las de OTRO doctor, como siempre, no.
 *
 * Va en un `AND` (nunca pisa el `OR` de quien lo use).
 */
import type { Prisma } from "@prisma/client";
import { patientVisibilityFilter } from "@/lib/patient-visibility";
import { FILTRO_SIN_DOCTOR } from "./sin-doctor";

export function dondeCitasDelDoctor(doctor: { userId: string; clinicId: string }): Prisma.AppointmentWhereInput {
  // Sin id, `{ doctorId: undefined }` no filtraría nada (Prisma descarta la clave): nada.
  if (!doctor.userId) return { id: { in: [] } };
  const vis = patientVisibilityFilter({ userId: doctor.userId, role: "DOCTOR", clinicId: doctor.clinicId });
  return {
    OR: [
      { doctorId: doctor.userId },
      { doctorId: null, ...(vis ? { patient: { is: vis } } : {}) },
    ],
  };
}

/**
 * Los doctores que eligió el filtro de la agenda. `FILTRO_SIN_DOCTOR` en la
 * lista = también las «Sin doctor» (sin él, quedan fuera como hasta ahora).
 */
export function dondeDoctoresElegidos(ids: readonly string[]): Prisma.AppointmentWhereInput {
  const reales = ids.filter((id) => id !== FILTRO_SIN_DOCTOR);
  if (!ids.includes(FILTRO_SIN_DOCTOR)) return { doctorId: { in: reales } };
  if (reales.length === 0) return { doctorId: null };
  return { OR: [{ doctorId: { in: reales } }, { doctorId: null }] };
}
