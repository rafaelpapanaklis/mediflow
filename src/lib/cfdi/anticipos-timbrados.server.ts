// N-22 (segunda auditoría de uso): lo que lee la base para que un mismo ingreso nunca quede en
// dos CFDI. Las reglas en anticipos-timbrados.ts (puro). Siempre con el clinicId de la sesión;
// tolerante: si algo no se puede leer, no se saca nada de la global (el dinero sigue declarado).

import { prisma } from "@/lib/prisma";
import { FUENTE_APLICADO, FUENTE_EXCEDENTE } from "@/lib/patient-credit-core";
import { FUENTES_CREDITO_QUE_SON_INGRESO } from "@/lib/dinero/reembolsos";
import { columnaPagoListaParaCfdi } from "@/lib/invoices/cfdi-pago-db";
import { CFDI_CLAIM_PREFIX_FACTURA, type CubiertoEnOtroCfdi } from "./cobrado-sin-cfdi";
import { asignarFifo, type AplicacionSaldo, type EntradaSaldo } from "./anticipos-timbrados";

/** Misma constante que lib/anticipos/cita-cancelada.server.ts (sin importar el servicio entero). */
const FUENTE_CITA_CANCELADA = "cita_cancelada";
const FUENTES_MP: readonly string[] = FUENTES_CREDITO_QUE_SON_INGRESO;

type Fila = { id: string; amount: number; source: string; creditDate: Date; invoiceId: string | null; paymentId: string | null };

async function libroDe(clinicId: string, patientIds: string[]): Promise<Map<string, { entradas: EntradaSaldo[]; aplicaciones: AplicacionSaldo[] }>> {
  const out = new Map<string, { entradas: EntradaSaldo[]; aplicaciones: AplicacionSaldo[] }>();
  if (patientIds.length === 0) return out;
  const filas = await prisma.patientCredit.findMany({
    where: { clinicId, patientId: { in: patientIds } },
    select: { id: true, patientId: true, amount: true, source: true, creditDate: true, invoiceId: true, paymentId: true },
    take: 5000,
  });
  for (const f of filas as Array<Fila & { patientId: string }>) {
    const l = out.get(f.patientId) ?? { entradas: [], aplicaciones: [] };
    if (f.amount > 0) l.entradas.push({ id: f.id, fecha: f.creditDate, monto: f.amount, fuente: f.source, invoiceId: f.invoiceId, paymentId: f.paymentId });
    else if (f.source === FUENTE_APLICADO && f.amount < 0) l.aplicaciones.push({ id: f.id, fecha: f.creditDate, monto: -f.amount, paymentId: f.paymentId });
    out.set(f.patientId, l);
  }
  return out;
}

/** El origen de una entrada, como lo entiende el reporte (null = no sale de la global: no se sabe o no fue ingreso). */
function origenDe(e: EntradaSaldo): { tipo: CubiertoEnOtroCfdi["tipo"]; ref: string } | null {
  if (e.fuente === FUENTE_CITA_CANCELADA && e.invoiceId) return { tipo: "factura", ref: e.invoiceId };
  if (e.fuente === FUENTE_EXCEDENTE && e.paymentId) return { tipo: "pago", ref: e.paymentId };
  if (FUENTES_MP.includes(e.fuente)) return { tipo: "credito", ref: e.id };
  return null;
}

/**
 * Lo que ya ampara el CFDI de otra nota: el saldo a favor aplicado a una nota timbrada (o a un abono
 * con su propio CFDI), repartido sobre las entradas de las que salió.
 */
export async function cubiertosEnOtroCfdi(clinicId: string): Promise<CubiertoEnOtroCfdi[]> {
  if (!clinicId) return [];
  try {
    const anticipos = await prisma.payment.findMany({
      where: { method: "anticipo", invoice: { clinicId, status: { not: "CANCELLED" } } },
      select: { id: true, invoice: { select: { invoiceNumber: true, cfdiUuid: true, patientId: true } } },
      take: 5000,
    });
    if (anticipos.length === 0) return [];
    const conCfdiPropio = new Set<string>();
    if (await columnaPagoListaParaCfdi(prisma)) {
      const ids = anticipos.map((a) => a.id);
      const filas = await prisma.$queryRaw<{ paymentId: string }[]>`
        SELECT "paymentId" FROM "cfdi_records"
         WHERE "clinicId" = ${clinicId} AND "paymentId" = ANY(${ids}::text[]) AND "status" = 'valid'`;
      for (const f of filas) conCfdiPropio.add(f.paymentId);
    }
    const timbrados = new Map<string, { folio: string; patientId: string }>();
    for (const a of anticipos) {
      const uuid = a.invoice.cfdiUuid;
      const notaTimbrada = !!uuid && !uuid.startsWith(CFDI_CLAIM_PREFIX_FACTURA);
      if ((notaTimbrada || conCfdiPropio.has(a.id)) && a.invoice.patientId) {
        timbrados.set(a.id, { folio: a.invoice.invoiceNumber ?? "", patientId: a.invoice.patientId });
      }
    }
    if (timbrados.size === 0) return [];
    const libros = await libroDe(clinicId, Array.from(new Set(Array.from(timbrados.values()).map((t) => t.patientId))));
    const out: CubiertoEnOtroCfdi[] = [];
    for (const { entradas, aplicaciones } of Array.from(libros.values())) {
      const porId = new Map(entradas.map((e) => [e.id, e]));
      for (const t of asignarFifo(entradas, aplicaciones)) {
        const destino = t.aplicacionPaymentId ? timbrados.get(t.aplicacionPaymentId) : undefined;
        const e = porId.get(t.entradaId);
        const o = e ? origenDe(e) : null;
        if (destino && o) out.push({ ...o, monto: t.monto, folioDestino: destino.folio });
      }
    }
    return out;
  } catch (e) {
    console.warn("[cfdi:anticipos-timbrados] no se pudo leer el saldo a favor:", (e as Error)?.message);
    return [];
  }
}

/**
 * ¿Cuándo ENTRÓ el dinero de estos abonos «anticipo»? (para la confirmación de la global, C-49 / N-22).
 * Fecha de los cobros de la nota de origen (cita cancelada), del cobro (excedente) o de la entrada.
 */
export async function fechasDeOrigenDeAnticipos(
  clinicId: string,
  patientId: string | null | undefined,
  anticipoPaymentIds: readonly string[],
): Promise<Array<{ paidAt: Date; amount: number; method: string }>> {
  if (!clinicId || !patientId || anticipoPaymentIds.length === 0) return [];
  try {
    const libro = (await libroDe(clinicId, [patientId])).get(patientId);
    if (!libro) return [];
    const porId = new Map(libro.entradas.map((e) => [e.id, e]));
    const pedidos = new Set(anticipoPaymentIds);
    const tramos = asignarFifo(libro.entradas, libro.aplicaciones).filter((t) => t.aplicacionPaymentId && pedidos.has(t.aplicacionPaymentId));
    const facturas = Array.from(new Set(tramos.map((t) => porId.get(t.entradaId)).filter((e) => e?.fuente === FUENTE_CITA_CANCELADA && e.invoiceId).map((e) => e!.invoiceId as string)));
    const pagos = Array.from(new Set(tramos.map((t) => porId.get(t.entradaId)).filter((e) => e?.fuente === FUENTE_EXCEDENTE && e.paymentId).map((e) => e!.paymentId as string)));
    const cobros = facturas.length + pagos.length > 0
      ? await prisma.payment.findMany({
          where: {
            invoice: { clinicId },
            method: { notIn: ["refund", "anticipo"] },
            OR: [
              ...(facturas.length ? [{ invoiceId: { in: facturas } }] : []),
              ...(pagos.length ? [{ id: { in: pagos } }] : []),
            ],
          },
          select: { id: true, invoiceId: true, paidAt: true },
        })
      : [];
    const out: Array<{ paidAt: Date; amount: number; method: string }> = [];
    for (const t of tramos) {
      const e = porId.get(t.entradaId);
      if (!e) continue;
      const deEsa = e.fuente === FUENTE_CITA_CANCELADA ? cobros.filter((p) => p.invoiceId === e.invoiceId)
        : e.fuente === FUENTE_EXCEDENTE ? cobros.filter((p) => p.id === e.paymentId) : [];
      if (deEsa.length > 0) for (const p of deEsa) out.push({ paidAt: p.paidAt, amount: t.monto, method: "origen" });
      else out.push({ paidAt: e.fecha, amount: t.monto, method: "origen" });
    }
    return out;
  } catch (e) {
    console.warn("[cfdi:anticipos-timbrados] no se pudo leer el origen del saldo a favor:", (e as Error)?.message);
    // Lado seguro: sin saber cuándo entró, se trata como de un mes anterior (pide confirmar).
    return [{ paidAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), amount: 0.01, method: "origen" }];
  }
}
