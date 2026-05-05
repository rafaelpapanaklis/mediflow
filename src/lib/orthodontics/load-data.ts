// Orthodontics — helper compartido. SPEC §6.

import { differenceInMonths, differenceInYears } from "date-fns";
import { prisma } from "@/lib/prisma";
import type {
  OrthodonticDiagnosisRow,
  OrthodonticTreatmentPlanRow,
  OrthodonticPhaseRow,
  OrthoPaymentPlanRow,
  OrthoInstallmentRow,
  OrthoPhotoSetWithFiles,
  OrthodonticControlAppointmentRow,
  OrthodonticDigitalRecordRow,
} from "@/lib/types/orthodontics";

export interface LoadOrthoDataInput {
  clinicId: string;
  patientId: string;
}

export interface OrthoTabData {
  patientId: string;
  patientName: string;
  isMinor: boolean;
  patientAge: number | null;
  guardianName?: string | null;
  hasPediatricProfile: boolean;
  pediatricHabits: readonly string[];
  diagnosis: OrthodonticDiagnosisRow | null;
  plan: OrthodonticTreatmentPlanRow | null;
  phases: OrthodonticPhaseRow[];
  monthInTreatment: number;
  paymentPlan: OrthoPaymentPlanRow | null;
  installments: OrthoInstallmentRow[];
  photoSets: OrthoPhotoSetWithFiles[];
  controls: OrthodonticControlAppointmentRow[];
  digitalRecords: OrthodonticDigitalRecordRow[];
}

export async function loadOrthoData(
  input: LoadOrthoDataInput,
): Promise<OrthoTabData | null> {
  const patient = await prisma.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
    },
  });
  if (!patient) return null;

  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const age = patient.dob ? differenceInYears(new Date(), patient.dob) : null;
  const isMinor = age != null && age < 18;

  // Pediatric profile (best effort — Pediatrics module puede no estar instalado).
  let hasPediatricProfile = false;
  let guardianName: string | null = null;
  let pediatricHabits: readonly string[] = [];
  try {
    // El modelo PediatricProfile puede no existir en este repo; capturamos errores.
    const profile = await (prisma as unknown as { pediatricProfile?: { findUnique: (args: unknown) => Promise<unknown> } })
      ?.pediatricProfile?.findUnique?.({ where: { patientId: patient.id } });
    if (profile) {
      hasPediatricProfile = true;
      const p = profile as { guardianName?: string; habits?: string[] };
      guardianName = p.guardianName ?? null;
      pediatricHabits = (p.habits ?? []) as readonly string[];
    }
  } catch {
    // PediatricProfile no existe en schema — Pediatría no instalada, ignorar.
  }

  const [diagnosis, plan, photoSets, controls, digitalRecords] = await Promise.all([
    prisma.orthodonticDiagnosis.findFirst({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { diagnosedAt: "desc" },
    }),
    prisma.orthodonticTreatmentPlan.findFirst({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.orthoPhotoSet.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId },
      include: {
        photoFrontal: true,
        photoProfile: true,
        photoSmile: true,
        photoIntraFrontal: true,
        photoIntraLateralR: true,
        photoIntraLateralL: true,
        photoOcclusalUpper: true,
        photoOcclusalLower: true,
      },
      orderBy: { capturedAt: "desc" },
    }),
    prisma.orthodonticControlAppointment.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId },
      orderBy: { scheduledAt: "desc" },
      take: 60,
    }),
    prisma.orthodonticDigitalRecord.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId },
      orderBy: { capturedAt: "desc" },
    }),
  ]);

  const [phases, paymentPlan] = await Promise.all([
    plan
      ? prisma.orthodonticPhase.findMany({
          where: { treatmentPlanId: plan.id },
          orderBy: { orderIndex: "asc" },
        })
      : Promise.resolve([] as OrthodonticPhaseRow[]),
    plan
      ? prisma.orthoPaymentPlan.findFirst({
          where: { treatmentPlanId: plan.id, clinicId: input.clinicId },
        })
      : Promise.resolve(null),
  ]);

  const installments = paymentPlan
    ? await prisma.orthoInstallment.findMany({
        where: { paymentPlanId: paymentPlan.id },
        orderBy: { installmentNumber: "asc" },
      })
    : [];

  const monthInTreatment = (() => {
    if (!plan?.installedAt) return 0;
    return Math.max(0, differenceInMonths(new Date(), plan.installedAt));
  })();

  return {
    patientId: patient.id,
    patientName: fullName,
    isMinor,
    patientAge: age,
    guardianName,
    hasPediatricProfile,
    pediatricHabits,
    diagnosis,
    plan,
    phases,
    monthInTreatment,
    paymentPlan,
    installments,
    photoSets,
    controls,
    digitalRecords,
  };
}
