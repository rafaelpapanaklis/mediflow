/**
 * Helper compartido para gating de UI por ClinicModule activos. Punto de
 * verdad único de "qué especialidades tiene la clínica activas hoy" — se
 * consume en `dashboard/layout.tsx` (sidebar global) y en
 * `dashboard/patients/[id]/page.tsx` (tabs del paciente).
 *
 * Una sola query Prisma. Reemplaza N llamadas a `canAccessModule()` por
 * una sola lectura de `clinicModule` joineada con `module`.
 *
 * Reglas — espejo de `evaluateAccess` en
 * `lib/marketplace/access-control-core.ts`:
 *   - Trial vigente (now < trialEndsAt): se devuelven TODAS las keys de
 *     `SPECIALTY_MODULE_KEYS`. Un consumidor que haga
 *     `keys.includes(PERIODONTICS_MODULE_KEY)` recibe `true` exactamente
 *     igual que `canAccessModule(...).hasAccess` en trial.
 *   - Post-trial: solo las filas con `status='active'` Y
 *     `currentPeriodEnd > now`.
 *   - Clínica inexistente: `[]`.
 *
 * El consumidor decide la categoría (DENTAL vs MEDICINE) — esta función no
 * filtra por categoría porque el dataset es ortogonal: una key del
 * marketplace puede estar disponible en varias categorías y la regla vive
 * en cada predicado (`canSeePediatrics`, `canSeeImplants`, etc.).
 */
import { prisma } from "@/lib/prisma";
import { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import {
  ENDODONTICS_MODULE_KEY,
  PERIODONTICS_MODULE_KEY,
  ORTHODONTICS_MODULE_KEY,
} from "@/lib/specialties/keys";

/**
 * Universo de keys consideradas "especialidad clínica" en el sidebar y
 * en el tab strip del paciente. Cuando MediFlow lance un nuevo módulo
 * clínico se agrega aquí + en `NAV_ITEMS`/`buildTabs` correspondientes.
 */
export const SPECIALTY_MODULE_KEYS = [
  PEDIATRICS_MODULE_KEY,
  ENDODONTICS_MODULE_KEY,
  PERIODONTICS_MODULE_KEY,
  ORTHODONTICS_MODULE_KEY,
  IMPLANTS_MODULE_KEY,
] as const;

export type SpecialtyModuleKey = (typeof SPECIALTY_MODULE_KEYS)[number];

export async function getActiveClinicModuleKeys(
  clinicId: string,
): Promise<string[]> {
  const now = new Date();
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      trialEndsAt: true,
      clinicModules: {
        where: {
          status: "active",
          currentPeriodEnd: { gt: now },
          module: { key: { in: [...SPECIALTY_MODULE_KEYS] } },
        },
        select: { module: { select: { key: true } } },
      },
    },
  });

  if (!clinic) return [];

  const inTrial = clinic.trialEndsAt.getTime() > now.getTime();
  if (inTrial) return [...SPECIALTY_MODULE_KEYS];

  return clinic.clinicModules.map((cm) => cm.module.key);
}

/**
 * Variante pura para tests y server components que ya tienen el snapshot
 * cargado. Lógica idéntica a `getActiveClinicModuleKeys` sin Prisma.
 */
export interface ClinicModulesSnapshot {
  trialEndsAt: Date;
  modules: Array<{
    moduleKey: string;
    status: string;
    currentPeriodEnd: Date;
  }>;
}

export function deriveActiveClinicModuleKeys(
  snapshot: ClinicModulesSnapshot | null,
  now: Date = new Date(),
): string[] {
  if (!snapshot) return [];
  if (snapshot.trialEndsAt.getTime() > now.getTime()) {
    return [...SPECIALTY_MODULE_KEYS];
  }
  return snapshot.modules
    .filter(
      (m) =>
        m.status === "active" &&
        m.currentPeriodEnd.getTime() > now.getTime() &&
        (SPECIALTY_MODULE_KEYS as readonly string[]).includes(m.moduleKey),
    )
    .map((m) => m.moduleKey);
}
