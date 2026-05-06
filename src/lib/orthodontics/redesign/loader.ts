// Orthodontics rediseño Fase 1 — loader resiliente.
//
// Combina loadOrthoData (legacy) + queries opcionales a las tablas nuevas.
// Si las nuevas tablas aún no existen en la BD (migración no aplicada),
// devuelve arrays vacíos sin romper la UI.

import { prisma } from "@/lib/prisma";
import { loadOrthoData, type OrthoTabData } from "@/lib/orthodontics/load-data";
import {
  adaptToOrthoRedesignViewModel,
  type AdapterInput,
} from "./adapter";
import type { OrthoRedesignViewModel } from "@/components/specialties/orthodontics/redesign/types";

export interface LoadOrthoRedesignInput {
  clinicId: string;
  patientId: string;
}

export async function loadOrthoRedesignData(
  input: LoadOrthoRedesignInput,
): Promise<{ viewModel: OrthoRedesignViewModel; legacy: OrthoTabData } | null> {
  const legacy = await loadOrthoData(input);
  if (!legacy) return null;

  const planId = legacy.plan?.id ?? null;

  // Queries nuevas — try/catch silencioso por si la migración aún no aplicó.
  const [wireSteps, treatmentCards, tads, auxMechanics, phaseTransitions, patientFlow] =
    await Promise.all([
      planId
        ? safeArray(() =>
            prisma.orthoWireStep.findMany({
              where: { treatmentPlanId: planId },
              orderBy: { orderIndex: "asc" },
            }),
          )
        : Promise.resolve([]),
      planId
        ? safeArray(() =>
            prisma.orthoTreatmentCard.findMany({
              where: { treatmentPlanId: planId, deletedAt: null },
              orderBy: { cardNumber: "asc" },
              include: {
                elastics: true,
                iprPoints: true,
                brokenBrackets: true,
                signedBy: { select: { firstName: true, lastName: true } },
              },
            }),
          )
        : Promise.resolve([]),
      planId
        ? safeArray(() =>
            prisma.orthoTAD.findMany({
              where: { treatmentPlanId: planId, deletedAt: null },
              orderBy: { placedDate: "desc" },
            }),
          )
        : Promise.resolve([]),
      planId
        ? safeOne(() =>
            prisma.orthoAuxMechanics.findUnique({
              where: { treatmentPlanId: planId },
            }),
          )
        : Promise.resolve(null),
      planId
        ? safeArray(() =>
            prisma.orthoPhaseTransition.findMany({
              where: { treatmentPlanId: planId },
              orderBy: { signedAt: "desc" },
              take: 20,
              include: { signedBy: { select: { firstName: true, lastName: true } } },
            }),
          )
        : Promise.resolve([]),
      safeOne(() =>
        prisma.patientFlow.findFirst({
          where: {
            clinicId: input.clinicId,
            patientId: input.patientId,
            exitedAt: null,
          },
          orderBy: { enteredAt: "desc" },
        }),
      ),
    ]);

  const attendancePct = computeAttendancePct(legacy);
  const elasticsCompliancePct = 0;

  const adapterInput: AdapterInput = {
    legacy,
    wireSteps: wireSteps as AdapterInput["wireSteps"],
    treatmentCards: treatmentCards as AdapterInput["treatmentCards"],
    tads: tads as AdapterInput["tads"],
    auxMechanics: auxMechanics as AdapterInput["auxMechanics"],
    phaseTransitions: phaseTransitions as AdapterInput["phaseTransitions"],
    patientFlow: patientFlow as AdapterInput["patientFlow"],
    attendancePct,
    elasticsCompliancePct,
  };

  return {
    viewModel: adaptToOrthoRedesignViewModel(adapterInput),
    legacy,
  };
}

async function safeArray<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTableError(e)) return [];
    console.error("[ortho-redesign loader] query failed:", e);
    return [];
  }
}

async function safeOne<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTableError(e)) return null;
    console.error("[ortho-redesign loader] query failed:", e);
    return null;
  }
}

function isMissingTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  // Postgres / Prisma codes para tabla / relación inexistente.
  return code === "P2021" || code === "P2022";
}

function computeAttendancePct(legacy: OrthoTabData): number {
  const last = legacy.controls
    .slice()
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
    .slice(0, 6);
  if (last.length === 0) return 100;
  const attended = last.filter((c) => c.attendance === "ATTENDED").length;
  return Math.round((attended / last.length) * 100);
}
