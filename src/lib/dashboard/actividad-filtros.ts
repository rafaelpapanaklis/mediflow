import type { Prisma } from "@prisma/client";
import { patientVisibilityFilter, type VisibilityViewer } from "@/lib/patient-visibility";

/**
 * Filtros de visibilidad por paciente de la campana de actividad
 * (GET /api/dashboard/activity), uno por tabla y TIPADOS con el `WhereInput` de
 * Prisma.
 *
 * El 500 de la campana (revisión en panel.108, F2) era de aquí: el filtro de
 * relación se pedía con `patientNullable: true`, que agrega `{ patientId: null }`
 * para dejar pasar «filas sin paciente». Pero `Invoice.patientId`,
 * `Appointment.patientId` y `OrthodonticTreatmentPlan.patientId` son
 * OBLIGATORIOS: Prisma no admite `null` en ellos y lanzaba
 * `PrismaClientValidationError: Argument patientId is missing` a todo el que no
 * es admin (los admins reciben `[]` y no llegan a ese filtro). Aquí no hay filas
 * sin paciente que conservar, así que el filtro es el de relación a secas.
 *
 * `relatedPatientVisibilityAnd` devuelve `Record<string, any>[]`, y por eso el
 * compilador nunca vio el `null`. Aquí cada filtro se escribe como literal del
 * `WhereInput` de su tabla (sin `any` ni casts): un campo mal puesto falla en
 * `npm run typecheck`. La regla de visibilidad sigue siendo
 * `patientVisibilityFilter` (admins = sin filtro).
 */
export interface FiltrosDeActividad {
  /** `where.AND` de `Patient` (raíz). */
  pacientes: Prisma.PatientWhereInput[];
  /** `where.AND` de `Invoice`. */
  facturas: Prisma.InvoiceWhereInput[];
  /** `where.AND` de `Appointment`. */
  citas: Prisma.AppointmentWhereInput[];
  /** `where.AND` de `OrthodonticTreatmentPlan`. */
  casosOrtodoncia: Prisma.OrthodonticTreatmentPlanWhereInput[];
}

export function filtrosDeActividad(viewer: VisibilityViewer): FiltrosDeActividad {
  const f = patientVisibilityFilter(viewer);
  if (!f) return { pacientes: [], facturas: [], citas: [], casosOrtodoncia: [] };
  return {
    pacientes: [f],
    facturas: [{ patient: { is: f } }],
    citas: [{ patient: { is: f } }],
    casosOrtodoncia: [{ patient: { is: f } }],
  };
}
