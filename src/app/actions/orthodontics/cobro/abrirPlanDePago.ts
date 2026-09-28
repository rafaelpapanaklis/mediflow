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
//
// X4 (dos pestañas): la liga es idempotente. Llamarla otra vez con la MISMA
// factura devuelve ok; si otra pestaña ya ligó OTRA factura vigente, esta
// pestaña recibe esa (ok + `aviso`) y la que acaba de crear se cancela si es
// una copia sin consecuencias (`plan-de-pago-duplicado.ts`) — o se avisa
// para cancelarla a mano. Antes de crear, `comprobarPlanDePagoLibre` ya
// frena el caso normal (pestaña vieja) sin que se cree la segunda factura.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "@/lib/anticipos/panel.server";
import { revalidateAfter } from "@/lib/cache/revalidate";
import type { AuthContext } from "@/lib/auth-context";
import {
  NOTA_CANCELADA_POR_DUPLICADA,
  avisoDePlanYaAbierto,
  decidirFacturaDuplicada,
} from "@/lib/orthodontics/cobro/plan-de-pago-duplicado";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro, auditarCobro, type CasoParaCobro } from "./_ctx";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function abrirPlanDePago(args: {
  treatmentPlanId: string;
  invoiceId: string;
}): Promise<ActionResult<{ invoiceId: string; aviso?: string }>> {
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
    // X4: la MISMA factura otra vez (doble clic, reintento) — ya está hecho.
    if (anterior && anterior.status !== "CANCELLED" && caso.invoiceId === args.invoiceId) {
      return ok({ invoiceId: args.invoiceId });
    }
    // X4: otra pestaña ya ligó OTRA factura vigente — esta recibe esa.
    if (anterior && anterior.status !== "CANCELLED") {
      return quedarseConLaVigente({ ctx, caso, vigenteId: caso.invoiceId, duplicadaId: args.invoiceId });
    }
    if (anterior?.status !== "CANCELLED") return fail("Este caso ya tiene un plan de pago abierto");
    invoiceAnteriorCancelada = true;
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: args.invoiceId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, status: true, orthodonticTreatmentPlan: { select: { id: true } } },
  });
  if (!invoice) return fail("La factura no existe o es de otra clínica");
  if (invoice.patientId !== caso.patientId) return fail("La factura no es de este paciente");
  // ws1-t4 #75: ahora también se LIGA una factura que ya existía. Una cancelada
  // no puede ser el plan, y la que ya es el plan de OTRO caso no se comparte
  // (dos casos sobre la misma factura contarían su dinero dos veces).
  if (invoice.status === "CANCELLED") return fail("Esa factura está cancelada: no puede ser el plan de pago");
  if (invoice.orthodonticTreatmentPlan && invoice.orthodonticTreatmentPlan.id !== args.treatmentPlanId) {
    return fail("Esa factura ya es el plan de pago de otro caso");
  }

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
  if (count === 0) {
    // X4: perdió la carrera contra otra pestaña entre la lectura y la liga.
    const ahora = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: args.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      select: { invoiceId: true },
    });
    if (ahora?.invoiceId === args.invoiceId) return ok({ invoiceId: args.invoiceId });
    if (ahora?.invoiceId) {
      const vigente = await prisma.invoice.findFirst({
        where: { id: ahora.invoiceId, clinicId: ctx.clinicId },
        select: { status: true },
      });
      if (vigente && vigente.status !== "CANCELLED") {
        return quedarseConLaVigente({ ctx, caso, vigenteId: ahora.invoiceId, duplicadaId: args.invoiceId });
      }
    }
    return fail("Este caso ya tiene un plan de pago abierto");
  }

  await auditarCobro({
    ctx,
    action: "abrir-plan-de-pago",
    entityId: args.treatmentPlanId,
    meta: { invoiceId: args.invoiceId },
  });

  return ok({ invoiceId: args.invoiceId });
}

/**
 * X4 — el caso ya tiene su factura vigente (`vigenteId`) y esta pestaña trae
 * otra (`duplicadaId`) recién creada. Se devuelve la vigente; la duplicada se
 * cancela solo si `decidirFacturaDuplicada` lo permite, con la MISMA escritura
 * condicional que POST /api/invoices/[id]/cancel usa para «sin nada pagado»
 * (si entre tanto entró un pago o se timbró, no se cancela).
 */
async function quedarseConLaVigente(args: {
  ctx: AuthContext;
  caso: CasoParaCobro;
  vigenteId: string;
  duplicadaId: string;
}): Promise<ActionResult<{ invoiceId: string; aviso: string }>> {
  const { ctx, caso, vigenteId, duplicadaId } = args;
  const clinicId = ctx.clinicId;
  if (!clinicId) return fail("Este caso ya tiene un plan de pago abierto");

  const [vigente, duplicada] = await Promise.all([
    prisma.invoice.findFirst({ where: { id: vigenteId, clinicId }, select: { invoiceNumber: true } }),
    prisma.invoice.findFirst({
      where: { id: duplicadaId, clinicId },
      select: {
        invoiceNumber: true, patientId: true, status: true, paid: true, cfdiUuid: true,
        appointmentId: true, createdAt: true, notes: true,
        orthodonticTreatmentPlan: { select: { id: true } },
      },
    }),
  ]);

  const decision = decidirFacturaDuplicada({
    duplicada: duplicada
      ? { ...duplicada, ligadaACaso: duplicada.orthodonticTreatmentPlan?.id ?? null }
      : null,
    patientIdDelCaso: caso.patientId,
    ahora: new Date(),
  });

  let cancelada = false;
  if (decision.cancelar && duplicada) {
    const { count } = await prisma.invoice.updateMany({
      where: { id: duplicadaId, clinicId, status: "PENDING", paid: { lte: 0 }, cfdiUuid: null, appointmentId: null },
      data: {
        status: "CANCELLED",
        notes: duplicada.notes ? `${duplicada.notes}\n${NOTA_CANCELADA_POR_DUPLICADA}` : NOTA_CANCELADA_POR_DUPLICADA,
      },
    });
    cancelada = count === 1;
    if (cancelada) {
      // Igual que la cancelación normal: el link de Mercado Pago y el anticipo
      // pendiente de esa factura no pueden quedar vivos. Ninguno de los dos lanza.
      await cerrarLinksDeFactura({ clinicId, invoiceId: duplicadaId });
      await cerrarAnticiposDePanel({ clinicId, invoiceId: duplicadaId });
      revalidateAfter("invoices");
      revalidatePath(`/dashboard/patients/${caso.patientId}`);
    }
  }

  await auditarCobro({
    ctx,
    action: "abrir-plan-de-pago-duplicado",
    entityId: caso.id,
    meta: {
      invoiceIdVigente: vigenteId,
      invoiceIdDuplicada: duplicadaId,
      duplicadaCancelada: cancelada,
      ...(decision.motivo ? { motivoNoCancelada: decision.motivo } : {}),
    },
  });

  return ok({
    invoiceId: vigenteId,
    aviso: avisoDePlanYaAbierto({
      numeroVigente: vigente?.invoiceNumber ?? null,
      numeroDuplicada: duplicada?.invoiceNumber ?? null,
      duplicadaCancelada: cancelada,
    }),
  });
}
