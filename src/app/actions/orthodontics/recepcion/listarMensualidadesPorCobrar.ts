"use server";
// Ortodoncia — Recepción (ws1-t5, Ola 1): R2 (lista de mensualidades por
// cobrar en Caja) y R3 (aviso en Hoy, filtrando solo las vencidas). Una sola
// action para ambas pantallas — mismo dato, una sola lectura.
//
// R5 (cobrar a hermanos de una vez): cada fila trae `responsibleGuardianId` /
// `responsibleGuardianName` (A11, "Alta del caso" — sql/ortodoncia-alta-caso.sql)
// para que `ListaMensualidades.tsx` agrupe las de un mismo responsable. No se
// cobra aquí de verdad: agrupar y enseñar el total combinado es lo que hace
// esta parte; cobrar sigue siendo un cobro por factura, como hoy.
//
// Nada de `Promise.all` por caso: se leen TODOS los casos con invoiceId en 2
// consultas en lote (condiciones + facturas con sus pagos) y se calcula
// `cobranzaDelCaso` (puro, Ola 0, sin tocar) en memoria por cada uno. Total:
// 4 consultas para la clínica entera, sin importar cuántos casos tenga.
//
// No se calcula `saldoAFavor` por paciente aquí (exigiría una consulta por
// paciente, y esta lista no lo necesita: `estadoDelPlan` decide qué cuota
// vence/vale sin mirar el saldo a favor, que solo se resta a lo que falta
// pagar — irrelevante para "¿qué mensualidades hay que cobrar hoy?").

import { prisma } from "@/lib/prisma";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { cobranzaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { ok, isFailure, type ActionResult } from "../result";
import { getRecepcionActionContext, esRelacionAusente } from "./_ctx";

const HORIZONTE_DIAS = 7;

export interface MensualidadPorCobrar {
  treatmentPlanId: string;
  patientId: string;
  patientName: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceTotal: number;
  invoicePaid: number;
  invoiceBalance: number;
  invoiceStatus: string;
  monto: number;
  vencimiento: string; // "YYYY-MM-DD"
  estado: "vencida" | "hoy" | "proxima";
  responsibleGuardianId: string | null;
  responsibleGuardianName: string | null;
}

export interface MensualidadesPorCobrar {
  items: MensualidadPorCobrar[];
  /** `menuDosNivelesEncendido(clinicId)`: qué vestido usa el `PaymentModal` al cobrar. */
  redisenoFacturas: boolean;
}

export async function listarMensualidadesPorCobrar(): Promise<ActionResult<MensualidadesPorCobrar>> {
  const ctxResult = await getRecepcionActionContext("billing.view");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const redisenoFacturas = await menuDosNivelesEncendido(ctx.clinicId);

  let planes: Array<{
    id: string;
    invoiceId: string | null;
    patientId: string;
    responsibleGuardianId: string | null;
    responsibleGuardian: { fullName: string } | null;
    patient: { firstName: string; lastName: string };
  }>;
  try {
    planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: {
        clinicId: ctx.clinicId,
        deletedAt: null,
        invoiceId: { not: null },
        AND: relatedPatientVisibilityAnd(viewer),
      },
      select: {
        id: true,
        invoiceId: true,
        patientId: true,
        responsibleGuardianId: true,
        responsibleGuardian: { select: { fullName: true } },
        patient: { select: { firstName: true, lastName: true } },
      },
    });
  } catch (e) {
    if (esRelacionAusente(e)) return ok({ items: [], redisenoFacturas });
    throw e;
  }
  if (planes.length === 0) return ok({ items: [], redisenoFacturas });

  const invoiceIds = planes.map((p) => p.invoiceId).filter((id): id is string => !!id);

  const [clinica, condicionesResult, invoices] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } }),
    leerCondicionesDeFacturas(prisma, { clinicId: ctx.clinicId, invoiceIds }),
    prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, clinicId: ctx.clinicId },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        paid: true,
        balance: true,
        status: true,
        payments: { select: { amount: true, method: true } },
      },
    }),
  ]);

  const zonaHoraria = clinica?.timezone || "America/Mexico_City";
  const ahora = new Date();
  const hoy = hoyEnZona(ahora, zonaHoraria);
  const limite = new Date(ahora);
  limite.setDate(limite.getDate() + HORIZONTE_DIAS);
  const limiteISO = hoyEnZona(limite, zonaHoraria);

  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const salida: MensualidadPorCobrar[] = [];

  for (const plan of planes) {
    if (!plan.invoiceId) continue;
    const invoice = invoiceById.get(plan.invoiceId);
    if (!invoice) continue;

    const resumen = cobranzaDelCaso({
      condiciones: condicionesResult.porFactura.get(plan.invoiceId) ?? null,
      totalFactura: invoice.total,
      cobros: invoice.payments,
      saldoAFavorPrevio: 0,
      ahora,
      zonaHoraria,
    });

    const cuota = resumen.cuotaDeHoy;
    if (!cuota || !cuota.vencimiento) continue;

    let estado: MensualidadPorCobrar["estado"] | null = null;
    if (cuota.estado === "vencida") estado = "vencida";
    else if (cuota.vencimiento === hoy) estado = "hoy";
    else if (cuota.vencimiento <= limiteISO) estado = "proxima";
    if (!estado) continue;

    salida.push({
      treatmentPlanId: plan.id,
      patientId: plan.patientId,
      patientName: [plan.patient.firstName, plan.patient.lastName].filter(Boolean).join(" ").trim(),
      invoiceId: plan.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceTotal: invoice.total,
      invoicePaid: invoice.paid,
      invoiceBalance: invoice.balance,
      invoiceStatus: invoice.status,
      monto: cuota.falta,
      vencimiento: cuota.vencimiento,
      estado,
      responsibleGuardianId: plan.responsibleGuardianId,
      responsibleGuardianName: plan.responsibleGuardian?.fullName ?? null,
    });
  }

  const ORDEN: Record<MensualidadPorCobrar["estado"], number> = { vencida: 0, hoy: 1, proxima: 2 };
  salida.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.vencimiento.localeCompare(b.vencimiento));

  return ok({ items: salida, redisenoFacturas });
}
