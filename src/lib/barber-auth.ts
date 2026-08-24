import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Barber, Barbershop, BarberRole, BarberUser } from "@prisma/client";
import {
  BarberForbiddenError,
  hasBarberPermission,
  type BarberPermissionKey,
} from "@/lib/barber/permissions";

export { BarberForbiddenError, hasBarberPermission };
export type { BarberPermissionKey };

/**
 * Contexto de sesión de un usuario de BARBERÍA (DaleControl Barber) —
 * espejo 1:1 de getDentalLabContext (src/lib/lab-auth.ts).
 *
 * barbershopId sale SIEMPRE de aquí, nunca del request body/query. TODA
 * consulta de negocio del vertical filtra por este barbershopId (ojo Prisma:
 * un undefined BORRA el filtro — nunca dejarlo pasar).
 *
 * Devuelve null sin redirigir (los guards los hacen las páginas/layouts).
 * No consulta el estado de suscripción: eso lo deciden el router
 * (src/app/barber/page.tsx) y las páginas con isBarbershopSubscriptionActive.
 */
export interface BarberContext {
  barberUserId: string;
  barbershopId: string;
  barbershop: Barbershop;
  user: BarberUser;
  /** Fila Barber ligada al usuario (si el usuario ES un barbero operativo). */
  barber: Barber | null;
  role: BarberRole;
}

export async function getBarberContext(): Promise<BarberContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const bu = await prisma.barberUser.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { barbershop: true, barber: true },
      orderBy: { createdAt: "asc" },
    });
    if (!bu) return null;

    return {
      barberUserId: bu.id,
      barbershopId: bu.barbershopId,
      barbershop: bu.barbershop,
      user: bu,
      barber: bu.barber,
      role: bu.role,
    };
  } catch {
    // Tabla barber_users aún sin migrar / DB caída → sesión "no es de
    // barbería". Jamás propagar: este helper corre en páginas públicas de
    // guard y no puede tumbar nada.
    return null;
  }
}

/**
 * Assert de permiso para route handlers / server actions del vertical.
 * Lanza BarberForbiddenError (la API lo mapea a 403). Punto único: las olas
 * NO inventan su propio check.
 *
 *   const ctx = await getBarberContext();
 *   if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
 *   try { assertBarberPermission(ctx, "cash.manage"); }
 *   catch { return NextResponse.json({ error: "Sin permiso" }, { status: 403 }); }
 */
export function assertBarberPermission(
  ctx: Pick<BarberContext, "role" | "user">,
  key: BarberPermissionKey,
): void {
  const ok = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    key,
  );
  if (!ok) throw new BarberForbiddenError(key);
}

/**
 * Sedes (barbershopIds) que el usuario puede VER — punto ÚNICO del filtro
 * multisucursal: ninguna terminal inventa el suyo.
 *
 * Reglas:
 *  · Familia = la matriz de la cadena (parentId null) + sus sucursales; si
 *    la barbería del usuario no tiene parentId, ella es la matriz.
 *  · OWNER ve la familia COMPLETA (no necesita filas de acceso).
 *  · Cualquier otro rol ve su propia sede + sus filas BarberUserBranchAccess,
 *    SIEMPRE recortadas a la familia (una fila que apunte a una cadena ajena
 *    se ignora — defensa en profundidad).
 *  · Siempre incluye ctx.barbershopId. Orden: matriz primero, luego
 *    sucursales por createdAt. NO filtra isActive (eso lo decide el caller).
 *
 * Uso típico:
 *   where: { barbershopId: { in: await getAccessibleBranchIds(ctx) } }
 * La lista sale SIEMPRE de aquí, jamás del request (body/query).
 */
export async function getAccessibleBranchIds(ctx: BarberContext): Promise<string[]> {
  const rootId = ctx.barbershop.parentId ?? ctx.barbershopId;
  const family = await prisma.barbershop.findMany({
    where: { OR: [{ id: rootId }, { parentId: rootId }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const ordered = [rootId, ...family.map((s) => s.id).filter((id) => id !== rootId)];

  if (ctx.role === "OWNER") return ordered;

  const grants = await prisma.barberUserBranchAccess.findMany({
    where: { userId: ctx.barberUserId },
    select: { barbershopId: true },
  });
  const allowed = new Set<string>([ctx.barbershopId, ...grants.map((g) => g.barbershopId)]);
  return ordered.filter((id) => allowed.has(id));
}
