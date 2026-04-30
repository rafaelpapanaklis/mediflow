/**
 * Control de acceso a módulos del Marketplace (Sprint 1).
 *
 * Este archivo es el wrapper de Prisma. La lógica pura vive en
 * ./access-control-core.ts (testeable sin tocar DB).
 *
 * Aplicar canAccessModule() en:
 *   - layouts de cada módulo (`app/(clinic)/<modulo>/layout.tsx`)
 *   - route handlers que crean/leen registros del módulo
 * Si retorna `hasAccess=false`, redirigir a `/marketplace?expired=true`.
 */
import { prisma } from "@/lib/prisma";
import {
  evaluateAccess,
  type ClinicAccessSnapshot,
  type ModuleAccess,
} from "./access-control-core";

export {
  evaluateAccess,
  type ModuleAccess,
  type ModuleAccessReason,
  type ClinicAccessSnapshot,
} from "./access-control-core";

export async function canAccessModule(
  clinicId: string,
  moduleKey: string,
): Promise<ModuleAccess> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      trialEndsAt: true,
      clinicModules: {
        select: {
          status: true,
          currentPeriodEnd: true,
          module: { select: { key: true } },
        },
      },
    },
  });

  if (!clinic) {
    return evaluateAccess(null, moduleKey);
  }

  const snapshot: ClinicAccessSnapshot = {
    trialEndsAt: clinic.trialEndsAt,
    modules: clinic.clinicModules.map((cm) => ({
      moduleKey: cm.module.key,
      status: cm.status,
      currentPeriodEnd: cm.currentPeriodEnd,
    })),
  };

  return evaluateAccess(snapshot, moduleKey);
}

/** Estado del trial — para banners y `/api/clinic/trial-status`. */
export interface TrialStatus {
  trialStartedAt: Date;
  trialEndsAt: Date;
  daysLeft: number;
  isExpired: boolean;
}

export async function getTrialStatus(
  clinicId: string,
): Promise<TrialStatus | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { trialStartedAt: true, trialEndsAt: true },
  });
  if (!clinic) return null;

  const now = new Date();
  const msLeft = clinic.trialEndsAt.getTime() - now.getTime();
  return {
    trialStartedAt: clinic.trialStartedAt,
    trialEndsAt: clinic.trialEndsAt,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
    isExpired: msLeft <= 0,
  };
}
