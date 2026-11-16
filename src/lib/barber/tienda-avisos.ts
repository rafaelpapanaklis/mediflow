import "server-only";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import {
  ORDER_NOTICE_RECENT,
  countOrdersNeedingAction,
  recentOrdersNeedingAction,
  tiendaReady,
  type OrderNotice,
} from "@/lib/barber/tienda-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — QUE EL DUEÑO SE ENTERE de los pedidos de la tienda
 * (16-nov-2026: «el apartado y pagar en tienda de un producto, ¿dónde le
 * llega al dueño?»). Antes solo caían en Productos → «Pedidos».
 *
 * Aquí vive lo que alimenta el numerito del menú (GET
 * /api/barber/product-orders/pending) y la tarjeta de Inicio. La REGLA de
 * qué pedido «pide acción» es una sola y está en tienda-core.ts
 * (orderNeedsAction / countOrdersNeedingAction): la misma que la pestaña.
 *
 *   · Solo quien puede VER productos (products.view) con un plan que los
 *     incluye; por la sede en sesión (ctx.barbershopId), la misma que abre
 *     Productos → Pedidos.
 *   · Sin la tabla de pedidos (sql/barber_tienda.sql sin pegar) no hay nada
 *     que avisar: 0 / null, y nada truena.
 *   · NUNCA lanza: un aviso que no se pudo leer no tumba ni el menú ni Inicio.
 *   · Solo LEE (ni siquiera barre lo vencido): se pide cada minuto.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface OrdersNotice {
  /** Pedidos por atender de la sede. */
  count: number;
  /** Los más recientes (hasta ORDER_NOTICE_RECENT). */
  recent: OrderNotice[];
}

type NoticeCtx = Pick<BarberContext, "barbershopId" | "role" | "user" | "barbershop">;

/** ¿Esta sesión recibe avisos de pedidos? Plan con productos + products.view. */
export function canSeeOrdersNotice(
  ctx: Pick<BarberContext, "role" | "user">,
  features: Record<string, boolean>,
): boolean {
  if (features.products !== true) return false;
  return hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, "products.view");
}

async function gate(ctx: NoticeCtx, features?: Record<string, boolean>): Promise<boolean> {
  if (!ctx.barbershopId) return false;
  const f = features ?? (await getBarberPlan(ctx.barbershop.plan)).features;
  if (!canSeeOrdersNotice(ctx, f)) return false;
  return (await tiendaReady(prisma)).orders;
}

/** El número del menú. 0 si no aplica o si algo falla. */
export async function countOrdersNotice(ctx: NoticeCtx, features?: Record<string, boolean>): Promise<number> {
  try {
    if (!(await gate(ctx, features))) return 0;
    return await countOrdersNeedingAction(prisma, ctx.barbershopId);
  } catch (e) {
    console.warn("[barber/tienda] contador de pedidos:", (e as Error).message);
    return 0;
  }
}

/** La tarjeta de Inicio. null si no aplica, si no hay ninguno o si algo falla. */
export async function loadOrdersNotice(ctx: NoticeCtx, features?: Record<string, boolean>): Promise<OrdersNotice | null> {
  try {
    if (!(await gate(ctx, features))) return null;
    const count = await countOrdersNeedingAction(prisma, ctx.barbershopId);
    if (count <= 0) return null;
    const recent = await recentOrdersNeedingAction(prisma, ctx.barbershopId, ORDER_NOTICE_RECENT);
    return { count, recent };
  } catch (e) {
    console.warn("[barber/tienda] aviso de pedidos en Inicio:", (e as Error).message);
    return null;
  }
}
