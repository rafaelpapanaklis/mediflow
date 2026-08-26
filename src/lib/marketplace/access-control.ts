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
import { daysUntil, isInTrial } from "@/lib/plan-status";
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
      subscriptionStatus: true,
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
    subscriptionStatus: clinic.subscriptionStatus,
    modules: clinic.clinicModules.map((cm) => ({
      moduleKey: cm.module.key,
      status: cm.status,
      currentPeriodEnd: cm.currentPeriodEnd,
    })),
  };

  return evaluateAccess(snapshot, moduleKey);
}

/**
 * Lista de keys consideradas "especialidades" en el marketplace. Cuando
 * DaleControl lance otros módulos clínicos se agregan aquí para que aparezcan
 * en el grupo "Especialidades" del sidebar. Ordenadas por nombre clínico.
 */
const SPECIALTY_MODULE_KEYS: readonly string[] = [
  "pediatric-dentistry",
  "endodontics",
  "implants",
  // Próximos: "orthodontics", "periodontics"
];

/**
 * `true` si la clínica tiene cualquier módulo de especialidad activo
 * (status='active' y currentPeriodEnd > NOW) **o** está en trial vigente.
 * Se usa para mostrar/ocultar el grupo "Especialidades" del sidebar.
 *
 * Optimización: una sola query agregada en lugar de N consultas por módulo.
 */
export async function hasAnyActiveSpecialtyModule(clinicId: string): Promise<boolean> {
  if (SPECIALTY_MODULE_KEYS.length === 0) return false;

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { trialEndsAt: true, subscriptionStatus: true },
  });
  if (!clinic) return false;

  const now = new Date();
  // Trial/cortesía vigente (plan-status): la fecha sola no basta — una
  // clínica que paga tiene trialEndsAt en el futuro y NO está en trial.
  if (isInTrial(clinic, now)) return true;

  const active = await prisma.clinicModule.findFirst({
    where: {
      clinicId,
      status: "active",
      currentPeriodEnd: { gt: now },
      module: { key: { in: [...SPECIALTY_MODULE_KEYS] } },
    },
    select: { id: true },
  });
  return active !== null;
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
    select: { trialStartedAt: true, trialEndsAt: true, subscriptionStatus: true },
  });
  if (!clinic) return null;

  // "Expirado" aquí = NO hay trial/cortesía vigente (plan-status). Para una
  // clínica que paga es true desde el primer día: su marketplace muestra los
  // módulos comprados y bloquea el resto, no "todo en prueba".
  const now = new Date();
  const inTrial = isInTrial(clinic, now);
  return {
    trialStartedAt: clinic.trialStartedAt,
    trialEndsAt: clinic.trialEndsAt,
    daysLeft: inTrial ? Math.max(0, daysUntil(clinic.trialEndsAt, now) ?? 0) : 0,
    isExpired: !inTrial,
  };
}
