"use server";
// Ortodoncia — ws1-t4 #75: las facturas del paciente que se pueden LIGAR al
// caso como su plan de pago, en vez de crear otra (que dejaba dos facturas del
// mismo tratamiento). Solo lee. `clinicId` sale de la sesión; el paciente, del
// caso (nunca del cliente).

import { prisma } from "@/lib/prisma";
import { conceptoDeFactura, esFacturaLigable, ESTADOS_LIGABLES } from "@/lib/orthodontics/cobro/facturas-ligables";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro } from "./_ctx";
import { fail, isFailure, ok, type ActionResult } from "../result";

export interface FacturaLigable {
  id: string;
  invoiceNumber: string;
  concepto: string;
  total: number;
  paid: number;
  fecha: string;
}

export async function listarFacturasLigables(args: {
  treatmentPlanId: string;
}): Promise<ActionResult<{ facturas: FacturaLigable[] }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.create");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;

  const filas = await prisma.invoice.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: caso.patientId,
      status: { in: [...ESTADOS_LIGABLES] },
      appointmentId: null,
      orthodonticTreatmentPlan: null,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, invoiceNumber: true, items: true, total: true, paid: true, status: true, appointmentId: true, createdAt: true },
  });

  return ok({
    facturas: filas
      .filter((f) => esFacturaLigable({ status: f.status, appointmentId: f.appointmentId, ligadaACaso: null }))
      .map((f) => ({
        id: f.id,
        invoiceNumber: f.invoiceNumber,
        concepto: conceptoDeFactura(f.items),
        total: f.total,
        paid: f.paid,
        fecha: f.createdAt.toISOString(),
      })),
  });
}
