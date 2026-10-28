// Lo que todavía NO se debe del saldo de unas facturas (decisiones de Rafael, 26-oct-2026):
//  · de una nota de plan de tratamiento, lo aceptado que aún no se hace ni se paga;
//  · de la factura principal de un caso de ortodoncia «Precio total a plazos», las cuotas que aún no
//    vencen;
//  · de una nota de plan con cuotas acordadas (plan financiado), lo que no es cuota vencida (27-oct,
//    A9): se debe la mensualidad acordada, no lo hecho — lo mismo que el WhatsApp de cobranza y el bot.
// Es la parte de `porHacerPorFactura` de `computeReceivables` (caja.ts): la MISMA regla que Caja y
// Finanzas, para que Pacientes, la ficha, Reportes, Analítica, el Inbox, el aviso de la nota y el
// portal del paciente digan lo mismo. Lo que el paciente debe de verdad = saldo − esto.
//
// Solo mira las facturas CANDIDATAS (notas de plan con saldo y principales de ortodoncia): dos
// consultas ligeras, y `computeReceivables` acotado a ellas. Tolerante: si algo no se puede leer,
// nada se resta (todo cuenta como antes). Toda consulta lleva el `clinicId` de quien llama.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeReceivables, receivableInvoiceWhere } from "@/lib/caja";
import { columnaNotaDelPlanExiste } from "@/lib/treatments/items-db";
import { leerNotasDePlan } from "@/lib/treatments/por-cobrar-db";
import { deudaDeNotaDelPlan } from "@/lib/treatments/por-cobrar";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { esPlanAPlazos } from "@/lib/invoices/plan-de-pagos";

export interface LoQueAunNoSeDebe {
  /** `invoiceId` → pesos de su saldo que aún no se deben. Solo las que tienen algo. */
  porFactura: Record<string, number>;
  /** De las notas de plan (por hacer). */
  porHacer: number;
  /** De ortodoncia «Precio total a plazos» y de las notas de plan con cuotas acordadas (por vencer). */
  porVencer: number;
  /**
   * De `porVencer`, solo las cuotas de notas de plan con cuotas acordadas (v12, t5 m1): la ficha las dice
   * aparte («Además, $X de cuotas que aún no vencen»), sin el «ya pagados» de lo por hacer.
   */
  porVencerCuotas: number;
  total: number;
}

const NADA = (): LoQueAunNoSeDebe => ({ porFactura: {}, porHacer: 0, porVencer: 0, porVencerCuotas: 0, total: 0 });

/**
 * Las facturas de la clínica cuyo saldo PUEDE no ser deuda entera: notas de plan con saldo y
 * facturas principales de casos de ortodoncia vivos. Quien hace varias preguntas en la misma
 * petición la lee una vez y la pasa.
 */
export async function candidatasNoExigibles(clinicId: string, soloDeEstas?: string[]): Promise<string[]> {
  if (!clinicId) return [];
  // Quien pregunta por unas facturas (un paciente, una nota) no lee las de toda la clínica (t5, sospecha 3).
  const pedidas = soloDeEstas ? Array.from(new Set(soloDeEstas.filter(Boolean))) : null;
  if (pedidas && pedidas.length === 0) return [];
  const ids = new Set<string>();
  try {
    if (await columnaNotaDelPlanExiste()) {
      const notas = pedidas
        ? await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "invoices"
             WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(pedidas)})
               AND "treatmentPlanId" IS NOT NULL AND "balance" > 0
               AND "status"::text NOT IN ('DRAFT', 'CANCELLED')`
        : await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "invoices"
             WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" IS NOT NULL AND "balance" > 0
               AND "status"::text NOT IN ('DRAFT', 'CANCELLED')`;
      for (const n of notas) ids.add(n.id);
    }
  } catch (e) {
    console.warn(`[dinero:no-exigible] clínica ${clinicId}: no se leyeron las notas de plan.`, e);
  }
  try {
    const casos = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, invoiceId: pedidas ? { in: pedidas } : { not: null }, deletedAt: null },
      select: { invoiceId: true },
    });
    for (const c of casos) if (c.invoiceId) ids.add(c.invoiceId);
  } catch (e) {
    console.warn(`[dinero:no-exigible] clínica ${clinicId}: no se leyeron los casos de ortodoncia.`, e);
  }
  return Array.from(ids);
}

/**
 * Cuánto del saldo de estas facturas aún no se debe. `ids` acota a unas facturas (las de un
 * paciente, las de una página); `filtro` añade un `where` (la visibilidad de quien pregunta).
 */
export async function loQueAunNoSeDebe(
  clinicId: string,
  opciones: {
    ids?: string[];
    filtro?: Prisma.InvoiceWhereInput;
    candidatas?: string[];
    timezone?: string | null;
    ahora?: Date;
  } = {},
): Promise<LoQueAunNoSeDebe> {
  // `clinicId` vacío no filtra nada: se corta antes de consultar.
  if (!clinicId) return NADA();
  try {
    let candidatas = opciones.candidatas ?? (await candidatasNoExigibles(clinicId, opciones.ids));
    if (opciones.ids) {
      const pedidas = new Set(opciones.ids);
      candidatas = candidatas.filter((id) => pedidas.has(id));
    }
    if (candidatas.length === 0) return NADA();
    const s = await computeReceivables(
      clinicId,
      opciones.ahora ?? new Date(),
      prisma,
      // Los cargos de control no cambian lo que no se debe (solo su «vencido»): no se leen.
      async () => new Map(),
      {
        filtro: { AND: [{ id: { in: candidatas } }, ...(opciones.filtro ? [opciones.filtro] : [])] },
        ...(opciones.timezone ? { timezone: opciones.timezone } : {}),
      },
    );
    const total = s.porHacer ?? 0;
    const porVencer = Math.round(((s.porVencerOrto ?? 0) + (s.porVencerCuotas ?? 0)) * 100) / 100;
    return {
      porFactura: s.porHacerPorFactura ?? {},
      porHacer: Math.round((total - porVencer) * 100) / 100,
      porVencer,
      porVencerCuotas: s.porVencerCuotas ?? 0,
      total,
    };
  } catch (e) {
    console.warn(`[dinero:no-exigible] clínica ${clinicId}: no se pudo calcular; se cuenta todo.`, e);
    return NADA();
  }
}

/**
 * De lo POR HACER de las notas de plan de estas facturas, lo que ya está pagado (por adelantado): lo
 * pagado de más sobre lo hecho, sin pasar de lo por hacer de cada nota. Sigue en la nota: NO es saldo
 * a favor (eso es solo el libro `patient_credits`, lo que se descuenta de la siguiente factura —
 * revisión t5 de la v7, V1); al cerrar el plan pasa a ese libro y aquí da 0. Con esto, lo por hacer
 * completo = `loQueAunNoSeDebe` (lo por hacer sin pagar) + esto, el «Por hacer» de la Cuenta del plan.
 * Mira también las notas ya saldadas (pagó todo y no se ha hecho nada). Tolerante: si falla, 0.
 *
 * v12 (t5, m1): `sinCuotas` NO cuenta las notas con cuotas acordadas. Ahí manda la mensualidad (v10): lo
 * que aún no se debe son cuotas por vencer, no lo por hacer, así que su adelanto no entra en «Además,
 * $X por hacer».
 * v15 (t5 de la v14, M1, opción b): ese adelanto va aparte en `conCuotas`. La tarjeta lo dice como
 * «Pagado por adelantado» (o «ya están pagados por adelantado sobre lo hecho») y «Estado de cuenta»
 * lo suma a su «Pagado por adelantado». No se cuenta dos veces con «cuotas que aún no vencen»: eso es
 * lo que FALTA pagar de la nota (saldo − lo vencido) y esto es lo ya pagado de más sobre lo hecho.
 */
export async function adelantosEnNotasDePlan(clinicId: string, invoiceIds: string[]): Promise<{ sinCuotas: number; conCuotas: number }> {
  if (!clinicId || invoiceIds.length === 0) return { sinCuotas: 0, conCuotas: 0 };
  try {
    const notas = await leerNotasDePlan(clinicId, invoiceIds);
    const { porFactura: condiciones } = await leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds: Array.from(notas.keys()) });
    let sin = 0;
    let con = 0;
    for (const [id, l] of Array.from(notas.entries())) {
      const d = deudaDeNotaDelPlan(l.nota, l.filas, null);
      const centavos = Math.round(Math.min(d.saldoAFavor, d.porHacer) * 100);
      if (esPlanAPlazos(condiciones.get(id))) con += centavos;
      else sin += centavos;
    }
    return { sinCuotas: sin / 100, conCuotas: con / 100 };
  } catch (e) {
    console.warn(`[dinero:no-exigible] clínica ${clinicId}: no se leyó lo pagado por adelantado.`, e);
    return { sinCuotas: 0, conCuotas: 0 };
  }
}

/** Solo el de las notas SIN cuotas acordadas (el que entra en «Además, $X por hacer»). */
export async function adelantoEnNotasDePlan(clinicId: string, invoiceIds: string[]): Promise<number> {
  return (await adelantosEnNotasDePlan(clinicId, invoiceIds)).sinCuotas;
}

/** Lo mismo, sumado por paciente (para listas): `patientId` → pesos que aún no se deben. */
export async function loQueAunNoSeDebePorPaciente(
  clinicId: string,
  noSeDebe: LoQueAunNoSeDebe,
): Promise<Map<string, number>> {
  const salida = new Map<string, number>();
  const ids = Object.keys(noSeDebe.porFactura);
  if (!clinicId || ids.length === 0) return salida;
  const filas = await prisma.invoice.findMany({ where: { clinicId, id: { in: ids } }, select: { id: true, patientId: true } });
  for (const f of filas) {
    if (!f.patientId) continue;
    salida.set(f.patientId, Math.round(((salida.get(f.patientId) ?? 0) + (noSeDebe.porFactura[f.id] ?? 0)) * 100) / 100);
  }
  return salida;
}

/**
 * De los pacientes que tienen algo que aún no se debe, cuántos se quedan SIN deuda de verdad
 * (todo su saldo era por hacer / por vencer). Para los contadores «Con deuda» de las listas.
 */
export async function pacientesQueYaNoDeben(clinicId: string, porPaciente: Map<string, number>): Promise<Set<string>> {
  const salida = new Set<string>();
  if (!clinicId || porPaciente.size === 0) return salida;
  const saldos = await prisma.invoice.groupBy({
    by: ["patientId"],
    where: { ...receivableInvoiceWhere(clinicId), patientId: { in: Array.from(porPaciente.keys()) } },
    _sum: { balance: true },
  });
  for (const g of saldos) if ((g._sum.balance ?? 0) - (porPaciente.get(g.patientId) ?? 0) <= 0.005) salida.add(g.patientId);
  return salida;
}

/**
 * Para el portal del paciente (sus facturas pueden ser de varias clínicas): lo que aún no se debe de
 * cada factura, preguntando a cada clínica por las suyas. El `clinicId` de cada factura sale de la
 * base (de los vínculos del paciente que ya validó el portal), nunca del navegador.
 */
export async function loQueAunNoSeDebeDeFacturas(facturas: Array<{ id: string; clinicId: string }>): Promise<Map<string, number>> {
  const salida = new Map<string, number>();
  const porClinica = new Map<string, string[]>();
  for (const f of facturas) {
    if (!f.clinicId) continue;
    porClinica.set(f.clinicId, [...(porClinica.get(f.clinicId) ?? []), f.id]);
  }
  for (const [clinicId, ids] of Array.from(porClinica)) {
    const r = await loQueAunNoSeDebe(clinicId, { ids });
    for (const [id, monto] of Object.entries(r.porFactura)) salida.set(id, monto);
  }
  return salida;
}
