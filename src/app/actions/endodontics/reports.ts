"use server";
// Endodontics — server actions para exportar PDFs (informe al referente
// y informe legal NOM-024). Spec §5.11, §11.1, §11.2

import { prisma } from "@/lib/prisma";
import {
  ENDO_AUDIT_ACTIONS,
  auditEndo,
  fail,
  getEndoActionContext,
  isFailure,
  ok,
  type ActionResult,
} from "./_helpers";

export type ExportPdfResult = { url: string; treatmentId: string };

/**
 * Encola/genera el PDF del informe al doctor referente para un
 * tratamiento dado. La generación real con `@react-pdf/renderer` vive
 * en `/api/endodontics/reports/treatment/[id]` (creado en C16). Este
 * server action solo:
 *   1. Valida acceso al tratamiento.
 *   2. Audita la solicitud de export (NOM-024 obliga registrar quién
 *      genera reportes con datos clínicos).
 *   3. Devuelve la URL firmada para descargar.
 */
export async function exportTreatmentReportPdf(
  treatmentId: string,
): Promise<ActionResult<ExportPdfResult>> {
  if (!treatmentId) return fail("treatmentId requerido");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: treatmentId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");

  await auditEndo({
    ctx,
    action: ENDO_AUDIT_ACTIONS.REPORT_TREATMENT_PDF,
    entityType: "endo-treatment",
    entityId: tx.id,
    after: { exportedAt: new Date().toISOString() },
  });

  // URL apunta al endpoint dynamic que renderiza el PDF on-demand.
  // El endpoint reverifica auth y multi-tenant antes de servir bytes.
  return ok({
    treatmentId: tx.id,
    url: `/api/endodontics/reports/treatment/${tx.id}`,
  });
}

/**
 * Análogo al anterior pero genera el informe LEGAL NOM-024 (más extenso:
 * incluye todas las pruebas de vitalidad, protocolo de irrigación
 * detallado, todas las radiografías y audit log resumido). Spec §11.2.
 */
export async function exportLegalReportPdf(
  treatmentId: string,
): Promise<ActionResult<ExportPdfResult>> {
  if (!treatmentId) return fail("treatmentId requerido");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: treatmentId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");

  await auditEndo({
    ctx,
    action: ENDO_AUDIT_ACTIONS.REPORT_LEGAL_PDF,
    entityType: "endo-treatment",
    entityId: tx.id,
    after: { exportedAt: new Date().toISOString(), reportType: "legal" },
  });

  return ok({
    treatmentId: tx.id,
    url: `/api/endodontics/reports/legal/${tx.id}`,
  });
}
