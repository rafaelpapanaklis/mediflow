/**
 * Helpers puros para TreatmentLink. El modelo `TreatmentLink` une un
 * registro específico de módulo (eg. ImplantSurgicalRecord, ImplantProstheticPhase)
 * con una `TreatmentSession` del plan de tratamiento general.
 *
 * Cuando una fase clínica se completa (ej. createSurgicalRecord termina),
 * un hook llama a `markPhaseCompleted` para crear el TreatmentLink y
 * marcar `TreatmentSession.completedAt` automáticamente.
 */
import { z } from "zod";

/**
 * Fases implantológicas que disparan hooks de TreatmentLink.
 */
export const IMPLANT_TREATMENT_LINK_PHASES = [
  "surgical",
  "healing",
  "second_stage",
  "prosthetic",
  "follow_up",
] as const;

export type ImplantTreatmentLinkPhase =
  (typeof IMPLANT_TREATMENT_LINK_PHASES)[number];

export function isImplantTreatmentLinkPhase(
  value: string,
): value is ImplantTreatmentLinkPhase {
  return (IMPLANT_TREATMENT_LINK_PHASES as readonly string[]).includes(value);
}

export function implantPhaseLabel(phase: ImplantTreatmentLinkPhase): string {
  switch (phase) {
    case "surgical":
      return "Cirugía de colocación";
    case "healing":
      return "Cicatrización";
    case "second_stage":
      return "Segunda fase";
    case "prosthetic":
      return "Fase protésica";
    case "follow_up":
      return "Controles";
    default:
      return phase;
  }
}

/**
 * Convención: moduleEntityType para el TreatmentLink polimórfico.
 * Ej: "implant-surgical-record", "implant-prosthetic-phase".
 */
export function implantPhaseToModuleEntityType(
  phase: ImplantTreatmentLinkPhase,
): string {
  switch (phase) {
    case "surgical":
      return "implant-surgical-record";
    case "healing":
      return "implant-healing-phase";
    case "second_stage":
      return "implant-second-stage-surgery";
    case "prosthetic":
      return "implant-prosthetic-phase";
    case "follow_up":
      return "implant-follow-up";
    default:
      return `implant-${phase}`;
  }
}

export const treatmentLinkUpsertSchema = z.object({
  moduleEntityType: z.string().min(1).max(80),
  moduleSessionId: z.string().min(1),
  treatmentSessionId: z.string().min(1),
  notes: z.string().max(1000).nullable().optional(),
});

export type TreatmentLinkUpsertInput = z.infer<typeof treatmentLinkUpsertSchema>;
