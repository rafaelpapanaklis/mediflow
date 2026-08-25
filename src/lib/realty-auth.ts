import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type {
  RealtyAccount,
  RealtyMode,
  RealtyRole,
  RealtyUser,
} from "@prisma/client";
import { getRealtyPlan } from "@/lib/realty/plans";
import type { RealtyResolvedPlan } from "@/lib/realty/plan-shared";
import {
  RealtyForbiddenError,
  hasRealtyPermission,
  type RealtyPermissionKey,
} from "@/lib/realty/permissions";

export { RealtyForbiddenError, hasRealtyPermission };
export type { RealtyPermissionKey };

/**
 * Contexto de sesión de un usuario de INMUEBLES (DaleControl Inmuebles) —
 * espejo 1:1 de getBarberContext (src/lib/barber-auth.ts).
 *
 * accountId sale SIEMPRE de aquí, nunca del request body/query. TODA
 * consulta de negocio del vertical filtra por este accountId (ojo Prisma:
 * un undefined BORRA el filtro — nunca dejarlo pasar).
 *
 * Devuelve null sin redirigir (los guards los hacen las páginas/layouts).
 * No corta por suscripción: eso lo deciden el router
 * (src/app/inmobiliaria/page.tsx) y las páginas con
 * isRealtySubscriptionActive.
 *
 * PUNTO ÚNICO: la Ola 1 NO inventa su propio check de sesión, de permiso ni
 * de oficina. Se usan getRealtyContext / assertRealtyPermission /
 * getAccessibleOfficeIds y ya.
 */
export interface RealtyContext {
  realtyUserId: string;
  accountId: string;
  account: RealtyAccount;
  /** AGENCY | AGENT | OWNER — el eje del producto (ver realty/types.ts). */
  mode: RealtyMode;
  user: RealtyUser;
  role: RealtyRole;
  /** Plan YA resuelto (tabla realty_plan_configs con fallback al seed). */
  plan: RealtyResolvedPlan;
}

export async function getRealtyContext(): Promise<RealtyContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const ru = await prisma.realtyUser.findFirst({
      where: { supabaseId: user.id, active: true },
      include: { account: true },
      orderBy: { createdAt: "asc" },
    });
    if (!ru) return null;

    const plan = await getRealtyPlan(ru.account.plan);

    return {
      realtyUserId: ru.id,
      accountId: ru.accountId,
      account: ru.account,
      mode: ru.account.mode,
      user: ru,
      role: ru.role,
      plan,
    };
  } catch {
    // Tabla realty_users aún sin migrar / DB caída → sesión "no es de
    // inmobiliaria". Jamás propagar: este helper corre en páginas públicas
    // de guard y no puede tumbar nada.
    return null;
  }
}

/**
 * Assert de permiso para route handlers / server actions del vertical.
 * Lanza RealtyForbiddenError (la API lo mapea a 403).
 *
 *   const ctx = await getRealtyContext();
 *   if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
 *   try { assertRealtyPermission(ctx, "leases.manage"); }
 *   catch { return NextResponse.json({ error: "Sin permiso" }, { status: 403 }); }
 */
export function assertRealtyPermission(
  ctx: Pick<RealtyContext, "role" | "user">,
  key: RealtyPermissionKey,
): void {
  const ok = hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    key,
  );
  if (!ok) throw new RealtyForbiddenError(key);
}

/**
 * Oficinas (officeIds) que el usuario puede VER — punto ÚNICO del filtro
 * multi-oficina: ninguna terminal inventa el suyo.
 *
 * Reglas:
 *  · OWNER y MANAGER ven TODAS las oficinas de su cuenta (no necesitan
 *    filas de acceso).
 *  · Cualquier otro rol ve las oficinas de sus filas RealtyUserOfficeAccess,
 *    SIEMPRE recortadas a su propia cuenta (una fila que apunte a otra
 *    cuenta se ignora — defensa en profundidad).
 *  · Orden estable por createdAt, con la oficina principal primero.
 *  · NO filtra isActive (eso lo decide el caller).
 *
 * Uso típico:
 *   where: { officeId: { in: await getAccessibleOfficeIds(ctx) } }
 *
 * 🔴 Un inmueble puede tener officeId NULL (cartera sin oficina asignada).
 * Un `{ in: [...] }` a secas DESCARTA los nulos. Si la pantalla los tiene
 * que enseñar, el where va como
 *   OR: [{ officeId: { in: ids } }, { officeId: null }]
 * y SIEMPRE junto al filtro por accountId, que es el que aísla el tenant.
 */
export async function getAccessibleOfficeIds(ctx: RealtyContext): Promise<string[]> {
  const offices = await prisma.realtyOffice.findMany({
    where: { accountId: ctx.accountId },
    select: { id: true, isMain: true },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });
  const ordered = offices.map((o) => o.id);

  if (ctx.role === "OWNER" || ctx.role === "MANAGER") return ordered;

  const grants = await prisma.realtyUserOfficeAccess.findMany({
    where: { userId: ctx.realtyUserId },
    select: { officeId: true },
  });
  const allowed = new Set<string>(grants.map((g) => g.officeId));
  return ordered.filter((id) => allowed.has(id));
}
