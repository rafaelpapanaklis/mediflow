// H23 (QA ws1-t9) — pura, sin React ni "use server": separada de
// RanuraCita.tsx para poder probarla sin arrastrar prisma/server-only (la
// action que resuelve de verdad vive detrás de "use server").
//
// Con la Agenda cayéndose a 502 a medio vuelo, `getTreatmentPlanIdForAppointment`
// a veces resolvía `undefined` en vez de rechazar — `isFailure(res)` sobre eso
// truena (`res.ok` de un `undefined`) y se llevaba toda la ranura de la cita.
import { isFailure, type ActionResult } from "@/app/actions/orthodontics/result";

export interface RanuraCitaState {
  treatmentPlanId: string | null;
  canOpenClinicalCard: boolean;
}

export const ESTADO_VACIO_RANURA_CITA: RanuraCitaState = {
  treatmentPlanId: null,
  canOpenClinicalCard: false,
};

export type RanuraCitaResult = ActionResult<{
  treatmentPlanId: string | null;
  canOpenClinicalCard: boolean;
}>;

/** Cualquier `res` vacío o mal formado cae al estado vacío, nunca revienta. */
export function resolverEstadoRanuraCita(
  res: RanuraCitaResult | null | undefined,
): RanuraCitaState {
  if (!res || isFailure(res)) return ESTADO_VACIO_RANURA_CITA;
  return {
    treatmentPlanId: res.data.treatmentPlanId,
    canOpenClinicalCard: res.data.canOpenClinicalCard,
  };
}
