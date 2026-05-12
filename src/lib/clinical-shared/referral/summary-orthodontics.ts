// Clinical-shared — generador de summary clínico orto para hojas de referencia.
//
// Ortodoncia v2 rewrite (feat/ortho-v2-rewrite) — re-cablear en Fase 4 v2
// con OrthoCase + OrthoDiagnosis + OrthoTreatmentPlan v2 (con ArchPlanned[]).
// Por ahora devuelve un mensaje estático.

/**
 * Pre-llena el summary ortodóntico para hoja de referencia. Stub v2.
 */
export async function buildOrthoSummary(_args: {
  patientId: string;
  clinicId: string;
}): Promise<string> {
  return "Resumen de ortodoncia pendiente — módulo v2 en construcción (feat/ortho-v2-rewrite).";
}
