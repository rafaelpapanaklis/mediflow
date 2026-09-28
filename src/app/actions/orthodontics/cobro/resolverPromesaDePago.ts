"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F12, cerrar una promesa (se cumplió o
// se canceló). Nunca sobre una ya resuelta (resolverPromesaDePago en
// promesas-db.ts lo hace atómico con el WHERE).

import { getCobroActionContext, loadCasoParaCobro, auditarCobro } from "./_ctx";
import { resolverPromesaDePago as resolverEnDb } from "@/lib/orthodontics/cobro/promesas-db";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function resolverPromesaDePago(args: {
  treatmentPlanId: string;
  promiseId: string;
  resultado: "cumplida" | "cancelada";
}): Promise<ActionResult<{ resuelto: true }>> {
  const ctxResult = await getCobroActionContext("billing.charge");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;

  const r = await resolverEnDb({ id: args.promiseId, clinicId: ctx.clinicId, resultado: args.resultado });
  if (!r.ok) return fail(r.sinTabla ? "Falta aplicar sql/ortodoncia-cobro.sql" : "No se pudo resolver la promesa (¿ya estaba resuelta?)");

  await auditarCobro({ ctx, action: "resolver-promesa-de-pago", entityId: args.treatmentPlanId, meta: { promiseId: args.promiseId, resultado: args.resultado } });
  return ok({ resuelto: true });
}
