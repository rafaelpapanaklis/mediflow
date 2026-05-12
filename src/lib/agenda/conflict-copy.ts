// Helpers de copy para errores de overlap (409) en la agenda. El servidor
// devuelve un `conflictingAppointment` (cuando puede identificar el choque
// concreto) y el cliente compara con lo que estaba intentando crear/mover
// para mostrar un mensaje claro: ¿es por doctor, por sillón, o por ambos?

type ConflictPayload = {
  id: string;
  patientName?: string | null;
  doctorId: string;
  resourceId: string | null;
};

type Attempted = {
  doctorId?: string | null;
  resourceId?: string | null;
};

export function describeOverlapConflict(
  conflicting: ConflictPayload | undefined,
  attempted: Attempted,
): string {
  if (!conflicting) return "Conflicto: ya existe una cita en ese horario.";
  const name = conflicting.patientName?.trim() || "otro paciente";
  const sameDoctor = !!attempted.doctorId && attempted.doctorId === conflicting.doctorId;
  const sameResource = !!attempted.resourceId && attempted.resourceId === conflicting.resourceId;
  if (sameDoctor && sameResource) {
    return `Conflicto: ya hay una cita con ${name} en este sillón con el mismo doctor a esa hora.`;
  }
  if (sameResource) {
    return `El sillón está ocupado por ${name} a esa hora (otro doctor).`;
  }
  if (sameDoctor) {
    return `El doctor ya tiene una cita con ${name} a esa hora.`;
  }
  return `Conflicto: ya existe una cita con ${name} en ese horario.`;
}
