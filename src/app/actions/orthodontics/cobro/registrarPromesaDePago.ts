"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F12. Se anota fecha y monto; el
// recordatorio automático (WhatsApp/portal) es W-block y no es de esta
// parte — la promesa queda visible en la Sección F para que recepción la
// revise al día siguiente desde la lista de vencidas.

import { getCobroActionContext, loadCasoParaCobro, auditarCobro } from "./_ctx";
import { crearPromesaDePago, type PromesaDePago } from "@/lib/orthodontics/cobro/promesas-db";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function registrarPromesaDePago(args: {
  treatmentPlanId: string;
  amount: number;
  promisedDate: string;
  note?: string | null;
}): Promise<ActionResult<PromesaDePago>> {
  const ctxResult = await getCobroActionContext("billing.charge");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;

  const amount = Number(args.amount);
  if (!isFinite(amount) || amount <= 0) return fail("El monto de la promesa debe ser mayor a 0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.promisedDate)) return fail("Fecha de promesa inválida");

  const resultado = await crearPromesaDePago({
    treatmentPlanId: args.treatmentPlanId,
    clinicId: ctx.clinicId,
    amount,
    promisedDate: args.promisedDate,
    note: args.note ? args.note.trim().slice(0, 300) : null,
    createdByUserId: ctx.userId,
  });
  if (!resultado.ok || !resultado.promesa) {
    return fail(resultado.sinTabla ? "Falta aplicar sql/ortodoncia-cobro.sql: la promesa no se guardó" : "No se pudo registrar la promesa");
  }

  await auditarCobro({ ctx, action: "registrar-promesa-de-pago", entityId: args.treatmentPlanId, meta: { amount, promisedDate: args.promisedDate } });
  return ok(resultado.promesa);
}
