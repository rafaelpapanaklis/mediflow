"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): TODO lo que necesita la Sección F para
// pintarse, en una sola llamada. `SectionFinance` (client component) la
// invoca directamente al montar y después de cada acción — mismo patrón de
// "autofetch" que ya usa `AvisoAnticiposPorRevisar` en Caja, pero por
// server action en vez de una ruta GET nueva (menos superficie que tocar).
//
// Permiso: `billing.view` — leer cobranza es facturación, no expediente
// clínico (ver `_ctx.ts` sobre por qué esta parte no usa `medicalRecord.*`).
//
// No llama a `cargarCobranzaDelCaso` (el cargador con I/O de `cobranza-db.ts`,
// Ola 0): esta action YA necesita leer `invoice` y `condiciones` para el
// recargo (F10) y el resumen de la factura, así que repetir esas mismas 2
// consultas en el cargador dedicado sería una vuelta de más. Se usa la
// versión PURA (`cobranzaDelCaso`, sin I/O, EXACTAMENTE el mismo contrato de
// Ola 0, sin tocarlo) con el mismo input que arma el cargador original.

import { prisma } from "@/lib/prisma";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { cobranzaDelCaso, type CobranzaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { leerConfigDeCobro, type ConfigDeCobro } from "@/lib/orthodontics/cobro/config-db";
import { leerBillingDelCaso, type BillingDelCaso } from "@/lib/orthodontics/cobro/caso-db";
import { listarExtrasDelCaso, type ExtraDelCaso } from "@/lib/orthodontics/cobro/extras-db";
import { listarPromesasDelCaso, type PromesaDePago } from "@/lib/orthodontics/cobro/promesas-db";
import { calcularRecargo, diasEntre } from "@/lib/orthodontics/cobro/reglas";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro } from "./_ctx";
import { fail, isFailure, ok, type ActionResult } from "../result";

const ROLES_DE_DIRECCION = new Set(["SUPER_ADMIN", "ADMIN"]);

export interface FacturaResumen {
  id: string;
  invoiceNumber: string | null;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

export interface PanelDeCobro {
  patientId: string;
  invoiceId: string | null;
  invoice: FacturaResumen | null;
  /** Las condiciones crudas de la factura (para F7, precargar el editor de plan). */
  condiciones: CondicionesPago | null;
  cobranza: CobranzaDelCaso | null;
  /** Recargo por atraso sugerido HOY sobre `cobranza.cuotaDeHoy`, o 0. Nunca se cobra solo. */
  recargoSugerido: number;
  billingDelCaso: BillingDelCaso;
  config: ConfigDeCobro;
  extras: ExtraDelCaso[];
  promesas: PromesaDePago[];
  /** `menuDosNivelesEncendido(clinicId)`: sin esto, la factura no ofrece "a plazos". */
  redisenoFacturas: boolean;
  clinicTaxMode: string | null;
  /** SUPER_ADMIN/ADMIN: puede cambiar la política de cobro de la clínica (F9/F10). */
  puedeConfigurarPolitica: boolean;
}

export async function cargarPanelDeCobro(treatmentPlanId: string): Promise<ActionResult<PanelDeCobro>> {
  const ctxResult = await getOrthoBillingActionContext("billing.view");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;

  const [redisenoFacturas, clinica, billingDelCaso, config, extras, promesas] = await Promise.all([
    menuDosNivelesEncendido(ctx.clinicId),
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { cfdiTaxMode: true, timezone: true } }),
    leerBillingDelCaso(treatmentPlanId, ctx.clinicId),
    leerConfigDeCobro(ctx.clinicId),
    listarExtrasDelCaso(treatmentPlanId, ctx.clinicId),
    listarPromesasDelCaso(treatmentPlanId, ctx.clinicId),
  ]);

  const base = {
    patientId: caso.patientId,
    billingDelCaso,
    config,
    extras,
    promesas,
    redisenoFacturas,
    clinicTaxMode: clinica?.cfdiTaxMode ?? null,
    puedeConfigurarPolitica: ROLES_DE_DIRECCION.has(ctx.role),
  };

  if (!caso.invoiceId) {
    return ok({ ...base, invoiceId: null, invoice: null, condiciones: null, cobranza: null, recargoSugerido: 0 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: caso.invoiceId, clinicId: ctx.clinicId },
    select: { id: true, invoiceNumber: true, total: true, paid: true, balance: true, status: true, payments: { select: { amount: true, method: true } } },
  });
  if (!invoice) return fail("La factura del tratamiento ya no existe");

  const zonaHoraria = clinica?.timezone || "America/Mexico_City";
  const [condicionesResult, saldoAFavorPrevio] = await Promise.all([
    leerCondicionesDeFacturas(prisma, { clinicId: ctx.clinicId, invoiceIds: [invoice.id] }),
    getPatientCreditBalance(ctx.clinicId, caso.patientId),
  ]);

  const condiciones = condicionesResult.porFactura.get(invoice.id) ?? null;
  const cobranza = cobranzaDelCaso({
    condiciones,
    totalFactura: invoice.total,
    cobros: invoice.payments,
    saldoAFavorPrevio,
    ahora: new Date(),
    zonaHoraria,
  });

  const hoy = hoyEnZona(new Date(), zonaHoraria);
  const cuotaVencida = cobranza.cuotaDeHoy?.estado === "vencida" ? cobranza.cuotaDeHoy : null;
  const recargoSugerido = cuotaVencida
    ? calcularRecargo(config.lateFee, cuotaVencida.falta, cuotaVencida.vencimiento ? diasEntre(cuotaVencida.vencimiento, hoy) : 0)
    : 0;

  return ok({
    ...base,
    invoiceId: caso.invoiceId,
    invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total, paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    condiciones,
    cobranza,
    recargoSugerido,
  });
}
