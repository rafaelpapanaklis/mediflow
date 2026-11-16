import "server-only";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { barberCanSeeClient } from "@/lib/barber/clients";
import type { BarberPaymentMethod } from "@/lib/barber/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — lo que la ficha «A» lee además de getBarberClientDetail.
 *
 * Solo LECTURA. La pestaña Membresía enseña los periodos del cliente (el
 * vigente, los ya pagados que siguen y los que terminaron). Vender y renovar
 * siguen siendo las rutas de /api/barber/memberships: aquí no hay lógica de
 * dinero. Todo por la barbería/sede de la sesión.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface FichaMembershipPeriod {
  id: string;
  membershipId: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED";
  startAt: string;
  endAt: string;
  cutsUsed: number;
  includedCuts: number | null;
  paymentMethod: BarberPaymentMethod;
  /** Precio de HOY del plan (el periodo no guarda lo que pagó). */
  planPrice: number;
  planActive: boolean;
}

const PERIODS_MAX = 12;

/** Los últimos periodos de membresía del cliente, más recientes primero. */
export async function listClientMembershipPeriods(
  ctx: BarberContext,
  clientId: string,
): Promise<FichaMembershipPeriod[]> {
  if (!ctx.barbershopId || !clientId) return [];
  if (!(await barberCanSeeClient(ctx, clientId))) return [];
  const rows = await prisma.barberClientMembership.findMany({
    where: { barbershopId: ctx.barbershopId, clientId },
    orderBy: { startAt: "desc" },
    take: PERIODS_MAX,
    select: {
      id: true,
      membershipId: true,
      status: true,
      startAt: true,
      endAt: true,
      cutsUsed: true,
      paymentMethod: true,
      membership: { select: { name: true, includedCuts: true, price: true, isActive: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    membershipId: r.membershipId,
    name: r.membership?.name ?? "",
    status: r.status as FichaMembershipPeriod["status"],
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    cutsUsed: r.cutsUsed,
    includedCuts: r.membership?.includedCuts ?? null,
    paymentMethod: r.paymentMethod as BarberPaymentMethod,
    planPrice: Number(r.membership?.price ?? 0),
    planActive: r.membership?.isActive === true,
  }));
}
