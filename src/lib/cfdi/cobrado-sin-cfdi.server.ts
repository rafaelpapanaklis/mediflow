// Junta los datos del reporte «Cobrado sin CFDI» (ws1-t8, F-09). Las reglas viven en
// cobrado-sin-cfdi.ts; aquí solo se lee, siempre con el clinicId de la sesión.
//
// `cfdi_records."paymentId"` (CFDI por pago, sql/cfdi-pagos-a-plazos.sql) NO está en el schema de
// Prisma a propósito (ver lib/invoices/cfdi-pago-db.ts): se lee con SQL crudo y solo si la
// columna existe. Sin ella, todo CFDI es de factura completa.
//
// Qué es cobro y qué es reembolso lo decide la definición ÚNICA de ingresos (la de Finanzas,
// lib/dinero/ingresos.server.ts): cada pago del mes se marca con `enDefinicionUnica`, y el
// dinero que entró sin nota (patient_credits) sale de la misma consulta que usa Finanzas.
// Si ese criterio cambia (por ejemplo, el anticipo de una cita cancelada, C-01), el reporte
// cambia con él sin tocar nada aquí (ws1-t4, auditoría de uso C-38 y C-39).

import { prisma } from "@/lib/prisma";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { columnaPagoListaParaCfdi } from "@/lib/invoices/cfdi-pago-db";
import { anticipoCobradoCreditWhere } from "@/lib/caja";
import { ingresoPaymentWhere, reembolsoPaymentWhere } from "@/lib/dinero/ingresos.server";
import { armarReporte, type AnticipoSinNota, type PagoDelMes, type ReporteCobradoSinCfdi } from "./cobrado-sin-cfdi";

const TZ_DEFECTO = "America/Mexico_City";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** [desde, hasta) del mes «YYYY-MM» en la zona de la clínica. */
export function rangoDelMes(mes: string, tz: string): { desde: Date; hasta: Date } {
  const [y, m] = mes.split("-").map(Number);
  const sigY = m === 12 ? y + 1 : y;
  const sigM = m === 12 ? 1 : m + 1;
  return { desde: tzLocalToUtc(`${y}-${pad(m)}-01`, 0, 0, tz), hasta: tzLocalToUtc(`${sigY}-${pad(sigM)}-01`, 0, 0, tz) };
}

export function fechaLocalEn(tz: string) {
  return (d: Date) => {
    const p = getTzParts(d, tz);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  };
}

export async function reporteCobradoSinCfdi(clinicId: string, mes: string): Promise<ReporteCobradoSinCfdi> {
  // Regla (c): sin clínica no se consulta (un undefined borraría el filtro de tenant).
  if (!clinicId) throw new Error("reporteCobradoSinCfdi: falta clinicId");
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true, cfdiTaxMode: true } });
  const tz = clinic?.timezone || TZ_DEFECTO;
  const { desde, hasta } = rangoDelMes(mes, tz);

  const paidAt = { gte: desde, lt: hasta };
  const [pagos, ingresos, reembolsos, anticiposSinNota] = await Promise.all([
    prisma.payment.findMany({
      // Payment no tiene clinicId: el tenant va por la nota (mismo criterio que Caja).
      where: { paidAt, invoice: { clinicId } },
      select: {
        id: true, paidAt: true, amount: true, method: true, refundMethod: true,
        invoice: { select: { id: true, invoiceNumber: true, status: true, balance: true, cfdiUuid: true, taxRate: true, taxIncluded: true } },
      },
      orderBy: { paidAt: "asc" },
      take: 5000,
    }),
    // Los MISMOS filtros que Finanzas: qué pago es cobro y cuál reembolso.
    prisma.payment.findMany({ where: ingresoPaymentWhere(clinicId, paidAt), select: { id: true }, take: 5000 }),
    prisma.payment.findMany({ where: reembolsoPaymentWhere(clinicId, paidAt), select: { id: true }, take: 5000 }),
    anticiposSinNotaDelMes(clinicId, paidAt),
  ]);
  const enDefinicion = new Set([...ingresos, ...reembolsos].map((p) => p.id));

  const invoiceIds = Array.from(new Set(pagos.map((p) => p.invoice.id)));
  const porFactura = new Map<string, string[]>();
  const porPago = new Map<string, string>();
  if (invoiceIds.length > 0) {
    if (await columnaPagoListaParaCfdi(prisma)) {
      const filas = await prisma.$queryRaw<{ invoiceId: string; paymentId: string | null; status: string }[]>`
        SELECT "invoiceId", "paymentId", "status" FROM "cfdi_records"
         WHERE "clinicId" = ${clinicId} AND "invoiceId" = ANY(${invoiceIds}::text[])`;
      for (const f of filas) {
        if (f.paymentId) porPago.set(f.paymentId, f.status);
        else porFactura.set(f.invoiceId, [...(porFactura.get(f.invoiceId) ?? []), f.status]);
      }
    } else {
      const filas = await prisma.cfdiRecord.findMany({
        where: { clinicId, invoiceId: { in: invoiceIds } },
        select: { invoiceId: true, status: true },
      });
      for (const f of filas) {
        if (!f.invoiceId) continue;
        porFactura.set(f.invoiceId, [...(porFactura.get(f.invoiceId) ?? []), f.status]);
      }
    }
  }

  return armarReporte({
    mes,
    pagos: pagos.map((p): PagoDelMes => ({
      ...p,
      enDefinicionUnica: enDefinicion.has(p.id),
      invoice: { ...p.invoice, invoiceNumber: p.invoice.invoiceNumber ?? null },
    })),
    anticiposSinNota,
    cfdi: { porFactura, porPago },
    modoClinica: clinic?.cfdiTaxMode,
    fechaLocal: fechaLocalEn(tz),
  });
}

/**
 * El dinero que entró sin nota en el mes (anticipo por Mercado Pago, excedente de un cobro
 * automático): la misma consulta con la que Finanzas lo cuenta como ingreso (C-39).
 * Tolerante: sin el libro de saldo a favor, nada.
 */
async function anticiposSinNotaDelMes(clinicId: string, creditDate: { gte: Date; lt: Date }): Promise<AnticipoSinNota[]> {
  try {
    const filas = await prisma.patientCredit.findMany({
      where: anticipoCobradoCreditWhere(clinicId, creditDate),
      select: { id: true, amount: true, creditDate: true, source: true },
      orderBy: { creditDate: "asc" },
      take: 5000,
    });
    return filas.map((f) => ({ id: f.id, amount: Number(f.amount) || 0, creditDate: f.creditDate, source: f.source }));
  } catch (e) {
    console.warn("[cfdi:cobrado-sin-cfdi] no se pudieron leer los anticipos sin nota:", (e as Error)?.message);
    return [];
  }
}

/** El mes en curso en la zona de la clínica, «YYYY-MM». */
export function mesActual(tz: string | null | undefined, ahora = new Date()): string {
  const p = getTzParts(ahora, tz || TZ_DEFECTO);
  return `${p.year}-${pad(p.month)}`;
}
