"use server";
// Ortodoncia — cambiar el COSTO de un caso desde la ventana «Plan de tratamiento» (ws1-t12). El costo del plan y el
// total de la factura del tratamiento son el mismo dato: si el caso YA tiene factura (modo «Precio total»), esta
// acción edita la factura con las MISMAS reglas que «editar factura con pagos» (`editar-factura-core.ts`, también
// aplicadas en PATCH /api/invoices/[id]): nunca por debajo de lo ya pagado (saldo a favor incluido), nunca
// timbrada ni cancelada, y con plan a plazos AVISA que las mensualidades se recalculan — sin `planAvisado` no
// guarda y devuelve el aviso para que quien edita lo confirme.
//
// Permiso: `billing.edit` (el mismo que editar una factura). `clinicId` de la sesión; el caso y el paciente se
// comprueban contra la clínica y su visibilidad. Sin factura (o en «Pago por control», donde el costo es solo una
// referencia) solo se guarda el costo de referencia del caso.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { CODIGO_PLAN_SE_RECALCULA, decidirEdicion, motivoParaNoEditar } from "@/lib/invoices/editar-factura-core";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "@/lib/anticipos/panel.server";
import { montoParaTexto } from "@/lib/movimientos-paciente/textos";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { propuestaParaNuevoTotal } from "@/lib/orthodontics/cobro/nuevo-total-de-factura";
import { MAX_COSTO_TOTAL } from "@/lib/orthodontics/alta-caso-formulario";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro } from "./_ctx";
import { fail, isFailure, ok, type ActionResult } from "../result";

export type ResultadoDeCambiarCosto =
  | { estado: "guardado"; total: number }
  /** Con plan a plazos las mensualidades se recalculan: se pide confirmar (reenviar con `planAvisado: true`). */
  | { estado: "avisar"; texto: string };

export async function cambiarCostoDelCaso(input: {
  treatmentPlanId: string;
  nuevoTotal: number;
  planAvisado?: boolean;
}): Promise<ActionResult<ResultadoDeCambiarCosto>> {
  const auth = await getOrthoBillingActionContext("billing.edit");
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const clinicId = ctx.clinicId;
  if (!clinicId) return fail("No se pudo identificar tu clínica");

  const nuevo = Number(input?.nuevoTotal);
  if (!Number.isFinite(nuevo) || nuevo <= 0 || nuevo > MAX_COSTO_TOTAL) return fail("Escribe un costo mayor que cero.");
  const totalNuevo = Math.round(nuevo * 100) / 100;

  const casoR = await loadCasoParaCobro({ ctx, treatmentPlanId: input.treatmentPlanId });
  if (isFailure(casoR)) return casoR;
  const caso = casoR.data;

  const modo = normalizarOrthoBillingMode(await cargarModoDeCobro(clinicId, caso.id));
  const factura = caso.invoiceId && modo === "PRECIO_TOTAL" ? await prisma.invoice.findFirst({ where: { id: caso.invoiceId, clinicId } }) : null;

  // Sin factura del tratamiento (o «Pago por control»): el costo es la referencia del caso.
  if (!factura) {
    await prisma.orthodonticTreatmentPlan.updateMany({ where: { id: caso.id, clinicId }, data: { totalCostMxn: totalNuevo } });
    await registrarMovimientoDelPaciente({
      clinicId,
      userId: ctx.userId,
      patientId: caso.patientId,
      entityType: "orthodontic-plan",
      entityId: caso.id,
      action: "update",
      texto: "Cambió el costo de referencia del caso de ortodoncia",
      campos: ["totalCostMxn"],
    });
    revalidatePath(`/dashboard/patients/${caso.patientId}`);
    return ok({ estado: "guardado", total: totalNuevo });
  }

  const no = motivoParaNoEditar(factura);
  if (no) return fail(no);

  const propuesta = propuestaParaNuevoTotal(factura, totalNuevo);
  const { porFactura } = await leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds: [factura.id] });
  const decision = decidirEdicion({
    factura,
    totalNuevo: propuesta.total,
    condiciones: porFactura.get(factura.id) ?? null,
    planAvisado: input.planAvisado === true,
  });
  if ("error" in decision) {
    if (decision.codigo === CODIGO_PLAN_SE_RECALCULA) return ok({ estado: "avisar", texto: decision.error });
    return fail(decision.error);
  }

  // La regla OTRA VEZ en el mismo UPDATE, contra lo que se leyó: sin CFDI, no cancelada, el mismo estado y lo
  // pagado igual (si entró un cobro entre la lectura y aquí, no se guarda sobre cifras viejas).
  const datos: Record<string, unknown> = {
    items: propuesta.items,
    subtotal: propuesta.subtotal,
    discount: propuesta.discount,
    total: propuesta.total,
    balance: decision.balance,
  };
  if (decision.status !== factura.status) datos.status = decision.status;
  if (decision.liquida) datos.paidAt = new Date();
  if (decision.reabre) datos.paidAt = null;
  const { count } = await prisma.invoice.updateMany({
    where: {
      id: factura.id,
      clinicId,
      cfdiUuid: null,
      status: factura.status,
      NOT: { status: "CANCELLED" as const },
      paid: { equals: factura.paid, lte: propuesta.total },
    },
    data: datos as never,
  });
  if (count === 0) return fail("La factura cambió mientras la editabas (se cobró, se timbró o se canceló). Vuelve a abrir la ventana.");

  await prisma.orthodonticTreatmentPlan.updateMany({ where: { id: caso.id, clinicId }, data: { totalCostMxn: propuesta.total } });

  await registrarMovimientoDelPaciente({
    clinicId,
    userId: ctx.userId,
    patientId: caso.patientId,
    entityType: "invoice",
    entityId: factura.id,
    action: "update",
    texto: `Editó la factura ${factura.invoiceNumber} (total ${montoParaTexto(factura.total)} → ${montoParaTexto(propuesta.total)}) al cambiar el costo del caso de ortodoncia`,
    campos: ["total"],
    cambios: { total: { before: factura.total, after: propuesta.total }, balance: { before: factura.balance, after: decision.balance } },
  });

  // El saldo cambió: los links de Mercado Pago y los anticipos pedidos desde el panel piden un monto viejo.
  await cerrarLinksDeFactura({ clinicId, invoiceId: factura.id });
  await cerrarAnticiposDePanel({ clinicId, invoiceId: factura.id });
  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${caso.patientId}`);
  return ok({ estado: "guardado", total: propuesta.total });
}
