"use server";
// Orthodontics — Ola 1 (ws1-t6), «Alta del caso»: opciones de solo lectura
// para el asistente de alta dentro de la ficha nueva (DrawerNewCase) y para
// el panel de configuración del caso (DrawerCaseSettings).
//
//   - doctors: doctores activos de la clínica, para A5 (doctor tratante).
//   - guardians: tutores ya registrados del paciente (modelo "Guardian" de
//     pediatría, sin exigir PediatricRecord), para A11 (responsable del pago).
//   - referringDoctors: directorio "doctor_contacts" existente, para A13
//     (quién refirió al paciente).
//   - generalConsentSigned: si ya existe un consentimiento GENERAL firmado
//     de la plantilla "ortodoncia" para este paciente (A10 — evita duplicar
//     el sistema propio de consentimientos de ortodoncia, que se oculta).

import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface CaseIntakeOptions {
  doctors: Array<{ id: string; fullName: string }>;
  guardians: Array<{ id: string; fullName: string; parentesco: string; phone: string }>;
  referringDoctors: Array<{ id: string; fullName: string; clinicName: string | null }>;
  generalConsentSigned: boolean | null;
  /** Solo si se pidió `treatmentPlanId` — valores actuales para DrawerCaseSettings. */
  currentPlan: {
    status: string;
    onHoldReason: string | null;
    droppedOutReason: string | null;
    installedAt: string | null;
    treatingDoctorId: string | null;
    responsibleGuardianId: string | null;
  } | null;
}

export async function getCaseIntakeOptions(
  input: unknown,
): Promise<ActionResult<CaseIntakeOptions>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const patientId = typeof input === "string" ? input : (input as { patientId?: string })?.patientId;
  if (!patientId) return fail("patientId requerido");
  const treatmentPlanId = typeof input === "object" ? (input as { treatmentPlanId?: string })?.treatmentPlanId : undefined;

  const patient = await loadPatientForOrtho({ ctx, patientId });
  if (isFailure(patient)) return patient;

  // Best-effort: si treatingDoctorId/responsibleGuardianId aún no existen en
  // la base (sql/ortodoncia-alta-caso.sql sin pegar), cae a la consulta
  // reducida — DrawerCaseSettings simplemente no precarga esos dos selects.
  let currentPlan: CaseIntakeOptions["currentPlan"] = null;
  if (treatmentPlanId) {
    try {
      const plan = await prisma.orthodonticTreatmentPlan.findFirst({
        where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
        select: {
          status: true,
          onHoldReason: true,
          droppedOutReason: true,
          installedAt: true,
          treatingDoctorId: true,
          responsibleGuardianId: true,
        },
      });
      if (plan) {
        currentPlan = {
          status: plan.status,
          onHoldReason: plan.onHoldReason,
          droppedOutReason: plan.droppedOutReason,
          installedAt: plan.installedAt ? plan.installedAt.toISOString() : null,
          treatingDoctorId: plan.treatingDoctorId,
          responsibleGuardianId: plan.responsibleGuardianId,
        };
      }
    } catch (e) {
      console.error("[ortho] getCaseIntakeOptions: currentPlan reducido (columnas nuevas ausentes):", e);
      const plan = await prisma.orthodonticTreatmentPlan.findFirst({
        where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
        select: { status: true, onHoldReason: true, droppedOutReason: true, installedAt: true },
      });
      if (plan) {
        currentPlan = {
          status: plan.status,
          onHoldReason: plan.onHoldReason,
          droppedOutReason: plan.droppedOutReason,
          installedAt: plan.installedAt ? plan.installedAt.toISOString() : null,
          treatingDoctorId: null,
          responsibleGuardianId: null,
        };
      }
    }
  }

  const [doctorsRaw, guardiansRaw, referringRaw] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId: ctx.clinicId, role: "DOCTOR", isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.guardian.findMany({
      where: { clinicId: ctx.clinicId, patientId, deletedAt: null },
      select: { id: true, fullName: true, parentesco: true, phone: true },
      orderBy: { principal: "desc" },
    }),
    prisma.doctorContact.findMany({
      where: { clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true, fullName: true, clinicName: true },
      orderBy: { fullName: "asc" },
      take: 200,
    }),
  ]);

  // Consentimiento GENERAL de la clínica (ConsentForm, procedureKey
  // "ortodoncia") — no el sistema propio de ortodoncia (OrthodonticConsent),
  // que el alcance manda ocultar (S11). best-effort: no bloquea el alta.
  let generalConsentSigned: boolean | null = null;
  try {
    const consent = await prisma.consentForm.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId,
        procedureKey: "ortodoncia",
        signedAt: { not: null },
        deletedAt: null,
      },
      select: { id: true },
    });
    generalConsentSigned = Boolean(consent);
  } catch (e) {
    console.error("[ortho] getCaseIntakeOptions: ConsentForm no disponible:", e);
  }

  return ok({
    doctors: doctorsRaw.map((d) => ({ id: d.id, fullName: `${d.firstName} ${d.lastName}`.trim() })),
    guardians: guardiansRaw.map((g) => ({
      id: g.id,
      fullName: g.fullName,
      parentesco: g.parentesco,
      phone: g.phone,
    })),
    referringDoctors: referringRaw.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      clinicName: r.clinicName,
    })),
    generalConsentSigned,
    currentPlan,
  });
}
