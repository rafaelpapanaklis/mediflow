// Implants — utilidades de mapping de currentStatus a hito del timeline
// y al color de borde de la tarjeta. Spec §1.5, §6.3.

import type { ImplantStatus, ImplantProtocol } from "@prisma/client";

export type TimelineMilestone =
  | "PLANNING"
  | "SURGERY"
  | "OSSEOINTEGRATION"
  | "SECOND_STAGE"
  | "PROSTHETIC"
  | "MAINTENANCE";

export type MilestoneState =
  | "completed"
  | "active"
  | "future"
  | "skipped"
  | "failed";

export type ImplantBorderColor =
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "gray";

/** Hito activo del timeline en función del status actual. Spec §6.3. */
export function activeMilestone(status: ImplantStatus): TimelineMilestone {
  switch (status) {
    case "PLANNED":
      return "PLANNING";
    case "PLACED":
    case "OSSEOINTEGRATING":
      return "OSSEOINTEGRATION";
    case "UNCOVERED":
    case "LOADED_PROVISIONAL":
      return "PROSTHETIC";
    case "LOADED_DEFINITIVE":
    case "FUNCTIONAL":
    case "COMPLICATION":
    case "FAILED":
    case "REMOVED":
      return "MAINTENANCE";
  }
}

/**
 * Si el protocolo NO es 2-stage, el hito SECOND_STAGE se renderiza
 * como `skipped` (gris muy tenue). Spec §6.3.
 */
export function shouldSkipSecondStage(protocol: ImplantProtocol): boolean {
  return protocol !== "TWO_STAGE";
}

/**
 * Color del borde de ImplantCard según currentStatus. Spec §1.5, §11.
 *
 *   azul   → PLACED, OSSEOINTEGRATING, UNCOVERED
 *   verde  → LOADED_DEFINITIVE, FUNCTIONAL
 *   amarillo → LOADED_PROVISIONAL, PLANNED
 *   naranja  → COMPLICATION
 *   rojo    → FAILED
 *   gris    → REMOVED
 */
export function implantBorderColor(status: ImplantStatus): ImplantBorderColor {
  switch (status) {
    case "PLACED":
    case "OSSEOINTEGRATING":
    case "UNCOVERED":
      return "blue";
    case "LOADED_DEFINITIVE":
    case "FUNCTIONAL":
      return "green";
    case "LOADED_PROVISIONAL":
    case "PLANNED":
      return "yellow";
    case "COMPLICATION":
      return "orange";
    case "FAILED":
      return "red";
    case "REMOVED":
      return "gray";
  }
}

/** True si el implante debe expandirse por defecto en la lista. */
export function shouldDefaultExpand(args: {
  isMostRecent: boolean;
  hasActiveComplication: boolean;
}): boolean {
  return args.isMostRecent || args.hasActiveComplication;
}
