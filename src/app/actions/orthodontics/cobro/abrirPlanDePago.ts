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

  // ws1-t10 (H·F "Factura cancelada") — si la factura que el caso tenía
  // ligada está CANCELADA, no cuenta como "ya tiene un plan abierto": antes
  // cancelar la factura del tratamiento dejaba el caso atascado para
  // siempre, sin poder abrir el plan de verdad. Una factura VIGENTE (de
  // cualquier otro estado) sigue bloqueando: solo un plan a la vez.
  let invoiceAnteriorCancelada = false;
  if (caso.invoiceId) {
    const anterior = await prisma.invoice.findFirst({
      where: { id: caso.invoiceId, clinicId: ctx.clinicId },
      select: { status: true },
    });
    if (anterior?.status !== "CANCELLED") return fail("Este caso ya tiene un plan de pago abierto");
    invoiceAnteriorCancelada = true;
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: args.invoiceId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true },
  });
  if (!invoice) return fail("La factura no existe o es de otra clínica");
  if (invoice.patientId !== caso.patientId) return fail("La factura no es de este paciente");

  // Solo si SIGUE sin plan vigente (defensivo contra doble clic / dos
  // pestañas): la misma factura cancelada de antes, o ninguna.
  const { count } = await prisma.orthodonticTreatmentPlan.updateMany({
    where: {
      id: args.treatmentPlanId,
      clinicId: ctx.clinicId,
      invoiceId: invoiceAnteriorCancelada ? caso.invoiceId : null,
    },
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
