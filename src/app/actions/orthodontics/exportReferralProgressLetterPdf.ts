"use server";
// Orthodontics — Ola 1 (ws1-t6), «Alta del caso», A13: carta de avance al
// doctor que refirió al paciente. Dos momentos (`stage`): al iniciar el
// tratamiento y al terminarlo. Mismo patrón que exportTreatmentPlanPdf: esta
// action solo carga y valida los datos; el route handler arma el PDF con
// @react-pdf/renderer (no puppeteer). Sin envío automático — el botón que la
// dispara solo descarga/abre el PDF (ver DrawerCaseSettings).

import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { cargarDiagnosticoDetalle } from "@/lib/orthodontics/diagnostico-detalle-db";
import { medidaSinCapturar } from "@/lib/orthodontics/diagnostico-detalle";
import { cargarPlanDetalle } from "@/lib/orthodontics/plan-detalle-db";
import { datoDelPlanSinCapturar } from "@/lib/orthodontics/plan-detalle";
import { canViewPatient } from "@/lib/patient-visibility";
import { z } from "zod";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { cargarMembreteOrto } from "@/lib/orthodontics/pdf/membrete-orto-db";
import type { DatosDelMembreteOrto } from "@/lib/orthodontics/pdf/membrete-orto";
import { motivoParaNoEmitirCartaDeAvance } from "@/lib/orthodontics/pdf/reglas-de-emision";

const inputSchema = z.object({
  treatmentPlanId: z.string().min(1),
  stage: z.enum(["inicio", "termino"]),
});

export interface ReferralProgressLetterPdfData {
  stage: "inicio" | "termino";
  /** ws1-t4: membrete común de ortodoncia (logo, dirección, teléfono, doctor con cédula, fecha dd/mm/aaaa). */
  membrete: DatosDelMembreteOrto;
  patient: { firstName: string; lastName: string };
  clinic: { name: string; phone: string | null; email: string | null };
  treatingDoctor: { firstName: string; lastName: string; cedulaProfesional: string | null } | null;
  referredByDoctor: { fullName: string; clinicName: string | null };
  diagnosis: {
    angleClassRight: string;
    angleClassLeft: string;
    clinicalSummary: string;
  };
  plan: {
    technique: string;
    /** ws1-t10: nombre propio de la técnica de la clínica. */
    techniqueName?: string | null;
    /** null = la duración quedó «sin capturar» (relleno neutro): la carta no la dice. */
    estimatedDurationMonths: number | null;
    installedAt: string | null;
    retentionPlanText: string;
    status: string;
  };
  generatedAt: string;
}

export async function exportReferralProgressLetterPdf(
  input: unknown,
): Promise<ActionResult<ReferralProgressLetterPdfData>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  let plan;
  try {
    plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        treatingDoctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
        diagnosis: {
          select: {
            id: true,
            angleClassRight: true,
            angleClassLeft: true,
            clinicalSummary: true,
            etiologyNotes: true,
            diagnosedById: true,
            referredByDoctor: { select: { fullName: true, clinicName: true } },
          },
        },
      },
    });
  } catch (e) {
    console.error("[ortho] exportReferralProgressLetterPdf: columnas de alta-caso.sql ausentes:", e);
    return fail(
      "Falta pegar el SQL de esta parte (sql/ortodoncia-alta-caso.sql) para generar la carta de avance",
    );
  }
  if (!plan) return fail("Plan no encontrado");

  if (!(await canViewPatient(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }))) {
    return fail("Paciente no encontrado");
  }

  // ws1-t4 (5d): la de «término» dice «ha concluido su tratamiento»; con el caso
  // en curso eso es falso. Se niega aquí, no solo en la pantalla.
  const noSePuede = motivoParaNoEmitirCartaDeAvance(parsed.data.stage, plan.status);
  if (noSePuede) return fail(noSePuede);

  if (!plan.diagnosis.referredByDoctor) {
    return fail("Este caso no tiene registrado quién refirió al paciente (A13)");
  }

  const [clinic, membrete] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, phone: true, email: true },
    }),
    cargarMembreteOrto({
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      doctorId: plan.treatingDoctorId ?? plan.diagnosis.diagnosedById,
    }),
  ]);
  if (!clinic) return fail("Clínica no encontrada");

  await auditOrtho({
    ctx,
    action: `ortho.report.referralProgressLetter.${parsed.data.stage}.pdf`,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    meta: { exportedAt: new Date().toISOString(), stage: parsed.data.stage },
  });

  const detalleDx = await cargarDiagnosticoDetalle(ctx.clinicId, plan.diagnosis.id).catch(() => null);
  const detallePlan = await cargarPlanDetalle(ctx.clinicId, plan.id).catch(() => null);
  return ok({
    stage: parsed.data.stage,
    membrete,
    patient: plan.patient,
    clinic,
    treatingDoctor: plan.treatingDoctor,
    referredByDoctor: plan.diagnosis.referredByDoctor,
    diagnosis: {
      // "" = sin capturar (relleno de la columna NOT NULL): la carta no lo dice como Clase I.
      angleClassRight: medidaSinCapturar(detalleDx, "angleClassRight", plan.diagnosis.etiologyNotes) ? "" : plan.diagnosis.angleClassRight,
      angleClassLeft: medidaSinCapturar(detalleDx, "angleClassLeft", plan.diagnosis.etiologyNotes) ? "" : plan.diagnosis.angleClassLeft,
      clinicalSummary: plan.diagnosis.clinicalSummary,
    },
    plan: {
      technique: plan.technique,
      techniqueName: await cargarNombreDeTecnica(ctx.clinicId, plan.id),
      estimatedDurationMonths: datoDelPlanSinCapturar(detallePlan, "duracion") ? null : plan.estimatedDurationMonths,
      installedAt: plan.installedAt ? plan.installedAt.toISOString() : null,
      retentionPlanText: plan.retentionPlanText,
      status: plan.status,
    },
    generatedAt: new Date().toISOString(),
  });
}
