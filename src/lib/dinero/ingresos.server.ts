// ═══════════════════════════════════════════════════════════════════════════
// Las CONSULTAS de la definición única de ingresos y deuda (ws1-t2). Lo que
// cuenta y por qué está en `ingresos.ts` (puro). Aquí solo se lee.
//
// Payment NO tiene clinicId: el tenant va SIEMPRE por invoice.clinicId, y el
// clinicId lo pone quien llama desde la sesión (nunca del cliente). Cada
// función corta antes de consultar si falta: `clinicId: undefined` no filtra.
// ═══════════════════════════════════════════════════════════════════════════

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { receivableInvoiceWhere, refundPaymentWhere, revenuePaymentWhere } from "@/lib/caja";
import {
  cargarCambiosDeDoctor,
  cargarCasosParaProduccion,
  facturasLigadas,
} from "@/lib/orthodontics/produccion-db";
import {
  METODOS_DE_HISTORIA,
  METODOS_QUE_RESTAN,
  netoDelPeriodo,
  repartirPorDoctor,
  type IngresoDeDoctor,
  type MovimientoDeDoctor,
  type MovimientoFechado,
  type NetoDelPeriodo,
} from "./ingresos";

/** Cliente de base: el `prisma` del repo, o el de solo lectura de Sabina. Solo se LEE. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DineroDb = any;

function exigirClinica(clinicId: string): void {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
}

/**
 * `where` de los COBROS que son ingreso: el criterio de cobro de caja.ts
 * (`revenuePaymentWhere`: sin reembolsos, sin facturas canceladas y lo que
 * ws1-t5 decida que no es cobro) Y sin la historia migrada. Con AND, para que
 * un cambio de criterio en caja.ts llegue aquí sin tocar nada.
 */
export function ingresoPaymentWhere(clinicId: string, paidAt: Prisma.DateTimeFilter): Prisma.PaymentWhereInput {
  exigirClinica(clinicId);
  return {
    AND: [
      revenuePaymentWhere(clinicId, paidAt),
      { method: { notIn: [...METODOS_DE_HISTORIA] } },
    ],
  };
}

/** `where` de los REEMBOLSOS reales que restan del ingreso (el espejo de caja.ts). */
export function reembolsoPaymentWhere(clinicId: string, paidAt: Prisma.DateTimeFilter): Prisma.PaymentWhereInput {
  exigirClinica(clinicId);
  return refundPaymentWhere(clinicId, paidAt);
}

/** `where` de la DEUDA: facturas emitidas (ni borrador ni cancelada) con saldo. */
export function deudaInvoiceWhere(clinicId: string): Prisma.InvoiceWhereInput {
  exigirClinica(clinicId);
  return receivableInvoiceWhere(clinicId);
}

/** Neto del periodo con dos agregados (para tarjetas que no necesitan serie). */
export async function ingresoNetoDelPeriodo(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
  db: DineroDb = prisma,
): Promise<{ neto: number; cobrado: number; reembolsos: number }> {
  const [cob, dev] = await Promise.all([
    db.payment.aggregate({ where: ingresoPaymentWhere(clinicId, paidAt), _sum: { amount: true } }),
    db.payment.aggregate({ where: reembolsoPaymentWhere(clinicId, paidAt), _sum: { amount: true } }),
  ]);
  const r = netoDelPeriodo(
    [{ amount: Number(cob?._sum?.amount ?? 0), paidAt: new Date(0) }],
    [{ amount: Number(dev?._sum?.amount ?? 0), paidAt: new Date(0) }],
  );
  return { neto: r.neto, cobrado: r.cobrado, reembolsos: r.reembolsos };
}

/** Las filas (monto y fecha) de cobros y reembolsos del periodo. */
export async function movimientosDelPeriodo(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
  db: DineroDb = prisma,
): Promise<{ cobros: MovimientoFechado[]; reembolsos: MovimientoFechado[] }> {
  const [cobros, reembolsos] = await Promise.all([
    db.payment.findMany({ where: ingresoPaymentWhere(clinicId, paidAt), select: { amount: true, paidAt: true } }),
    db.payment.findMany({ where: reembolsoPaymentWhere(clinicId, paidAt), select: { amount: true, paidAt: true } }),
  ]);
  return { cobros, reembolsos };
}

/** Neto del periodo y su serie por `clave` (día, mes… en la zona de la clínica). */
export async function ingresosDelPeriodo(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
  clave: ((d: Date) => string) | undefined,
  db: DineroDb = prisma,
): Promise<NetoDelPeriodo & { nCobros: number }> {
  const { cobros, reembolsos } = await movimientosDelPeriodo(clinicId, paidAt, db);
  return { ...netoDelPeriodo(cobros, reembolsos, clave), nCobros: cobros.length };
}

const SELECT_DOCTOR = {
  invoiceId: true,
  amount: true,
  paidAt: true,
  invoice: { select: { doctorId: true, appointmentId: true, appointment: { select: { doctorId: true } } } },
} as const;

function aMovimientoDeDoctor(f: any): MovimientoDeDoctor {
  return {
    invoiceId: f.invoiceId,
    amount: f.amount,
    paidAt: f.paidAt,
    facturaDoctorId: f.invoice?.doctorId ?? null,
    appointmentId: f.invoice?.appointmentId ?? null,
    citaDoctorId: f.invoice?.appointment?.doctorId ?? null,
  };
}

/**
 * Lo COBRADO neto del periodo por doctor (base de comisiones, nómina y el
 * «Por doctor» de Finanzas). Mismas filas que `ingresosDelPeriodo`: la suma
 * de todos los doctores (más «sin doctor», clave `null`) es el ingreso.
 */
export async function ingresosPorDoctorDelPeriodo(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter & { gte: Date },
  db: DineroDb = prisma,
): Promise<Map<string | null, IngresoDeDoctor>> {
  const [cobros, reembolsos] = await Promise.all([
    db.payment.findMany({ where: ingresoPaymentWhere(clinicId, paidAt), select: SELECT_DOCTOR }),
    db.payment.findMany({ where: reembolsoPaymentWhere(clinicId, paidAt), select: SELECT_DOCTOR }),
  ]);
  const movCobros = (cobros as any[]).map(aMovimientoDeDoctor);
  const movReembolsos = (reembolsos as any[]).map(aMovimientoDeDoctor);

  // Casos de ortodoncia: solo hacen falta si hubo dinero en el periodo. Los
  // cargadores de produccion-db toleran que falten las columnas (lista vacía).
  let casoPorFactura = new Map<string, string>();
  let doctorActualPorCaso = new Map<string, string | null>();
  let cambios: Awaited<ReturnType<typeof cargarCambiosDeDoctor>> = [];
  if (movCobros.length + movReembolsos.length > 0) {
    const casos = await cargarCasosParaProduccion(clinicId, db);
    if (casos.length > 0) {
      casoPorFactura = await facturasLigadas(clinicId, casos.map((c) => c.planId), db);
      for (const c of casos) if (c.invoiceId) casoPorFactura.set(c.invoiceId, c.planId);
      doctorActualPorCaso = new Map(casos.map((c) => [c.planId, c.treatingDoctorId]));
      const planes = new Set<string>();
      for (const m of [...movCobros, ...movReembolsos]) {
        const p = casoPorFactura.get(m.invoiceId);
        if (p && !m.appointmentId) planes.add(p);
      }
      if (planes.size > 0) cambios = await cargarCambiosDeDoctor(clinicId, Array.from(planes), paidAt.gte, db);
    }
  }
  return repartirPorDoctor({ cobros: movCobros, reembolsos: movReembolsos, casoPorFactura, doctorActualPorCaso, cambios });
}

// ── Historia migrada (aparte, nunca ingreso) ──────────────────────────────

const SONDA = Symbol.for("dalecontrol.dinero.tablaPagosMigrados");
type Sonda = { existe: boolean; at: number };
const RE_PREGUNTAR_MS = 10 * 60_000;

/** ¿Existe `migrated_payments`? Se pregunta con to_regclass (no falla nunca) y se recuerda en globalThis. */
async function hayTablaDePagosMigrados(db: DineroDb): Promise<boolean> {
  const g = globalThis as unknown as Record<symbol, Sonda | undefined>;
  const s = g[SONDA];
  if (s && (s.existe || Date.now() - s.at < RE_PREGUNTAR_MS)) return s.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.migrated_payments') IS NOT NULL AS existe`;
    const existe = filas?.[0]?.existe === true;
    g[SONDA] = { existe, at: Date.now() };
    return existe;
  } catch {
    return false;
  }
}

/**
 * Lo cobrado en el SISTEMA ANTERIOR con fecha dentro del periodo: los pagos
 * de `migrated_payments` más las filas viejas de `payments` con método de
 * historia. Se enseña APARTE de los ingresos, nunca sumado. Nunca lanza: si
 * no se puede leer, 0.
 */
export async function historiaMigradaDelPeriodo(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
  db: DineroDb = prisma,
): Promise<number> {
  exigirClinica(clinicId);
  try {
    const [enPayments, tabla] = await Promise.all([
      db.payment.aggregate({
        where: { paidAt, method: { in: [...METODOS_DE_HISTORIA] }, invoice: { clinicId, status: { notIn: ["CANCELLED"] } } },
        _sum: { amount: true },
      }),
      hayTablaDePagosMigrados(db),
    ]);
    let total = Number(enPayments?._sum?.amount ?? 0);
    if (tabla) {
      const mig = await db.migratedPayment.aggregate({ where: { clinicId, paidAt }, _sum: { amount: true } });
      total += Number(mig?._sum?.amount ?? 0);
    }
    return Math.round(total * 100) / 100;
  } catch (e) {
    console.warn("[dinero] no se pudo leer la historia migrada del periodo:", e);
    return 0;
  }
}

/**
 * De lo PAGADO de todas las facturas emitidas de la clínica, cuánto es
 * historia migrada: por factura, `paid` menos sus cobros hechos aquí (Payment
 * que no resta ni es historia), nunca negativo — `historiaDeFactura` en SQL.
 * Una factura nacida en DaleControl da 0. Nunca lanza: si falla, 0.
 */
export async function historiaMigradaDeFacturas(clinicId: string, db: DineroDb = prisma): Promise<number> {
  exigirClinica(clinicId);
  const fuera = [...METODOS_QUE_RESTAN, ...METODOS_DE_HISTORIA];
  try {
    const filas = await db.$queryRaw<{ historia: number | null }[]>`
      SELECT COALESCE(SUM(GREATEST(i."paid" - COALESCE(p.cobrado, 0), 0)), 0)::float8 AS historia
        FROM "invoices" i
        LEFT JOIN (
          SELECT pa."invoiceId", SUM(pa."amount") AS cobrado
            FROM "payments" pa
            JOIN "invoices" fi ON fi."id" = pa."invoiceId" AND fi."clinicId" = ${clinicId}
           WHERE pa."method" <> ALL(${fuera}::text[])
           GROUP BY pa."invoiceId"
        ) p ON p."invoiceId" = i."id"
       WHERE i."clinicId" = ${clinicId}
         AND i."status" NOT IN ('DRAFT', 'CANCELLED')
         AND i."paid" > 0`;
    return Math.round(Number(filas?.[0]?.historia ?? 0) * 100) / 100;
  } catch (e) {
    console.warn("[dinero] no se pudo calcular la historia migrada de las facturas:", e);
    return 0;
  }
}
