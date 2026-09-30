"use server";
// Ortodoncia — Cobro (ws1-t10): el plan de pago se arma AL ABRIR el caso. El popup
// de alta (`DrawerNewCase`) abre el caso con `createTreatmentPlan` y, enseguida,
// llama a esta acción para crear la factura del tratamiento con las condiciones que
// se escribieron ahí (o la de colocación, en «Pago por control») y ligarla al caso.
//
// Es lo que antes hacían a mano, en tres pasos, el editor de facturas y
// `abrirPlanDePago`: aquí es UNA sola llamada al servidor. Las reglas viven en
// `crear-plan-del-caso.ts` (con tests); esto solo conecta la base.
//
// Si algo falla, el caso YA está abierto: se devuelve el motivo para decírselo a
// quien lo abrió, y la sección Cobro sigue ofreciendo «Abrir plan de pago».
//
// Permiso: `billing.create` (el mismo de crear una factura). Sin él, el caso se
// abrió igual y el plan queda pendiente para recepción; esta acción se niega.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import {
  InvoiceNumberExhaustedError,
  nextInvoiceNumber,
  withInvoiceNumberRetry,
} from "@/lib/invoices/next-invoice-number";
import { clinicInvoiceTaxDefaults } from "@/lib/invoice-totals";
import { aplicarSaldoAFavor } from "@/lib/patient-credit-aplicar";
import { guardarCondicionesDeFactura } from "@/lib/invoices/condiciones-pago-db";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { crearPlanDelCasoCore, type DepsDelPlan } from "@/lib/orthodontics/cobro/crear-plan-del-caso";
import type { PlanDePagoAlAbrir } from "@/lib/orthodontics/cobro/plan-al-abrir";
import { getOrthoBillingActionContext } from "../_helpers";
import { auditarCobro, loadCasoParaCobro } from "./_ctx";
import { abrirPlanDePago } from "./abrirPlanDePago";
import { conUnSoloMovimiento } from "@/lib/movimientos-paciente/una-accion";
import { fail, isFailure, ok, type ActionResult } from "../result";

type ResultadoDelPlanDePago = ActionResult<{ invoiceId: string; invoiceNumber: string | null; yaExistia: boolean; aviso?: string }>;

/**
 * `aperturaDelCaso`: esta llamada cierra la apertura de un caso a plazos (diagnóstico → plan → plan de pago). Las
 * anteriores dejaron sus filas solo en la bitácora; aquí se escribe UNA en Movimientos, «Abrió el caso de ortodoncia:
 * …», con todo el detalle. Solo banderas: las frases las pone el servidor. Sin ella, la llamada se comporta como siempre.
 */
export async function crearPlanDelCaso(args: {
  treatmentPlanId: string;
  aperturaDelCaso?: { diagnostico?: boolean; detalleDelPlan?: boolean };
} & PlanDePagoAlAbrir): Promise<ResultadoDelPlanDePago> {
  const ap = args?.aperturaDelCaso;
  if (!ap) return crearElPlanDePago(args, () => undefined);
  let base: { clinicId: string; userId: string; patientId: string; entityType: string; entityId: string; action: string } | null = null;
  return conUnSoloMovimiento(
    {
      titulo: "Abrió el caso de ortodoncia",
      detallesExtra: [
        ...(ap.diagnostico === true ? ["Registró el diagnóstico de ortodoncia"] : []),
        "Creó el plan de tratamiento de ortodoncia",
        ...(ap.detalleDelPlan === true ? ["Completó el plan de tratamiento de ortodoncia"] : []),
      ],
      filaBase: () => base,
    },
    () => crearElPlanDePago(args, (b) => { base = b; }),
  );
}

async function crearElPlanDePago(
  args: { treatmentPlanId: string } & PlanDePagoAlAbrir,
  conCaso: (base: { clinicId: string; userId: string; patientId: string; entityType: string; entityId: string; action: string }) => void,
): Promise<ResultadoDelPlanDePago> {
  const ctxResult = await getOrthoBillingActionContext("billing.create");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;
  // `clinicId` sale de la sesión; sin él no se consulta nada (clinicId: undefined no filtra).
  const clinicId = ctx.clinicId;
  if (!clinicId) return fail("No se pudo identificar tu clínica");

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId: args.treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;
  conCaso({ clinicId, userId: ctx.userId, patientId: caso.patientId, entityType: "orthodontic-plan", entityId: caso.id, action: "update" });

  const deps: DepsDelPlan = {
    facturaLigada: (invoiceId) =>
      prisma.invoice.findFirst({ where: { id: invoiceId, clinicId }, select: { id: true, invoiceNumber: true, status: true } }),

    modoDeCobro: async () => normalizarOrthoBillingMode(await cargarModoDeCobro(clinicId, caso.id)),

    esDoctorDeLaClinica: async (userId) =>
      (await prisma.user.findFirst({ where: { id: userId, clinicId, role: "DOCTOR" }, select: { id: true } })) !== null,

    impuestosDeLaClinica: async () => {
      const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { cfdiTaxMode: true } });
      return clinicInvoiceTaxDefaults(clinica?.cfdiTaxMode);
    },

    // Misma creación que POST /api/invoices: folio por máximo con reintento ante carrera y, después,
    // el saldo a favor del paciente ya descontado (no lanza nunca).
    crearFactura: async (f) => {
      try {
        const factura = await withInvoiceNumberRetry(async () =>
          prisma.invoice.create({
            data: {
              clinicId,
              patientId: f.patientId,
              invoiceNumber: await nextInvoiceNumber(clinicId),
              items: f.items,
              subtotal: f.subtotal,
              discount: f.discount,
              total: f.total,
              paid: 0,
              balance: f.total,
              status: "PENDING",
              notes: f.notes,
              dueDate: null,
              doctorId: f.doctorId,
              taxRate: f.taxRate,
              taxIncluded: f.taxIncluded,
            },
            select: { id: true, invoiceNumber: true, total: true },
          }),
        );
        const saldo = await aplicarSaldoAFavor({ clinicId, invoiceId: factura.id, userId: ctx.userId, origen: "creada" });
        return { id: factura.id, invoiceNumber: factura.invoiceNumber, total: Number(factura.total), anticipoAplicado: saldo.aplicado };
      } catch (e) {
        if (e instanceof InvoiceNumberExhaustedError) throw new Error(e.message);
        throw e;
      }
    },

    guardarCondiciones: async (invoiceId, condiciones) => {
      const g = await guardarCondicionesDeFactura(prisma, { invoiceId, clinicId, condiciones });
      return { sinTabla: g.sinTabla, fallo: g.fallo || g.ajena };
    },

    // `abrirPlanDePago` vuelve a comprobar clínica, paciente y duplicados (X4), y deja su bitácora.
    ligar: async (invoiceId) => {
      const r = await abrirPlanDePago({ treatmentPlanId: caso.id, invoiceId });
      return isFailure(r) ? { ok: false, error: r.error } : { ok: true, invoiceId: r.data.invoiceId, aviso: r.data.aviso };
    },
  };

  const r = await crearPlanDelCasoCore(deps, caso, {
    modoDeCobro: args.modoDeCobro,
    precioColocacion: args.precioColocacion,
    enganche: args.enganche,
    numPagos: args.numPagos,
    primerPago: args.primerPago,
  });
  if (r.ok === false) return fail(r.error);

  if (!r.yaExistia) {
    await auditarCobro({
      ctx,
      action: "crear-plan-al-abrir-caso",
      entityId: caso.id,
      patientId: caso.patientId,
      meta: { invoiceId: r.invoiceId, modoDeCobro: args.modoDeCobro, total: r.total },
    });
    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${caso.patientId}`);
  }
  return ok({ invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, yaExistia: r.yaExistia, ...(r.aviso ? { aviso: r.aviso } : {}) });
}
