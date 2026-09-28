"use server";
// Ortodoncia — X4: antes de que el editor de facturas CREE la factura del
// plan, se pregunta al servidor si el caso sigue sin plan vigente. Frena el
// caso normal de dos pestañas (una abierta desde antes de que la otra ligara
// su factura) sin que llegue a existir la segunda factura, ni su correo, ni su
// link de pago. Solo lee; la garantía final la da la liga condicional de
// `abrirPlanDePago` (y su manejo de la duplicada).

import { prisma } from "@/lib/prisma";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro } from "./_ctx";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function comprobarPlanDePagoLibre(args: {
  treatmentPlanId: string;
}): Promise<ActionResult<{ libre: boolean; invoiceNumber: string | null }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.create");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;
  if (!caso.invoiceId) return ok({ libre: true, invoiceNumber: null });

  const ligada = await prisma.invoice.findFirst({
    where: { id: caso.invoiceId, clinicId: ctx.clinicId },
    select: { status: true, invoiceNumber: true },
  });
  // Una ligada CANCELADA no cuenta (mismo criterio que abrirPlanDePago).
  if (ligada?.status === "CANCELLED") return ok({ libre: true, invoiceNumber: null });
  return ok({ libre: false, invoiceNumber: ligada?.invoiceNumber ?? null });
}
