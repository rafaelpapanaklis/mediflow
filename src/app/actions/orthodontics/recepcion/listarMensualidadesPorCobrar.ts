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
import { hasPermission } from "@/lib/auth/permissions";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { cobranzaDelCasoUnificada, agruparVencidasPorFactura } from "@/lib/orthodontics/cobranza-caso";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { cargarModosDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { cargarCargosDeControlPorCasos } from "@/lib/orthodontics/cobranza-controles-db";
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
  /**
   * ronda 3 (ws1-t2, H7): cuántas cuotas vencidas trae `monto` (0 si `estado`
   * no es "vencida"). Antes esta lista solo enseñaba la cuota vencida más
   * vieja del caso, aunque hubiera más — «1 vencida · $6,000» en vez de
   * «2 vencidas · $8,000», como ya dicen el Tablero y Alertas.
   */
  cantidadVencidas: number;
  responsibleGuardianId: string | null;
  responsibleGuardianName: string | null;
}

export interface MensualidadesPorCobrar {
  items: MensualidadPorCobrar[];
  /** `menuDosNivelesEncendido(clinicId)`: qué vestido usa el `PaymentModal` al cobrar. */
  redisenoFacturas: boolean;
  /** ws1-t4: la sesión puede registrar pagos (billing.charge). Sin esto no se ofrece «Cobrar». */
  puedeCobrar: boolean;
  /** ws1-t4: Clinic.cfdiTaxMode, para la ventana completa de la factura que abre «Cobrar». */
  clinicTaxMode: string | null;
}

export async function listarMensualidadesPorCobrar(): Promise<ActionResult<MensualidadesPorCobrar>> {
  const ctxResult = await getRecepcionActionContext("billing.view");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const redisenoFacturas = await menuDosNivelesEncendido(ctx.clinicId);
  const puedeCobrar = hasPermission({ role: ctx.role as never, permissionsOverride: ctx.permissionsOverride }, "billing.charge");

  let planes: Array<{
    id: string;
    invoiceId: string | null;
    patientId: string;
    responsibleGuardianId: string | null;
    responsibleGuardian: { fullName: string } | null;
    patient: { firstName: string; lastName: string };
  }>;
  try {
    // Ola 2 (ws1-t1): ya no se filtra por `invoiceId: { not: null }` — un
    // caso en modo PAGO_POR_CONTROL puede deber (controles atendidos) SIN
    // haber abierto todavía la factura de colocación/enganche.
    planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: {
        clinicId: ctx.clinicId,
        deletedAt: null,
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
    if (esRelacionAusente(e)) return ok({ items: [], redisenoFacturas, puedeCobrar, clinicTaxMode: null });
    throw e;
  }
  if (planes.length === 0) return ok({ items: [], redisenoFacturas, puedeCobrar, clinicTaxMode: null });

  const invoiceIds = planes.map((p) => p.invoiceId).filter((id): id is string => !!id);
  const modosPorCaso = await cargarModosDeCobro(ctx.clinicId, planes.map((p) => p.id));
  const casosPorControl = planes.filter((p) => normalizarOrthoBillingMode(modosPorCaso.get(p.id) ?? null) === "PAGO_POR_CONTROL").map((p) => p.id);
  const cargosControlPorCaso = await cargarCargosDeControlPorCasos(ctx.clinicId, casosPorControl);

  const [clinica, condicionesResult, invoices] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true, cfdiTaxMode: true } }),
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
  const cargoByInvoiceId = new Map(
    Array.from(cargosControlPorCaso.values()).flat().map((c) => [c.invoiceId, c]),
  );
  const salida: MensualidadPorCobrar[] = [];

  // Datos de la factura de un `invoiceId`: la del control (si es uno) o la
  // principal del plan. Mismo criterio que antes (`invoice.balance` tal
  // cual, nunca recalculado — el control sí se recalcula porque no trae
  // `balance` propio).
  function datosDeFactura(invoiceId: string): { numero: string | null; total: number; pagado: number; estado: string; balance: number } | null {
    const cargoControl = cargoByInvoiceId.get(invoiceId);
    if (cargoControl) {
      return { numero: cargoControl.invoiceNumber, total: cargoControl.total, pagado: cargoControl.pagado, estado: cargoControl.status, balance: cargoControl.total - cargoControl.pagado };
    }
    const inv = invoiceById.get(invoiceId);
    if (!inv) return null;
    return { numero: inv.invoiceNumber, total: inv.total, pagado: inv.paid, estado: inv.status, balance: inv.balance };
  }

  for (const plan of planes) {
    const invoice = plan.invoiceId ? invoiceById.get(plan.invoiceId) : undefined;
    const modo = normalizarOrthoBillingMode(modosPorCaso.get(plan.id) ?? null);
    const resumen = cobranzaDelCasoUnificada({
      modo,
      facturaPrincipal: invoice != null && plan.invoiceId
        ? { condiciones: condicionesResult.porFactura.get(plan.invoiceId) ?? null, totalFactura: invoice.total, cobros: invoice.payments }
        : null,
      cargosControl: cargosControlPorCaso.get(plan.id) ?? [],
      saldoAFavorPrevio: 0,
      ahora,
      zonaHoraria,
    });
    if (!resumen) continue;

    const patientName = [plan.patient.firstName, plan.patient.lastName].filter(Boolean).join(" ").trim();

    // ronda 3 (ws1-t2, H7): TODO lo vencido del caso, no solo la cuota más
    // vieja — agrupado por factura (PAGO_POR_CONTROL puede deber de varias
    // facturas a la vez; nunca se suman entre sí, ver agruparVencidasPorFactura).
    if (resumen.vencidas.length > 0) {
      const grupos = agruparVencidasPorFactura(resumen.vencidas, plan.invoiceId);
      for (const grupo of grupos) {
        if (!grupo.vencimiento) continue;
        const datos = datosDeFactura(grupo.invoiceId);
        if (!datos) continue;
        salida.push({
          treatmentPlanId: plan.id,
          patientId: plan.patientId,
          patientName,
          invoiceId: grupo.invoiceId,
          invoiceNumber: datos.numero,
          invoiceTotal: datos.total,
          invoicePaid: datos.pagado,
          invoiceBalance: datos.balance,
          invoiceStatus: datos.estado,
          monto: grupo.monto,
          vencimiento: grupo.vencimiento,
          estado: "vencida",
          cantidadVencidas: grupo.cantidad,
          responsibleGuardianId: plan.responsibleGuardianId,
          responsibleGuardianName: plan.responsibleGuardian?.fullName ?? null,
        });
      }
      continue;
    }

    // Nada vencido todavía: la próxima cuota, si vence hoy o dentro del horizonte.
    const cuota = resumen.cuotaDeHoy;
    if (!cuota || !cuota.vencimiento) continue;

    let estado: "hoy" | "proxima" | null = null;
    if (cuota.vencimiento === hoy) estado = "hoy";
    else if (cuota.vencimiento <= limiteISO) estado = "proxima";
    if (!estado) continue;

    const facturaId = cuota.invoiceId ?? plan.invoiceId;
    if (!facturaId) continue;
    const datos = datosDeFactura(facturaId);
    if (!datos) continue;

    salida.push({
      treatmentPlanId: plan.id,
      patientId: plan.patientId,
      patientName,
      invoiceId: facturaId,
      invoiceNumber: datos.numero,
      invoiceTotal: datos.total,
      invoicePaid: datos.pagado,
      invoiceBalance: datos.balance,
      invoiceStatus: datos.estado,
      monto: cuota.falta,
      vencimiento: cuota.vencimiento,
      estado,
      cantidadVencidas: 0,
      responsibleGuardianId: plan.responsibleGuardianId,
      responsibleGuardianName: plan.responsibleGuardian?.fullName ?? null,
    });
  }

  const ORDEN: Record<MensualidadPorCobrar["estado"], number> = { vencida: 0, hoy: 1, proxima: 2 };
  salida.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.vencimiento.localeCompare(b.vencimiento));

  return ok({ items: salida, redisenoFacturas, puedeCobrar, clinicTaxMode: clinica?.cfdiTaxMode ?? null });
}
