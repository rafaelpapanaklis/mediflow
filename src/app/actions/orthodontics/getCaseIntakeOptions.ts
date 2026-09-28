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
import { ORTHO_BILLING_MODE_DEFAULT, type OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { loadOrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { cargarDoctoresTratantes } from "@/lib/orthodontics/doctores-tratantes-db";
import { doctorPropuestoParaElAlta, etiquetaDeDoctor } from "@/lib/orthodontics/doctores-tratantes";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface CaseIntakeOptions {
  doctors: Array<{ id: string; fullName: string }>;
  guardians: Array<{ id: string; fullName: string; parentesco: string; phone: string }>;
  referringDoctors: Array<{ id: string; fullName: string; clinicName: string | null }>;
  generalConsentSigned: boolean | null;
  /** A13 — quién refirió al caso, si ya está guardado en el diagnóstico. */
  referredByDoctor: { id: string; fullName: string; clinicName: string | null } | null;
  /**
   * Existencia REAL de las columnas de A5/A11 en la base, comprobada contra
   * `information_schema` — no inferida de que salgan en null (un caso real
   * sin doctor asignado se ve igual que uno sin la columna). Con esto
   * DrawerNewCase/DrawerCaseSettings pueden deshabilitar el select ANTES de
   * elegir, con explicación, en vez de que el usuario elija y se entere
   * después de guardar que no se guardó nada.
   */
  columnsExist: { treatingDoctorId: boolean; responsibleGuardianId: boolean };
  /** Solo si se pidió `treatmentPlanId` — valores actuales para DrawerCaseSettings. */
  currentPlan: {
    status: string;
    onHoldReason: string | null;
    droppedOutReason: string | null;
    installedAt: string | null;
    treatingDoctorId: string | null;
    responsibleGuardianId: string | null;
  } | null;
  /**
   * Cómo cobra la clínica HOY (ws1-t3, H18c): es el modo con el que nacerá el
   * caso. El alta lo usa para rotular el campo del costo — en «Pago por
   * control» no se factura un total, así que ahí es un estimado.
   */
  billingMode: OrthoBillingMode;
  /**
   * Con qué doctor arranca el alta de un caso NUEVO (ws1-t5, ronda 6): el
   * «Doctor tratante por defecto» de Configuración si sigue atendiendo, o el
   * único ortodoncista/doctor de la clínica. "" = que lo elija quien abre el
   * caso. Es una propuesta: el selector sigue editable.
   */
  suggestedTreatingDoctorId: string;
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

  // A13 — quién refirió al paciente, resuelto desde el diagnóstico del caso
  // (no del plan): tolerante a que la columna aún no exista.
  let referredByDoctor: CaseIntakeOptions["referredByDoctor"] = null;
  try {
    const dx = await prisma.orthodonticDiagnosis.findFirst({
      where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
      orderBy: { diagnosedAt: "desc" },
      select: { referredByDoctor: { select: { id: true, fullName: true, clinicName: true } } },
    });
    referredByDoctor = dx?.referredByDoctor ?? null;
  } catch (e) {
    console.error("[ortho] getCaseIntakeOptions: referredByDoctorId no disponible todavía:", e);
  }

  // Comprobación REAL de las columnas (no inferida de valores en null).
  let columnsExist: CaseIntakeOptions["columnsExist"] = {
    treatingDoctorId: false,
    responsibleGuardianId: false,
  };
  try {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orthodontic_treatment_plans'
        AND column_name IN ('treatingDoctorId', 'responsibleGuardianId')
    `;
    const names = new Set(cols.map((c) => c.column_name));
    columnsExist = {
      treatingDoctorId: names.has("treatingDoctorId"),
      responsibleGuardianId: names.has("responsibleGuardianId"),
    };
  } catch (e) {
    console.error("[ortho] getCaseIntakeOptions: no se pudo comprobar columnsExist:", e);
  }

  // ws1-t5 (ronda 6): doctores + el dueño o administrador que atiende, con los
  // ortodoncistas de Equipo primero (doctores-tratantes.ts).
  const [doctorsRaw, guardiansRaw, referringRaw] = await Promise.all([
    cargarDoctoresTratantes(ctx.clinicId),
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

  // El modo de cobro de la clínica y el doctor tratante por defecto.
  // best-effort: si no se puede leer, el modo de siempre (precio total) y sin
  // doctor por defecto — el alta no se cae por esto.
  let billingMode: OrthoBillingMode = ORTHO_BILLING_MODE_DEFAULT;
  let doctorPorDefecto: string | null = null;
  try {
    const settings = await loadOrthoClinicSettings(ctx.clinicId);
    billingMode = settings.billingMode;
    doctorPorDefecto = settings.defaultTreatingDoctorId;
  } catch (e) {
    console.error("[ortho] getCaseIntakeOptions: no se pudo leer la Configuración de la clínica:", e);
  }

  return ok({
    billingMode,
    suggestedTreatingDoctorId: doctorPropuestoParaElAlta({ porDefecto: doctorPorDefecto, opciones: doctorsRaw }),
    doctors: doctorsRaw.map((d) => ({ id: d.id, fullName: etiquetaDeDoctor(d) })),
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
    referredByDoctor,
    columnsExist,
    currentPlan,
  });
}
