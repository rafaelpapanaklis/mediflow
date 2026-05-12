// Orthodontics — máquina de transiciones lineales entre las 6 fases. SPEC §5.3.
//
// El plan avanza estrictamente: ALIGNMENT → LEVELING → SPACE_CLOSURE →
// DETAILS → FINISHING → RETENTION. Saltar fases requiere reapertura
// manual con justificación (no expuesto en MVP).

import type { OrthoPhaseKey } from "@prisma/client";

/** Orden lineal canónico — el `orderIndex` debe coincidir con este array. */
export const PHASE_ORDER: readonly OrthoPhaseKey[] = [
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSURE",
  "DETAILS",
  "FINISHING",
  "RETENTION",
] as const;

/**
 * Devuelve la siguiente fase canónica, o null si `from` es la última
 * (RETENTION) o desconocida.
 */
export function nextPhase(from: OrthoPhaseKey): OrthoPhaseKey | null {
  const idx = PHASE_ORDER.indexOf(from);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1] ?? null;
}

/**
 * Devuelve la fase previa canónica, o null si `from` es la primera
 * (ALIGNMENT) o desconocida.
 */
export function previousPhase(from: OrthoPhaseKey): OrthoPhaseKey | null {
  const idx = PHASE_ORDER.indexOf(from);
  if (idx <= 0) return null;
  return PHASE_ORDER[idx - 1] ?? null;
}

/**
 * Valida una transición avanzando linealmente. Para reaperturas o saltos
 * manuales (admin override) usar `canForceTransition` con justificación.
 */
export function canAdvance(from: OrthoPhaseKey, to: OrthoPhaseKey): boolean {
  return nextPhase(from) === to;
}

/**
 * Override admin: cualquier transición entre fases conocidas. El caller
 * debe registrar justificación textual + audit log.
 */
export function canForceTransition(
  from: OrthoPhaseKey,
  to: OrthoPhaseKey,
): boolean {
  return PHASE_ORDER.includes(from) && PHASE_ORDER.includes(to) && from !== to;
}

/** Tipo de transición — útil para audit log y UI. */
export type TransitionKind = "advance" | "rollback" | "skip" | "invalid";

export function classifyTransition(
  from: OrthoPhaseKey,
  to: OrthoPhaseKey,
): TransitionKind {
  const fromIdx = PHASE_ORDER.indexOf(from);
  const toIdx = PHASE_ORDER.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return "invalid";
  if (toIdx === fromIdx + 1) return "advance";
  if (toIdx < fromIdx) return "rollback";
  if (toIdx > fromIdx + 1) return "skip";
  return "invalid";
}

/**
 * Guard documental: para avanzar de la fase inicial (ALIGNMENT) a la
 * siguiente, el plan debe tener un set fotográfico T0 completo (las 8
 * vistas estándar: 3 extraorales + 5 intraorales). Esto asegura que se
 * documentó el caso antes de modificar la oclusión y permite
 * comparativos "antes/después" reales en el PDF de progreso.
 *
 * Devuelve null si OK, o un mensaje describiendo qué falta.
 */
export function requiresInitialPhotosBefore(args: {
  from: OrthoPhaseKey;
  to: OrthoPhaseKey;
  hasCompleteT0Set: boolean;
}): string | null {
  // Solo gate la primera transición (ALIGNMENT → LEVELING).
  // Las posteriores no se bloquean: si no hubo T0 al inicio, ya no se
  // puede recuperar el momento, y la fase está corriendo.
  if (args.from === "ALIGNMENT" && args.to === "LEVELING") {
    if (!args.hasCompleteT0Set) {
      return "No se puede avanzar a LEVELING sin un set fotográfico T0 completo (8 vistas).";
    }
  }
  return null;
}
