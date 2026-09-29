"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F9. El % en sí se aplica a mano en el
// editor de factura (que ya trae descuento por línea y global — no se
// reinventa aquí). Esta action solo ANOTA cuál de las reglas configuradas
// (`guardarConfigDeCobro`) se usó en este caso, para que la ficha lo enseñe
// consistente sin que cada quien recuerde el número de memoria.

import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro, auditarCobro } from "./_ctx";
import { guardarDescuentoDelCaso } from "@/lib/orthodontics/cobro/caso-db";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function elegirDescuentoDelCaso(args: {
  treatmentPlanId: string;
  ruleId: string | null;
  label: string | null;
  pct: number | null;
}): Promise<ActionResult<{ guardado: true }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.create");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;

  const resultado = await guardarDescuentoDelCaso(args.treatmentPlanId, ctx.clinicId, {
    ruleId: args.ruleId,
    label: args.label ? args.label.trim().slice(0, 60) : null,
    pct: args.pct != null ? Math.min(100, Math.max(0, Number(args.pct) || 0)) : null,
  });
  if (!resultado.ok) {
    return fail(resultado.sinTabla ? "Falta aplicar sql/ortodoncia-cobro.sql: el descuento no se guardó" : "No se pudo guardar el descuento del caso");
  }

  await auditarCobro({ ctx, action: "elegir-descuento-del-caso", entityId: args.treatmentPlanId, patientId: casoResult.data.patientId, meta: { ruleId: args.ruleId, pct: args.pct } });
  return ok({ guardado: true });
}
