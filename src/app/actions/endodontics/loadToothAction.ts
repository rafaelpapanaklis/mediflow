"use server";
// Endodontics — server action que carga el ToothCenterViewData de un
// diente específico para que EndodonticsTab pueda re-fetchear cuando
// el usuario cambia de selección sin un round-trip server full-page.
//
// Auth: getEndoActionContext valida que el usuario pertenece a la
// clínica + que el módulo Endodoncia está activo. patientId además
// se valida via loadPatientForEndo (RLS deny-all + clinicId match).

import {
  getEndoActionContext,
  isFailure,
  loadPatientForEndo,
} from "./_helpers";
import { loadEndoToothData } from "@/lib/helpers/loadEndoToothData";
import type { ToothCenterViewData } from "@/lib/types/endodontics";

export async function loadToothAction(
  patientId: string,
  toothFdi: number,
): Promise<ToothCenterViewData | null> {
  const ctxRes = await getEndoActionContext({ write: false });
  if (isFailure(ctxRes)) return null;
  const { ctx } = ctxRes.data;

  const patientRes = await loadPatientForEndo({ ctx, patientId });
  if (isFailure(patientRes)) return null;

  if (!Number.isInteger(toothFdi) || toothFdi < 11 || toothFdi > 48) {
    return null;
  }

  return loadEndoToothData({
    clinicId: ctx.clinicId,
    patientId,
    toothFdi,
  });
}
