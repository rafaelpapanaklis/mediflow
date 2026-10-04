// Junta los datos del reporte «Cobrado sin CFDI» (ws1-t8, F-09). Las reglas viven en
// cobrado-sin-cfdi.ts; aquí solo se lee, siempre con el clinicId de la sesión.
//
// `cfdi_records."paymentId"` (CFDI por pago, sql/cfdi-pagos-a-plazos.sql) NO está en el schema de
// Prisma a propósito (ver lib/invoices/cfdi-pago-db.ts): se lee con SQL crudo y solo si la
// columna existe. Sin ella, todo CFDI es de factura completa.

import { prisma } from "@/lib/prisma";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { columnaPagoListaParaCfdi } from "@/lib/invoices/cfdi-pago-db";
import { armarReporte, type PagoDelMes, type ReporteCobradoSinCfdi } from "./cobrado-sin-cfdi";

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

  const pagos = await prisma.payment.findMany({
    // Payment no tiene clinicId: el tenant va por la nota (mismo criterio que Caja).
    where: { paidAt: { gte: desde, lt: hasta }, invoice: { clinicId } },
    select: {
      id: true, paidAt: true, amount: true, method: true,
      invoice: { select: { id: true, invoiceNumber: true, status: true, balance: true, cfdiUuid: true, taxRate: true, taxIncluded: true } },
    },
    orderBy: { paidAt: "asc" },
    take: 5000,
  });

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
    pagos: pagos.map((p): PagoDelMes => ({ ...p, invoice: { ...p.invoice, invoiceNumber: p.invoice.invoiceNumber ?? null } })),
    cfdi: { porFactura, porPago },
    modoClinica: clinic?.cfdiTaxMode,
    fechaLocal: fechaLocalEn(tz),
  });
}

/** El mes en curso en la zona de la clínica, «YYYY-MM». */
export function mesActual(tz: string | null | undefined, ahora = new Date()): string {
  const p = getTzParts(ahora, tz || TZ_DEFECTO);
  return `${p.year}-${pad(p.month)}`;
}
