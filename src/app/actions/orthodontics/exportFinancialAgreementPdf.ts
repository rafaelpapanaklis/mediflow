"use server";
// Ortodoncia — datos del CONVENIO DE PAGO en PDF (ws1-t4, 29-sep-2026).
// Lo sirve GET /api/orthodontics/payment-plans/[id]/financial-agreement-pdf.
//
// Por qué «Imprimir convenio» no usaba esta ruta: la action original leía
// `OrthoPaymentPlan`/`OrthoInstallment` — las tablas del sistema viejo que la
// decisión 1 de la arquitectura de cobro dejó de leer (el dinero vive en la
// factura a plazos del tratamiento). El cobro nuevo no tiene id de
// OrthoPaymentPlan que pasarle, así que se armó una ventana about:blank con
// HTML plano. Ahora la ruta es la misma y el `[id]` puede ser:
//   · el id del CASO (orthodontic_treatment_plans) — lo que manda el cobro;
//   · el id de un OrthoPaymentPlan viejo — la ficha vieja sigue funcionando,
//     se resuelve a su caso y el convenio sale de la factura del caso igual.
// El dinero se lee con `cargarPanelDeCobro`, lo MISMO que pinta la pantalla
// de cobro: el papel no puede decir otra cosa que la pantalla.
//
// Permiso: `billing.view` (es dinero, no expediente) + visibilidad del
// paciente; ambos los exige `cargarPanelDeCobro`. `clinicId` de la sesión.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { techniqueLabel } from "@/lib/orthodontics/consent-texts";
import { cargarCargosDeControlDelCaso } from "@/lib/orthodontics/cobranza-controles-db";
import { buscarPrecioControlOrto } from "@/lib/orthodontics/catalog-procedures";
import { leerCondicionesDelConvenio } from "@/lib/orthodontics/cobro/condiciones-convenio-db";
import { leerResponsableParaCfdi } from "@/lib/orthodontics/responsable-fiscal-db";
import { labelParentesco } from "@/lib/consent/default-signer";
import { cargarMembreteOrto } from "@/lib/orthodontics/pdf/membrete-orto-db";
import { armarConvenio, type ConvenioPdfData, type ResponsableDelPago } from "@/lib/orthodontics/pdf/convenio";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import type { CuotaConEstado } from "@/lib/invoices/plan-de-pagos";
import { cargarPanelDeCobro } from "./cobro/cargarPanelDeCobro";
import { auditOrtho, getOrthoBillingActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export type FinancialAgreementPdfData = ConvenioPdfData;

const entrada = z
  .object({
    id: z.string().min(1).optional(),
    treatmentPlanId: z.string().min(1).optional(),
    paymentPlanId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.id || v.treatmentPlanId || v.paymentPlanId), "Falta el caso");

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** El id que llega → id del caso de ESTA clínica (o null). */
async function resolverCaso(clinicId: string, id: string): Promise<string | null> {
  const caso = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id, clinicId, deletedAt: null },
    select: { id: true },
  });
  if (caso) return caso.id;
  try {
    const viejo = await prisma.orthoPaymentPlan.findFirst({
      where: { id, clinicId },
      select: { treatmentPlanId: true },
    });
    return viejo?.treatmentPlanId ?? null;
  } catch (e) {
    if (esRelacionAusente(e)) return null;
    throw e;
  }
}

export async function exportFinancialAgreementPdf(
  input: unknown,
): Promise<ActionResult<FinancialAgreementPdfData>> {
  const auth = await getOrthoBillingActionContext("billing.view");
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("Sesión sin clínica");

  const parsed = entrada.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const idPedido = (parsed.data.treatmentPlanId ?? parsed.data.id ?? parsed.data.paymentPlanId)!;

  const treatmentPlanId = await resolverCaso(ctx.clinicId, idPedido);
  if (!treatmentPlanId) return fail("Caso no encontrado");

  // Permiso billing.view + visibilidad del paciente + el dinero, igual que la pantalla.
  const panelR = await cargarPanelDeCobro(treatmentPlanId);
  if (isFailure(panelR)) return panelR;
  const panel = panelR.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      technique: true,
      estimatedDurationMonths: true,
      installedAt: true,
      treatingDoctorId: true,
      responsibleGuardianId: true,
      diagnosis: { select: { diagnosedById: true } },
      patient: {
        select: {
          firstName: true, lastName: true, phone: true, email: true, address: true,
          rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true,
        },
      },
    },
  });
  if (!plan) return fail("Caso no encontrado");

  const porControl = panel.billingMode === "PAGO_POR_CONTROL";
  // Dos tandas: el membrete ya lanza 3 consultas por su cuenta y el pooler se
  // satura por encima de ~7 a la vez (CLAUDE.md, «Base de datos»).
  const [membrete, nombreTecnica, condiciones] = await Promise.all([
    cargarMembreteOrto({
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      doctorId: plan.treatingDoctorId ?? plan.diagnosis?.diagnosedById ?? null,
    }),
    cargarNombreDeTecnica(ctx.clinicId, plan.id),
    leerCondicionesDelConvenio(ctx.clinicId),
  ]);
  const [guardian, cargos, precioControl] = await Promise.all([
    plan.responsibleGuardianId
      ? prisma.guardian.findFirst({
          where: { id: plan.responsibleGuardianId, clinicId: ctx.clinicId, deletedAt: null },
          select: { fullName: true, parentesco: true, phone: true, email: true, address: true },
        })
      : Promise.resolve(null),
    porControl ? cargarCargosDeControlDelCaso(ctx.clinicId, plan.id) : Promise.resolve([]),
    porControl ? buscarPrecioControlOrto(ctx.clinicId).catch(() => null) : Promise.resolve(null),
  ]);

  let responsable: ResponsableDelPago;
  if (guardian) {
    const fiscales = panel.invoiceId
      ? await leerResponsableParaCfdi(ctx.clinicId, panel.invoiceId).catch(() => null)
      : null;
    const f = fiscales?.responsable?.fiscales;
    responsable = {
      esElPaciente: false,
      nombre: guardian.fullName,
      relacion: labelParentesco(guardian.parentesco),
      telefono: guardian.phone || null,
      correo: guardian.email ?? null,
      direccion: guardian.address ?? null,
      rfc: f?.rfc || null,
      razonSocial: f?.nombre || null,
      regimenFiscal: f?.regimen || null,
      cp: f?.cp || null,
    };
  } else {
    const p = plan.patient;
    responsable = {
      esElPaciente: true,
      nombre: `${p.firstName} ${p.lastName}`.trim(),
      relacion: null,
      telefono: p.phone ?? null,
      correo: p.email ?? null,
      direccion: p.address ?? null,
      rfc: p.rfcPaciente ?? null,
      razonSocial: p.razonSocialPac ?? null,
      regimenFiscal: p.regimenFiscalPac ?? null,
      cp: p.cpPaciente ?? null,
    };
  }

  // «Precio total»: el calendario completo, con su estado, exactamente como la pantalla.
  const cuotas: CuotaConEstado[] =
    !porControl && panel.cobranza
      ? [...panel.cobranza.pagadas, ...panel.cobranza.vencidas, ...panel.cobranza.proximas]
      : [];

  const factura = panel.invoice && panel.invoice.status !== "CANCELLED"
    ? { numero: panel.invoice.invoiceNumber, total: panel.invoice.total, pagado: panel.invoice.paid, saldo: panel.invoice.balance }
    : null;

  const data = armarConvenio({
    membrete,
    treatmentPlanId: plan.id,
    modo: panel.billingMode,
    tecnica: techniqueLabel(plan.technique, nombreTecnica),
    duracionMeses: plan.estimatedDurationMonths ?? null,
    colocacion: plan.installedAt ? plan.installedAt.toISOString() : null,
    factura,
    condicionesPago: panel.condiciones,
    cuotas,
    saldoAFavor: panel.cobranza?.saldoAFavor ?? 0,
    precioPorControl: precioControl?.basePrice ?? null,
    cargosDeControl: cargos
      .filter((c) => c.status !== "CANCELLED")
      .map((c) => ({ folio: c.invoiceNumber, vencimiento: c.vencimiento, total: c.total, pagado: c.pagado })),
    hoy: hoyEnZona(new Date(), membrete.zonaHoraria),
    descuento: panel.billingDelCaso.discountLabel
      ? { etiqueta: panel.billingDelCaso.discountLabel, porcentaje: panel.billingDelCaso.discountPct }
      : null,
    recargo: panel.config.lateFee,
    reposicionesIncluidas: panel.billingDelCaso.includedReplacementsTotal,
    responsable,
    condicionesGuardadas: condiciones.texto,
  });

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.REPORT_FINANCIAL_AGREEMENT_PDF,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    meta: { exportedAt: membrete.emitidoEl, folio: data.folio, pedidoCon: idPedido === plan.id ? "caso" : "planViejo" },
  });

  return ok(data);
}
