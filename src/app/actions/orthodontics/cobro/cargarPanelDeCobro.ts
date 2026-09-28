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
import { cobranzaDelCasoUnificada, type CobranzaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { normalizarOrthoBillingMode, ORTHO_BILLING_MODE_LABELS, type OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { cargarCargosDeControlDelCaso } from "@/lib/orthodontics/cobranza-controles-db";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { leerConfigDeCobro, type ConfigDeCobro } from "@/lib/orthodontics/cobro/config-db";
import { leerBillingDelCaso, type BillingDelCaso } from "@/lib/orthodontics/cobro/caso-db";
import { borradorInicialDelCaso } from "@/lib/orthodontics/cobro/borrador-factura";
import type { BorradorDeFactura } from "@/components/dashboard/factura-ficha-rediseno/datos";
import { listarExtrasDelCaso, type ExtraDelCaso } from "@/lib/orthodontics/cobro/extras-db";
import { listarPromesasDelCaso, type PromesaDePago } from "@/lib/orthodontics/cobro/promesas-db";
import { calcularRecargo, diasEntre } from "@/lib/orthodontics/cobro/reglas";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro } from "./_ctx";
import { precioDeColocacionDelCatalogo } from "@/lib/orthodontics/catalog-procedures";
import { controlesPorCobrarDe, type ControlPorCobrar } from "@/lib/orthodontics/cobro/controles-por-cobrar";
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

export type { ControlPorCobrar };

export interface PanelDeCobro {
  patientId: string;
  /** ws1-t4 #77 — en «Pago por control», los controles con factura sin pagar, del más viejo al más nuevo. Vacío en «Precio total». */
  controlesPorCobrar: ControlPorCobrar[];
  invoiceId: string | null;
  invoice: FacturaResumen | null;
  /** Las condiciones crudas de la factura (para F7, precargar el editor de plan). */
  condiciones: CondicionesPago | null;
  cobranza: CobranzaDelCaso | null;
  /** Ola 2 (ws1-t1) — modo CON EL QUE NACIÓ este caso (no el default actual de la clínica). */
  billingMode: OrthoBillingMode;
  billingModeLabel: string;
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
  /**
   * ronda 3 (ws1-t2, H9): con qué arranca «Abrir plan de pago» / «Abrir
   * factura de colocación/enganche» — concepto (técnica), precio de
   * referencia del caso y doctor tratante, en vez de un editor en blanco.
   * Editable siempre: solo evita partir de cero.
   */
  borradorInicial: BorradorDeFactura;
}

export async function cargarPanelDeCobro(treatmentPlanId: string): Promise<ActionResult<PanelDeCobro>> {
  const ctxResult = await getOrthoBillingActionContext("billing.view");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const casoResult = await loadCasoParaCobro({ ctx, treatmentPlanId });
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;

  const [redisenoFacturas, clinica, billingDelCaso, config, extras, promesas, billingModeCrudo] = await Promise.all([
    menuDosNivelesEncendido(ctx.clinicId),
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { cfdiTaxMode: true, timezone: true } }),
    leerBillingDelCaso(treatmentPlanId, ctx.clinicId),
    leerConfigDeCobro(ctx.clinicId),
    listarExtrasDelCaso(treatmentPlanId, ctx.clinicId),
    listarPromesasDelCaso(treatmentPlanId, ctx.clinicId),
    cargarModoDeCobro(ctx.clinicId, treatmentPlanId),
  ]);
  const billingMode = normalizarOrthoBillingMode(billingModeCrudo);
  // Solo en PAGO_POR_CONTROL el borrador es la colocación, y solo ahí hace falta el catálogo.
  const precioColocacion = billingMode === "PAGO_POR_CONTROL"
    ? await precioDeColocacionDelCatalogo(ctx.clinicId)
    : null;

  const base = {
    patientId: caso.patientId,
    billingDelCaso,
    config,
    extras,
    promesas,
    redisenoFacturas,
    clinicTaxMode: clinica?.cfdiTaxMode ?? null,
    puedeConfigurarPolitica: ROLES_DE_DIRECCION.has(ctx.role),
    billingMode,
    billingModeLabel: ORTHO_BILLING_MODE_LABELS[billingMode],
    borradorInicial: borradorInicialDelCaso(caso, billingMode === "PAGO_POR_CONTROL", precioColocacion),
  };

  const zonaHoraria = clinica?.timezone || "America/Mexico_City";

  let invoice: { id: string; invoiceNumber: string | null; total: number; paid: number; balance: number; status: string; payments: Array<{ amount: unknown; method: string | null }> } | null = null;
  if (caso.invoiceId) {
    invoice = await prisma.invoice.findFirst({
      where: { id: caso.invoiceId, clinicId: ctx.clinicId },
      select: { id: true, invoiceNumber: true, total: true, paid: true, balance: true, status: true, payments: { select: { amount: true, method: true } } },
    });
    if (!invoice) return fail("La factura del tratamiento ya no existe");
  }

  const [condicionesResult, saldoAFavorPrevio, cargosControl] = await Promise.all([
    invoice ? leerCondicionesDeFacturas(prisma, { clinicId: ctx.clinicId, invoiceIds: [invoice.id] }) : Promise.resolve({ porFactura: new Map<string, CondicionesPago>() }),
    getPatientCreditBalance(ctx.clinicId, caso.patientId),
    billingMode === "PAGO_POR_CONTROL" ? cargarCargosDeControlDelCaso(ctx.clinicId, treatmentPlanId) : Promise.resolve([]),
  ]);

  const condiciones = invoice ? condicionesResult.porFactura.get(invoice.id) ?? null : null;
  // ws1-t10 (H·F "Factura cancelada") — una factura CANCELLED no cuenta como
  // deuda del caso (mismo criterio que cobranza-db.ts): el total cancelado
  // no se sigue anunciando como pendiente.
  const facturaVigente = invoice && invoice.status !== "CANCELLED" ? invoice : null;
  const cobranza = cobranzaDelCasoUnificada({
    modo: billingMode,
    facturaPrincipal: facturaVigente ? { condiciones, totalFactura: facturaVigente.total, cobros: facturaVigente.payments } : null,
    cargosControl,
    saldoAFavorPrevio,
    ahora: new Date(),
    zonaHoraria,
  });

  const hoy = hoyEnZona(new Date(), zonaHoraria);
  const cuotaVencida = cobranza?.cuotaDeHoy?.estado === "vencida" ? cobranza.cuotaDeHoy : null;
  const recargoSugerido = cuotaVencida
    ? calcularRecargo(config.lateFee, cuotaVencida.falta, cuotaVencida.vencimiento ? diasEntre(cuotaVencida.vencimiento, hoy) : 0)
    : 0;

  const controlesPorCobrar = controlesPorCobrarDe(cargosControl);

  return ok({
    ...base,
    controlesPorCobrar,
    invoiceId: caso.invoiceId,
    invoice: invoice ? { id: invoice.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total, paid: invoice.paid, balance: invoice.balance, status: invoice.status } : null,
    condiciones,
    cobranza,
    recargoSugerido,
  });
}
