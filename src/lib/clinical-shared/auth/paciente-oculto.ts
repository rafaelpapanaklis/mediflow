import { prisma } from "@/lib/prisma";
import { canSeePatient, isVisibilityAdmin } from "@/lib/patient-visibility";

/**
 * ¿Este paciente está OCULTO para esta persona? (ws1-t11 · lead 14)
 *
 * Para las server actions que reciben el id de un REGISTRO (foto, plan, orden,
 * hoja de referencia, recordatorio, tutor, consentimiento…): lo cargan por
 * { id, clinicId } y, antes de este cambio, escribían sin mirar la visibilidad
 * por paciente (patients.visibleUserIds). Un paciente restringido «no existe»
 * para el staff no-admin que no está en su lista (@/lib/patient-visibility):
 * quien llama devuelve el MISMO «no encontrado» que si el registro no existiera.
 *
 * Solo dice true cuando el paciente existe y está restringido para él. NO
 * filtra por clínica a propósito (un paciente prestado de otra sede del grupo
 * conserva su lista): el que llama ya cargó el registro con SU clinicId, y es
 * esa comprobación la que ata el registro a la sesión. Un paciente borrado no
 * cambia de comportamiento. Los admins nunca consultan.
 */
export async function pacienteOcultoPara(
  quien: { userId: string; role: string; clinicId: string },
  patientId: string | null | undefined,
): Promise<boolean> {
  if (!patientId || isVisibilityAdmin(quien.role)) return false;
  const paciente = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { visibleUserIds: true },
  });
  if (!paciente) return false;
  return !canSeePatient({ userId: quien.userId, role: quien.role, clinicId: quien.clinicId }, paciente.visibleUserIds);
}
