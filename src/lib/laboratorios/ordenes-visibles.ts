import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { patientVisibilityFilter, type VisibilityViewer } from "@/lib/patient-visibility";

/**
 * Visibilidad por paciente en las órdenes de laboratorio (ws1-t11 · lead 13).
 *
 * DentalLabOrder NO tiene relación `patient` (solo el escalar nullable
 * `patientId` y el nombre copiado en `patientName`), así que
 * relatedPatientVisibilityAnd no aplica: se resuelven los pacientes de la
 * clínica que este viewer NO puede ver y se excluyen sus órdenes. Las órdenes
 * sin paciente se conservan. Mismo criterio que GET /api/ordenes-laboratorio;
 * esto es para las páginas server, que armaban la lista con solo el clinicId.
 */
export async function filtroOrdenesVisibles(viewer: VisibilityViewer): Promise<Prisma.DentalLabOrderWhereInput> {
  const visFilter = patientVisibilityFilter(viewer);
  if (!visFilter) return {};
  const ocultos = await prisma.patient.findMany({
    where: { clinicId: viewer.clinicId, NOT: visFilter },
    select: { id: true },
  });
  const ids = ocultos.map((p) => p.id);
  return ids.length ? { OR: [{ patientId: null }, { patientId: { notIn: ids } }] } : {};
}

/**
 * ¿Puede este viewer ver una orden ligada a `patientId`? false solo si ese
 * paciente es de la clínica y está oculto para él (la misma regla que la lista:
 * una orden que la lista enseña, el detalle la abre).
 */
export async function ordenDePacienteVisible(patientId: string | null, viewer: VisibilityViewer): Promise<boolean> {
  if (!patientId) return true;
  const visFilter = patientVisibilityFilter(viewer);
  if (!visFilter) return true;
  const oculto = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: viewer.clinicId, NOT: visFilter },
    select: { id: true },
  });
  return oculto === null;
}
