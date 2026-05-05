// Implants — sincronización con el odontograma compartido. Spec §8.4.
//
// Cuando se crea un implante, el diente correspondiente se marca con
// state = "IMPLANTE" en `odontogram_entries`. El estado del odontograma
// existente acepta este valor (`src/components/dashboard/odontogram/odontogram-data.ts`).
// El color del diente refleja `currentStatus` del implante vía CSS.

import type { ImplantStatus } from "@prisma/client";

export type OdontogramImplantState = "IMPLANTE";

/**
 * Mapping de currentStatus a clase CSS para el odontograma. Permite
 * que el componente compartido aplique color sin hardcodear lógica
 * implant-específica.
 *
 * Spec §1.5, §11 codificación cromática:
 *   azul → cicatrizando
 *   verde → en función
 *   amarillo → control próximo
 *   naranja → complicación
 *   rojo → fracaso
 *   gris → removido
 */
export function odontogramColorClassFor(status: ImplantStatus): string {
  switch (status) {
    case "PLACED":
    case "OSSEOINTEGRATING":
    case "UNCOVERED":
      return "implant-tooth--healing";
    case "LOADED_DEFINITIVE":
    case "FUNCTIONAL":
      return "implant-tooth--functional";
    case "LOADED_PROVISIONAL":
    case "PLANNED":
      return "implant-tooth--scheduled";
    case "COMPLICATION":
      return "implant-tooth--complication";
    case "FAILED":
      return "implant-tooth--failed";
    case "REMOVED":
      return "implant-tooth--removed";
  }
}

/** Estado canónico que va en `odontogram_entries.state`. */
export const ODONTOGRAM_STATE_FOR_IMPLANT: OdontogramImplantState = "IMPLANTE";

/** Notas estructuradas para el campo `notes` del OdontogramEntry. */
export function buildOdontogramNotes(args: {
  brand: string;
  modelName: string;
  lotNumber: string;
  currentStatus: ImplantStatus;
}): string {
  return [
    `${args.brand} ${args.modelName}`,
    `Lote ${args.lotNumber}`,
    `Estado: ${args.currentStatus}`,
  ].join(" · ");
}
