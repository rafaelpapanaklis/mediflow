// ═══════════════════════════════════════════════════════════════════════════
// CARGADOR de `cobranza-caso.ts` (ws1-t1, Ola 0) — el I/O que arma su input
// puro a partir de la base. `clinicId` SIEMPRE de la sesión, nunca del
// cliente: quien llama lo saca de `loadClinicSession()`, nunca de un query
// param o un body.
//
// Tolera que las columnas de sql/ortodoncia-nucleo.sql (`invoiceId`,
// `treatingDoctorId`) todavía no estén aplicadas en esta base: P2021/P2022 se
// leen como «sin resumen todavía», no tumban la pantalla — mismo espíritu que
// `src/lib/patient-credit.ts` y las reglas de dev.108.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { cobranzaDelCaso, type CobranzaDelCaso } from "./cobranza-caso";

/** Códigos Prisma de "tabla/columna inexistente" — igual que patient-credit.ts. */
function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface CargarCobranzaArgs {
  clinicId: string;
  patientId: string;
  treatmentPlanId: string;
  /** IANA de la clínica (ej. "America/Mexico_City"). */
  zonaHoraria: string;
  /** Para pruebas; por defecto `new Date()`. */
  ahora?: Date;
}

/**
 * Arma el resumen de cobranza de un caso, o `null` cuando no hay nada que
 * mostrar todavía: el caso no existe (o es de otra clínica/paciente), no
 * tiene factura abierta (`invoiceId` nulo — decisión 1: sin factura no hay
 * plan que cobrar), o las columnas del núcleo aún no se aplicaron en esta
 * base.
 *
 * Menos de 7 consultas por `Promise.all` (regla del pooler): 1 para el caso
 * + 3 en paralelo (condiciones de la factura, factura con sus pagos, saldo a
 * favor del paciente) = 4 en total.
 */
export async function cargarCobranzaDelCaso(
  args: CargarCobranzaArgs,
): Promise<CobranzaDelCaso | null> {
  const { clinicId, patientId, treatmentPlanId } = args;
  if (!clinicId || !patientId || !treatmentPlanId) return null;

  let plan: { invoiceId: string | null } | null;
  try {
    plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: treatmentPlanId, clinicId, patientId, deletedAt: null },
      select: { invoiceId: true },
    });
  } catch (e) {
    if (esRelacionAusente(e)) return null;
    throw e;
  }
  if (!plan?.invoiceId) return null;
  const invoiceId = plan.invoiceId;

  const [condicionesResult, invoice, saldoAFavorPrevio] = await Promise.all([
    leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds: [invoiceId] }),
    prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId },
      select: {
        total: true,
        payments: { select: { amount: true, method: true } },
      },
    }),
    getPatientCreditBalance(clinicId, patientId),
  ]);
  if (!invoice) return null;

  return cobranzaDelCaso({
    condiciones: condicionesResult.porFactura.get(invoiceId) ?? null,
    totalFactura: invoice.total,
    cobros: invoice.payments,
    saldoAFavorPrevio,
    ahora: args.ahora ?? new Date(),
    zonaHoraria: args.zonaHoraria,
  });
}
