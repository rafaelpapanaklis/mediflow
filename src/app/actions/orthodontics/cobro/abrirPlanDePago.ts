"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F1/F2. La factura del tratamiento (con
// su precio único y, si aplica, enganche + mensualidades) se crea con el
// editor de facturas de SIEMPRE (`InvoiceEditorModal`, POST /api/invoices +
// PUT /api/invoices/[id]/condiciones — sin tocar ninguno de los dos). Esta
// action solo hace lo que esos endpoints no saben hacer: ligar esa factura
// al caso (`orthodontic_treatment_plans.invoiceId`, columna de Ola 0).
//
// Un caso solo abre UN plan: si ya tiene `invoiceId`, se rechaza (F7 —
// "cambiar el plan a mitad" — edita las CONDICIONES de esa misma factura,
// nunca reemplaza cuál es).

import { prisma } from "@/lib/prisma";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro, auditarCobro } from "./_ctx";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function abrirPlanDePago(args: {
  treatmentPlanId: string;
  invoiceId: string;
}): Promise<ActionResult<{ invoiceId: string }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.create");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;
  if (caso.invoiceId) return fail("Este caso ya tiene un plan de pago abierto");

  const invoice = await prisma.invoice.findFirst({
    where: { id: args.invoiceId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true },
  });
  if (!invoice) return fail("La factura no existe o es de otra clínica");
  if (invoice.patientId !== caso.patientId) return fail("La factura no es de este paciente");

  // Solo si SIGUE sin plan (defensivo contra doble clic / dos pestañas).
  const { count } = await prisma.orthodonticTreatmentPlan.updateMany({
    where: { id: args.treatmentPlanId, clinicId: ctx.clinicId, invoiceId: null },
    data: { invoiceId: args.invoiceId },
  });
  if (count === 0) return fail("Este caso ya tiene un plan de pago abierto");

  await auditarCobro({
    ctx,
    action: "abrir-plan-de-pago",
    entityId: args.treatmentPlanId,
    meta: { invoiceId: args.invoiceId },
  });

  return ok({ invoiceId: args.invoiceId });
}
