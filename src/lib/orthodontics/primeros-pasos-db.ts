// ═══════════════════════════════════════════════════════════════════════════
// Carga de los PRIMEROS PASOS del módulo (ws1-t5, 28-sep-2026). La lógica —
// qué pasos hay y cuál está hecho— es pura y vive en `primeros-pasos.ts`.
//
// `clinicId` SIEMPRE de la sesión. Tres lecturas (la Configuración y dos
// conteos), todas con su filtro de clínica. Nunca lanza: si algo falla
// devuelve `null` y el Tablero se pinta sin el bloque — son una ayuda, no
// pueden tumbar la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { loadOrthoClinicSettings } from "./clinic-settings-db";
import { primerosPasosOrtodoncia, type PrimerosPasos } from "./primeros-pasos";

export async function loadPrimerosPasosOrtodoncia(clinicId: string): Promise<PrimerosPasos | null> {
  // `clinicId: undefined` no filtraría nada: se corta antes de consultar.
  if (!clinicId) return null;
  try {
    const [settings, casos, casosConPlanDePago] = await Promise.all([
      loadOrthoClinicSettings(clinicId),
      prisma.orthodonticTreatmentPlan.count({ where: { clinicId, deletedAt: null } }),
      prisma.orthodonticTreatmentPlan.count({ where: { clinicId, deletedAt: null, invoiceId: { not: null } } }),
    ]);
    return primerosPasosOrtodoncia({
      // `updatedAt` solo existe si hay fila: la clínica guardó su Configuración.
      configuracionGuardada: settings.updatedAt !== null,
      modoDeCobro: settings.billingMode,
      casos,
      casosConPlanDePago,
    });
  } catch (e) {
    console.error("[ortodoncia] no se pudieron cargar los primeros pasos:", e);
    return null;
  }
}
