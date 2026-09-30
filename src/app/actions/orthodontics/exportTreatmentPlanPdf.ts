"use server";
// Orthodontics — action 14/15: exportTreatmentPlanPdf. SPEC §9.1.
// Carga datos para que el route handler renderToBuffer arme el PDF.

import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { cargarPlanDetalle } from "@/lib/orthodontics/plan-detalle-db";
import { lineasDelPlan, type LineaDelPlan } from "@/lib/orthodontics/plan-detalle";
import { cargarDiagnosticoDetalle, cargarDiagnosticosLegibles } from "@/lib/orthodontics/diagnostico-detalle-db";
import { medidaSinCapturar, type SeccionLegible } from "@/lib/orthodontics/diagnostico-detalle";
import { listarVersionesDelCaso } from "@/lib/orthodontics/versiones-caso-db";
import { fechaDma, lineaDeTiempo } from "@/lib/orthodontics/versiones-caso";
import { canViewPatient } from "@/lib/patient-visibility";
import { exportTreatmentPlanPdfSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { cargarMembreteOrto } from "@/lib/orthodontics/pdf/membrete-orto-db";
import type { DatosDelMembreteOrto } from "@/lib/orthodontics/pdf/membrete-orto";

export type TreatmentPlanPdfData = {
  treatmentPlanId: string;
  /**
   * ws1-t4: membrete común de los PDF de ortodoncia (logo, clínica, dirección,
   * teléfono, RFC, paciente, doctor con cédula, fecha dd/mm/aaaa). Antes esta
   * action solo pedía `clinic: { name }` y el PDF salía sin nada de eso.
   */
  membrete: DatosDelMembreteOrto;
  patient: { firstName: string; lastName: string; dob: Date | null };
  clinic: { name: string };
  doctor: { firstName: string; lastName: string; cedulaProfesional: string | null };
  diagnosis: {
    angleClassRight: string;
    angleClassLeft: string;
    /** null = sin capturar (la base guarda un 0 de relleno que no es un dato). */
    overbiteMm: string | null;
    overjetMm: string | null;
    clinicalSummary: string;
  };
  plan: {
    technique: string;
    /** ws1-t10: nombre propio de la técnica de la clínica. */
    techniqueName?: string | null;
    techniqueNotes: string | null;
    estimatedDurationMonths: number;
    totalCostMxn: string;
    /** ws1-t10: en «Pago por control» el costo es un estimado, no un total (el PDF lo rotula así). */
    billingMode?: string | null;
    anchorageType: string;
    extractionsRequired: boolean;
    extractionsTeethFdi: number[];
    treatmentObjectives: string;
    retentionPlanText: string;
  };
  /**
   * ws1-t12 — el plan de tratamiento COMPLETO (controles previstos, anclaje por arcada, aditamentos, extracciones
   * realizadas, control radiográfico, aparatología, tubos, bandas, cementación, interconsultas), en renglones ya
   * redactados (`lineasDelPlan`: la misma redacción que la ficha). `null`/ausente = el caso no tiene plan completo.
   */
  planCompleto?: { lineas: LineaDelPlan[] } | null;
  /**
   * ws1-t8 — el DIAGNÓSTICO completo (facial, oclusal, dentoalveolar, funcional, cefalometría, etiología), ya
   * redactado con `seccionesDelDiagnostico` (la misma redacción que la ficha). Vacío/ausente = solo lo de arriba.
   */
  diagnosticoCompleto?: SeccionLegible[];
  /**
   * ws1-t8 — REEVALUACIONES: la versión que se imprime (la actual) y las anteriores (fechas dd/mm/aaaa y el motivo
   * de la reevaluación que las cerró). Ausente o sin anteriores = el caso nunca se reevaluó.
   */
  versiones?: {
    actual: { etiqueta: string; desde: string };
    anteriores: Array<{ etiqueta: string; desde: string; hasta: string; motivo: string | null }>;
  };
  phases: Array<{ phaseKey: string; orderIndex: number; status: string }>;
  generatedAt: string;
};

export async function exportTreatmentPlanPdf(
  input: unknown,
): Promise<ActionResult<TreatmentPlanPdfData>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = exportTreatmentPlanPdfSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    include: {
      patient: { select: { firstName: true, lastName: true, dob: true } },
      diagnosis: {
        select: {
          angleClassRight: true,
          angleClassLeft: true,
          overbiteMm: true,
          overjetMm: true,
          etiologyNotes: true,
          clinicalSummary: true,
          diagnosedById: true,
          diagnosedAt: true,
        },
      },
      phases: {
        orderBy: { orderIndex: "asc" },
        select: { phaseKey: true, orderIndex: true, status: true },
      },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  // Visibilidad por paciente: no exponer el plan de un paciente restringido.
  if (!(await canViewPatient(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }))) {
    return fail("Paciente no encontrado");
  }

  const doctorId = plan.treatingDoctorId ?? plan.diagnosis.diagnosedById;
  const [clinic, doctor, membrete] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      // ws1-t8: la zona, para fechar las reevaluaciones como en la ficha.
      select: { name: true, timezone: true },
    }),
    prisma.user.findUnique({
      where: { id: doctorId },
      select: { firstName: true, lastName: true, cedulaProfesional: true },
    }),
    cargarMembreteOrto({ clinicId: ctx.clinicId, patientId: plan.patientId, doctorId }),
  ]);
  if (!clinic) return fail("Clínica no encontrada");

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.REPORT_TREATMENT_PLAN_PDF,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    meta: { exportedAt: new Date().toISOString() },
  });

  const [techniqueName, detalle, tads, billingMode] = await Promise.all([
    cargarNombreDeTecnica(ctx.clinicId, plan.id),
    // ws1-t12: sin la columna del plan (SQL sin pegar), el PDF sale como siempre.
    cargarPlanDetalle(ctx.clinicId, plan.id).catch(() => null),
    prisma.orthoTAD.count({ where: { treatmentPlanId: plan.id, clinicId: ctx.clinicId, deletedAt: null } }).catch(() => 0),
    cargarModoDeCobro(ctx.clinicId, plan.id).catch(() => null),
  ]);
  // El detalle del diagnóstico dice qué medidas no se capturaron (un 0 de relleno no se imprime como dato).
  const detalleDx = await cargarDiagnosticoDetalle(ctx.clinicId, plan.diagnosisId).catch(() => null);
  const planCompleto = detalle
    ? {
        lineas: lineasDelPlan(
          {
            estimatedDurationMonths: plan.estimatedDurationMonths,
            anchorageType: plan.anchorageType,
            extractionsRequired: plan.extractionsRequired,
            extractionsTeethFdi: plan.extractionsTeethFdi,
          },
          detalle,
          tads,
        ),
      }
    : null;
  return ok({
    treatmentPlanId: plan.id,
    membrete,
    patient: plan.patient,
    clinic,
    doctor: doctor ?? { firstName: "", lastName: "", cedulaProfesional: null },
    diagnosis: {
      angleClassRight: plan.diagnosis.angleClassRight,
      angleClassLeft: plan.diagnosis.angleClassLeft,
      overbiteMm: medidaSinCapturar(detalleDx, "overbiteMm", plan.diagnosis.etiologyNotes) ? null : plan.diagnosis.overbiteMm.toString(),
      overjetMm: medidaSinCapturar(detalleDx, "overjetMm", plan.diagnosis.etiologyNotes) ? null : plan.diagnosis.overjetMm.toString(),
      clinicalSummary: plan.diagnosis.clinicalSummary,
    },
    plan: {
      technique: plan.technique,
      techniqueName,
      techniqueNotes: plan.techniqueNotes,
      estimatedDurationMonths: plan.estimatedDurationMonths,
      totalCostMxn: plan.totalCostMxn.toString(),
      billingMode,
      anchorageType: plan.anchorageType,
      extractionsRequired: plan.extractionsRequired,
      extractionsTeethFdi: plan.extractionsTeethFdi,
      treatmentObjectives: plan.treatmentObjectives,
      retentionPlanText: plan.retentionPlanText,
    },
    planCompleto,
    // ws1-t8: sin la columna del diagnóstico completo (SQL sin pegar), sale lo de siempre.
    diagnosticoCompleto: (await cargarDiagnosticosLegibles(ctx.clinicId, [plan.diagnosisId])).get(plan.diagnosisId) ?? [],
    versiones: await versionesParaElPdf(ctx.clinicId, plan.id, plan.diagnosis.diagnosedAt, clinic?.timezone),
    phases: plan.phases,
    generatedAt: new Date().toISOString(),
  });
}

/** ws1-t8 — la línea de tiempo de reevaluaciones para el PDF. Sin la tabla (SQL sin pegar), nada. */
async function versionesParaElPdf(
  clinicId: string,
  planId: string,
  diagnosedAt: Date,
  zona: string | null | undefined,
): Promise<TreatmentPlanPdfData["versiones"]> {
  // En la zona de la clínica: una reevaluación cerrada a las 6 p.m. de México no es «del día siguiente».
  const dia = (iso: string | null) => fechaDma(iso, zona || undefined);
  const cerradas = await listarVersionesDelCaso(clinicId, planId).catch(() => null);
  if (!cerradas || cerradas.length === 0) return undefined;
  const linea = lineaDeTiempo(cerradas, diagnosedAt.toISOString());
  const actual = linea[linea.length - 1]!;
  return {
    actual: { etiqueta: actual.etiqueta, desde: dia(actual.desde) },
    anteriores: linea.slice(0, -1).map((p, i) => ({
      etiqueta: p.etiqueta,
      desde: dia(p.desde),
      hasta: dia(p.hasta),
      motivo: cerradas[i]?.motivo ?? null,
    })),
  };
}
