"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F5 (extras aparte: reposición de
// bracket, retenedores, microtornillo…) + F11 (reposiciones incluidas). La
// factura del extra la crea el editor de facturas de SIEMPRE
// (`InvoiceEditorModal`, sin tocar `src/app/api/invoices/**`); esta action
// corre DESPUÉS de creada para: (a) ligarla al caso y (b) si el usuario
// marcó "es una reposición incluida", descontarla del cupo — de forma
// atómica (dos cobros a la vez no pueden gastar el mismo cupo dos veces).
//
// `incluida` es lo que decide QUIEN COBRA en el paso anterior (ve cuántas
// quedan y decide si cobra o no cobra el concepto); esta action no adivina
// el precio ni fuerza $0 en la factura — eso lo escribe quien la crea.

import { prisma } from "@/lib/prisma";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro, auditarCobro } from "./_ctx";
import { vincularExtraAlCaso } from "@/lib/orthodontics/cobro/extras-db";
import { consumirReposicionIncluida } from "@/lib/orthodontics/cobro/caso-db";
import { fail, isFailure, ok, type ActionResult } from "../result";

export interface RegistrarExtraResultado {
  vinculado: boolean;
  fueIncluida: boolean;
  reposicionesRestantes: number;
}

export async function registrarExtraCobrado(args: {
  treatmentPlanId: string;
  invoiceId: string;
  esReposicionIncluida: boolean;
}): Promise<ActionResult<RegistrarExtraResultado>> {
  const ctxResult = await getOrthoBillingActionContext("billing.charge");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;

  const invoice = await prisma.invoice.findFirst({ where: { id: args.invoiceId, clinicId: ctx.clinicId }, select: { id: true, patientId: true } });
  if (!invoice) return fail("La factura no existe o es de otra clínica");
  if (invoice.patientId !== caso.patientId) return fail("La factura no es de este paciente");

  const vinculo = await vincularExtraAlCaso({ invoiceId: args.invoiceId, treatmentPlanId: args.treatmentPlanId, clinicId: ctx.clinicId });

  let fueIncluida = false;
  let reposicionesRestantes = 0;
  if (args.esReposicionIncluida) {
    const consumo = await consumirReposicionIncluida(args.treatmentPlanId, ctx.clinicId);
    fueIncluida = consumo.fueIncluida;
    reposicionesRestantes = consumo.restantes;
  }

  await auditarCobro({
    ctx,
    action: "registrar-extra-cobrado",
    entityId: args.treatmentPlanId,
    meta: { invoiceId: args.invoiceId, vinculado: vinculo.ok, esReposicionIncluida: args.esReposicionIncluida, fueIncluida },
  });

  return ok({ vinculado: vinculo.ok, fueIncluida, reposicionesRestantes });
}
