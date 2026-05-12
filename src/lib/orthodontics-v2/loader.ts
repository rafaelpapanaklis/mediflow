// Loader server-side · trae el OrthoCaseBundle completo desde Prisma.

import { prisma } from "@/lib/prisma";
import type { OrthoCaseBundle } from "./types";
import {
  toCaseVM,
  toDiagnosisVM,
  toPlanVM,
  toPhotoSetVM,
  toTreatmentCardVM,
  toFinancialPlanVM,
  toRetentionPlanVM,
  toDocumentVM,
  toLabOrderVM,
  toCommVM,
} from "./adapter";

interface LoadArgs {
  clinicId: string;
  patientId: string;
}

/**
 * Carga el bundle completo del caso ortodóntico de un paciente. Si no existe,
 * devuelve null. Si el paciente no pertenece a la clínica, devuelve null.
 */
export async function loadOrthoCaseBundle(
  args: LoadArgs,
): Promise<OrthoCaseBundle | null> {
  const caso = await prisma.orthoCase.findUnique({
    where: { patientId: args.patientId },
    include: {
      patient: {
        select: { id: true, firstName: true, lastName: true, patientNumber: true },
      },
      diagnosis: true,
      plan: {
        include: { archesPlanned: true },
      },
      photoSets: {
        include: { photos: true },
        orderBy: { capturedAt: "asc" },
      },
      treatmentCards: {
        orderBy: { visitDate: "desc" },
      },
      financialPlan: {
        include: { installments: true },
      },
      retentionPlan: true,
      documents: { orderBy: { createdAt: "desc" } },
      labOrders: { orderBy: { sentAt: "desc" } },
      comms: { orderBy: { sentAt: "desc" }, take: 50 },
    },
  });

  if (!caso || caso.clinicId !== args.clinicId) return null;

  return {
    case: toCaseVM(caso, caso.patient),
    diagnosis: caso.diagnosis ? toDiagnosisVM(caso.diagnosis) : null,
    plan: caso.plan ? toPlanVM(caso.plan) : null,
    photoSets: caso.photoSets.map(toPhotoSetVM),
    cards: caso.treatmentCards.map(toTreatmentCardVM),
    financialPlan: caso.financialPlan
      ? toFinancialPlanVM(caso.financialPlan)
      : null,
    retentionPlan: caso.retentionPlan ? toRetentionPlanVM(caso.retentionPlan) : null,
    documents: caso.documents.map(toDocumentVM),
    labOrders: caso.labOrders.map(toLabOrderVM),
    comms: caso.comms.map(toCommVM),
  };
}
