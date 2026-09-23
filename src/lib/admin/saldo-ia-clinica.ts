import { prisma } from "@/lib/prisma";
import {
  RECARGAS_DEL_SALDO,
  viaDeRecarga,
  whereRecargasDelSaldo,
  type ViaRecarga,
} from "@/lib/ai-billing/recargas";

/**
 * El saldo de IA de UNA clínica para su ficha en /admin: saldo actual,
 * estado, últimos movimientos y lo que ha PAGADO de saldo IA. Solo lectura.
 *
 * Antes había que salirse a /admin/ai-billing y buscarla en la lista. Aquí no
 * se calcula nada nuevo: el saldo es `ai_wallets.balanceCents` tal cual (el
 * mismo dato que pinta Tesorería), el estado sale de
 * `@/lib/ai-billing/saldo-estado` (la misma regla que Tesorería) y qué cuenta
 * como pago sale de `@/lib/ai-billing/recargas` (el mismo criterio que el
 * historial de facturas del cliente).
 *
 * Multi-tenant: TODAS las consultas llevan `clinicId`.
 */

/** Cuántos asientos recientes del libro mayor se enseñan en la ficha. */
export const MOVIMIENTOS_EN_FICHA = 10;
/** Cuántos pagos de saldo IA se listan en Facturación. */
export const PAGOS_EN_FICHA = 20;

export interface MovimientoSaldoIaDTO {
  id: string;
  /** TOPUP | CHARGE | REFUND | ADJUSTMENT */
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  /** STRIPE | MERCADOPAGO | SPEI | USAGE | ADMIN */
  source: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface PagoSaldoIaDTO {
  id: string;
  amountCents: number;
  via: ViaRecarga;
  /** "paid" = ya está en el saldo · "pending" = comprobante SPEI en revisión. */
  status: "paid" | "pending";
  reference: string | null;
  note: string | null;
  proofUrl: string | null;
  createdAt: string;
}

export interface SaldoIaClinicaDTO {
  /** null = la clínica no tiene monedero (no es saldo 0: es «no aplica»). */
  wallet: {
    balanceCents: number;
    status: string;
    autoRecharge: boolean;
    updatedAt: string;
  } | null;
  /** Los últimos MOVIMIENTOS_EN_FICHA asientos, de todos los tipos, el más reciente primero. */
  movimientos: MovimientoSaldoIaDTO[];
  /** Dinero que ENTRÓ al saldo (TOPUP y abonos a mano), más las SPEI en revisión. */
  pagos: {
    /** Suma de lo ya acreditado, sin las pendientes. */
    totalCents: number;
    /** Cuántos asientos acreditados. */
    count: number;
    /** Las últimas PAGOS_EN_FICHA, pendientes incluidas, la más reciente primero. */
    filas: PagoSaldoIaDTO[];
  };
}

type AsientoRecarga = {
  id: string;
  type: string;
  amountCents: number;
  source: string;
  reference: string | null;
  note: string | null;
  createdAt: Date;
};
type SpeiEnRevision = { id: string; amountCents: number; proofUrl: string | null; createdAt: Date };

/**
 * Asientos de recarga + SPEI en revisión → filas de pago, la más reciente
 * primero. La ficha y la pestaña «Saldo IA» de /admin/payments pasan por aquí.
 */
function unirPagos<A extends AsientoRecarga, P extends SpeiEnRevision>(
  recargas: A[],
  pendientes: P[],
): Array<PagoSaldoIaDTO & { fuente: A | P }> {
  const filas: Array<PagoSaldoIaDTO & { fuente: A | P }> = [];
  for (const r of recargas) {
    const via = viaDeRecarga(r);
    if (!via) continue; // el where ya lo garantiza; esto es defensa
    filas.push({
      id: `wallet:${r.id}`,
      amountCents: r.amountCents,
      via,
      status: "paid",
      reference: r.reference,
      note: r.note,
      proofUrl: null,
      createdAt: r.createdAt.toISOString(),
      fuente: r,
    });
  }
  for (const t of pendientes) {
    filas.push({
      id: `topup:${t.id}`,
      amountCents: t.amountCents,
      via: "spei",
      status: "pending",
      reference: null,
      note: null,
      proofUrl: t.proofUrl,
      createdAt: t.createdAt.toISOString(),
      fuente: t,
    });
  }
  return filas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const sinFuente = <T extends { fuente: unknown }>({ fuente: _f, ...fila }: T) => fila;

export async function leerSaldoIaClinica(clinicId: string): Promise<SaldoIaClinicaDTO> {
  if (!clinicId) throw new Error("leerSaldoIaClinica: clinicId requerido");

  const whereRecargas = whereRecargasDelSaldo(clinicId);
  const [wallet, movimientos, recargasAgg, recargas, pendientesSpei] = await Promise.all([
    prisma.aiWallet.findUnique({
      where: { clinicId },
      select: { balanceCents: true, status: true, autoRecharge: true, updatedAt: true },
    }),
    prisma.aiWalletTransaction.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take: MOVIMIENTOS_EN_FICHA,
      select: {
        id: true, type: true, amountCents: true, balanceAfterCents: true,
        source: true, reference: true, note: true, createdAt: true,
      },
    }),
    prisma.aiWalletTransaction.aggregate({
      where: whereRecargas,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.aiWalletTransaction.findMany({
      where: whereRecargas,
      orderBy: { createdAt: "desc" },
      take: PAGOS_EN_FICHA,
      select: { id: true, type: true, amountCents: true, source: true, reference: true, note: true, createdAt: true },
    }),
    prisma.aiTopup.findMany({
      where: { clinicId, status: "PENDING", method: "SPEI" },
      orderBy: { createdAt: "desc" },
      take: PAGOS_EN_FICHA,
      select: { id: true, amountCents: true, proofUrl: true, createdAt: true },
    }),
  ]);

  const filas = unirPagos(recargas, pendientesSpei).slice(0, PAGOS_EN_FICHA);

  return {
    wallet: wallet
      ? {
          balanceCents: wallet.balanceCents,
          status: wallet.status,
          autoRecharge: wallet.autoRecharge,
          updatedAt: wallet.updatedAt.toISOString(),
        }
      : null,
    movimientos: movimientos.map((m) => ({
      id: m.id,
      type: m.type,
      amountCents: m.amountCents,
      balanceAfterCents: m.balanceAfterCents,
      source: m.source,
      reference: m.reference,
      note: m.note,
      createdAt: m.createdAt.toISOString(),
    })),
    pagos: {
      totalCents: recargasAgg._sum.amountCents ?? 0,
      count: recargasAgg._count._all,
      filas: filas.map(sinFuente),
    },
  };
}

// ── Todas las clínicas: pestaña «Saldo IA» de /admin/payments ───────────────

/** Cuántos pagos de saldo IA lista /admin/payments. */
export const PAGOS_SALDO_IA_RECIENTES = 100;

export interface PagoSaldoIaGlobalDTO extends PagoSaldoIaDTO {
  clinic: { id: string; name: string };
}

/**
 * Las últimas recargas de saldo IA de TODAS las clínicas, para /admin/payments.
 * Es una pantalla de administración de la plataforma (entre clínicas, como
 * /admin/ai-billing): aquí no hay tenant que filtrar. Mismo criterio que la
 * ficha y que el historial del cliente (@/lib/ai-billing/recargas).
 *
 * Es otro dinero que la suscripción: no entra en «Cobrado este mes» ni en el
 * MRR de esa página, que leen `subscription_invoices`.
 */
export async function leerPagosSaldoIaRecientes(): Promise<PagoSaldoIaGlobalDTO[]> {
  const [recargas, pendientesSpei] = await Promise.all([
    prisma.aiWalletTransaction.findMany({
      where: RECARGAS_DEL_SALDO,
      orderBy: { createdAt: "desc" },
      take: PAGOS_SALDO_IA_RECIENTES,
      select: {
        id: true, clinicId: true, type: true, amountCents: true, source: true,
        reference: true, note: true, createdAt: true,
      },
    }),
    prisma.aiTopup.findMany({
      where: { status: "PENDING", method: "SPEI" },
      orderBy: { createdAt: "desc" },
      take: PAGOS_SALDO_IA_RECIENTES,
      select: { id: true, clinicId: true, amountCents: true, proofUrl: true, createdAt: true },
    }),
  ]);

  // ai_wallet_transactions no tiene relación con Clinic en Prisma: los nombres
  // van en una sola consulta aparte.
  const ids = Array.from(new Set([...recargas, ...pendientesSpei].map((r) => r.clinicId)));
  const clinicas = ids.length
    ? await prisma.clinic.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nombre = new Map(clinicas.map((c) => [c.id, c.name]));

  return unirPagos(recargas, pendientesSpei)
    .slice(0, PAGOS_SALDO_IA_RECIENTES)
    .map(({ fuente, ...fila }) => ({
      ...fila,
      clinic: { id: fuente.clinicId, name: nombre.get(fuente.clinicId) ?? "Clínica eliminada" },
    }));
}
