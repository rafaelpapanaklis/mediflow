// Periodontics — server actions para los 3 PDFs (paciente, médico tratante,
// comparativo pre/post). SPEC §9.1, §9.2, §9.3.
//
// Patrón: la action valida acceso + audita; la generación con
// @react-pdf/renderer vive en route handlers bajo /api/periodontics/reports/.
// El cliente abre la URL devuelta y el endpoint reverifica auth antes de
// servir bytes (defense in depth + RLS no aplica a archivos generados).

"use server";

import { prisma } from "@/lib/prisma";
import {
  PERIO_AUDIT_ACTIONS,
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  ok,
  type ActionResult,
} from "./_helpers";

export type PerioPdfResult = { url: string };

/** PDF "Informe periodontal del paciente". Lenguaje accesible. */
export async function exportPerioPatientReportPdf(
  patientId: string,
): Promise<ActionResult<PerioPdfResult>> {
  if (!patientId) return fail("patientId requerido");

  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt || patient.clinicId !== ctx.clinicId) {
    return fail("Paciente no encontrado");
  }

  await auditPerio({
    ctx,
    action: PERIO_AUDIT_ACTIONS.REPORT_PATIENT_PDF,
    entityType: "Patient",
    entityId: patient.id,
    after: { exportedAt: new Date().toISOString() },
  });

  return ok({ url: `/api/periodontics/reports/patient/${patient.id}` });
}

/**
 * PDF "Reporte legal al médico tratante". Lenguaje técnico. NOM-024 obliga
 * registrar quién genera el documento y cuándo.
 */
export async function exportPerioReferrerReportPdf(
  patientId: string,
): Promise<ActionResult<PerioPdfResult>> {
  if (!patientId) return fail("patientId requerido");

  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt || patient.clinicId !== ctx.clinicId) {
    return fail("Paciente no encontrado");
  }

  await auditPerio({
    ctx,
    action: PERIO_AUDIT_ACTIONS.REPORT_REFERRER_PDF,
    entityType: "Patient",
    entityId: patient.id,
    after: { exportedAt: new Date().toISOString() },
  });

  return ok({ url: `/api/periodontics/reports/referrer/${patient.id}` });
}

/**
 * PDF "Comparativo pre/post tratamiento". Toma 2 records por id en
 * `?initial=...&post=...` del endpoint final. Acá solo registramos la
 * intención de export y devolvemos URL.
 */
export async function exportPerioPrePostComparePdf(args: {
  initialRecordId: string;
  postRecordId: string;
}): Promise<ActionResult<PerioPdfResult>> {
  if (!args.initialRecordId || !args.postRecordId) {
    return fail("initialRecordId y postRecordId son requeridos");
  }

  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const [initial, post] = await Promise.all([
    prisma.periodontalRecord.findFirst({
      where: { id: args.initialRecordId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true, patientId: true },
    }),
    prisma.periodontalRecord.findFirst({
      where: { id: args.postRecordId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true, patientId: true },
    }),
  ]);
  if (!initial || !post) return fail("Registros no encontrados");

  await auditPerio({
    ctx,
    action: PERIO_AUDIT_ACTIONS.REPORT_PRE_POST_PDF,
    entityType: "PeriodontalRecord",
    entityId: post.id,
    after: { initialId: initial.id, exportedAt: new Date().toISOString() },
  });

  const params = new URLSearchParams({
    initial: initial.id,
    post: post.id,
  });
  return ok({ url: `/api/periodontics/reports/pre-post?${params.toString()}` });
}
