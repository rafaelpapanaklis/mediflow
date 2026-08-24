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
