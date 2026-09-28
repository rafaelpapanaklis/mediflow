"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F7, cambiar el plan a mitad del
// tratamiento. Las CONDICIONES en sí (enganche/mensualidades/frecuencia) se
// guardan con `guardarCondiciones` de siempre (PUT /api/invoices/[id]/condiciones,
// sin tocarlo — ese endpoint no deja bitácora, hallazgo F7 del reporte de
// alcance). Esta action solo dice QUÉ cambió y POR QUÉ, después de que el
// PUT ya confirmó.

import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro, auditarCobro } from "./_ctx";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { isFailure, ok, type ActionResult } from "../result";

export async function auditarCambioDePlan(args: {
  treatmentPlanId: string;
  motivo: string;
  antes: CondicionesPago;
  despues: CondicionesPago;
}): Promise<ActionResult<{ registrado: true }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.edit");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;

  await auditarCobro({
    ctx,
    action: "cambiar-plan-de-pago",
    entityId: args.treatmentPlanId,
    meta: { motivo: args.motivo.trim().slice(0, 500), antes: args.antes, despues: args.despues },
  });

  return ok({ registrado: true });
}
