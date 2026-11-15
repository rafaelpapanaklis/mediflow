import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Barber, Barbershop, BarberRole, BarberUser } from "@prisma/client";
import {
  BarberForbiddenError,
  hasBarberPermission,
  type BarberPermissionKey,
} from "@/lib/barber/permissions";
import { barberDebeCambiarContrasena, ultimoAccesoPorEscribir } from "@/lib/barber/contrasena";
import { BARBER_BRANCH_ALL, BARBER_BRANCH_COOKIE, BARBER_BRANCH_PIN_HEADER } from "@/lib/barber/branch-cookie";

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
  /**
   * Sede que se está OPERANDO (sucursales de verdad, 15-nov): la que eligió
   * el selector (cookie dcb_branch) si la sesión tiene acceso a ella
   * (getAccessibleBranchIds); si no, la sede propia del usuario. Toda pantalla
   * y API que filtra por `barbershopId` opera así sobre la sede elegida.
   */
  barbershopId: string;
  /**
   * Fila de la sede activa. `plan` y `subscriptionStatus` vienen SIEMPRE de
   * la MATRIZ (la que paga): en una sucursal se sobrescriben con los de la
   * raíz, para que ningún gate por plan dependa de la copia de la sucursal.
   */
  barbershop: Barbershop;
  /**
   * Sede PROPIA del usuario (la de su fila BarberUser). Es la que decide a
   * qué sedes tiene acceso y si su sede está cerrada. Opcional para no romper
   * los contextos armados a mano en las pruebas: sin ella vale barbershopId.
   */
  homeBarbershopId?: string;
  homeBarbershop?: Barbershop;
  user: BarberUser;
  /** Fila Barber ligada al usuario (si el usuario ES un barbero operativo). */
  barber: Barber | null;
  role: BarberRole;
  /**
   * La cuenta entra con una contraseña TEMPORAL que le dio quien la dio de
   * alta: el panel la manda a cambiarla antes de dejarla pasar. Sale del
   * mismo getUser de abajo (app_metadata), sin otra consulta. Opcional para
   * no romper los contextos de prueba que ya existen.
   */
  mustChangePassword?: boolean;
}

export async function getBarberContext(): Promise<BarberContext | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const bu = await prisma.barberUser.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { barbershop: true, barber: true },
      orderBy: { createdAt: "asc" },
    });
    if (!bu) return null;

    await anotarUltimoAcceso(user.id, bu, user.last_sign_in_at);

    const home: BarberContext = {
      barberUserId: bu.id,
      barbershopId: bu.barbershopId,
      barbershop: bu.barbershop,
      homeBarbershopId: bu.barbershopId,
      homeBarbershop: bu.barbershop,
      user: bu,
      barber: bu.barber,
      role: bu.role,
      mustChangePassword: barberDebeCambiarContrasena(user.app_metadata),
    };
    let ctx: BarberContext;
    try {
      ctx = await withActiveBranch(home, await readSelectedBranch());
    } catch (e) {
      // Si falla resolver la sede elegida, se opera la propia (como antes de
      // las sucursales) en vez de dejar a la persona fuera del panel.
      console.error("[barber-auth] no se pudo resolver la sede elegida:", e instanceof Error ? e.message : e);
      ctx = home;
    }
    // Escritura hecha desde una pantalla de OTRA sede (ronda 2, M3): dos
    // pestañas, y en la otra se cambió de sede. La petición no se atiende:
    // ni en la sede de la cookie ni en la de la pantalla. El panel lo traduce
    // a «cambiaste de sede en otra pestaña» (sede-pin.ts).
    const pinned = await readPinnedBranch();
    if (pinned && pinned !== ctx.barbershopId) {
      console.warn("[barber-auth] escritura rechazada: la pantalla es de otra sede que la de la sesión");
      return null;
    }
    return ctx;
  } catch {
    // Tabla barber_users aún sin migrar / DB caída → sesión "no es de
    // barbería". Jamás propagar: este helper corre en páginas públicas de
    // guard y no puede tumbar nada.
    return null;
  }
}

// ── Sede activa (sucursales de verdad, decisión #11 de Rafael, 15-nov) ──
//
// Antes, getBarberContext devolvía SIEMPRE la sede propia del usuario y la
// cookie del selector solo la leían Inicio, Reportes y la barra de
// administración: al cambiar de sede, Agenda, Caja, Servicios, Clientes,
// Productos, Fila, Horarios, Mi web y Configuración seguían enseñando la
// matriz, y el dueño no podía operar sus sucursales desde su cuenta.
//
// Ahora el contexto ya nace con la sede elegida. Reglas:
//   · La cookie es solo una PETICIÓN: se valida contra getAccessibleBranchIds
//     de la sede propia en cada lectura. Una sede fuera de ese conjunto (otra
//     cadena, una sede a la que le retiraron el acceso, una cookie puesta a
//     mano) se ignora y la sesión opera su sede propia.
//   · «Toda la cadena» (BARBER_BRANCH_ALL) no es una sede: las pantallas que
//     consolidan (Inicio, Reportes, Barberos y la barra de administración) la
//     siguen leyendo con resolveBranchScope; todas las demás operan la sede
//     propia.
//   · Plan y suscripción: siempre los de la MATRIZ (ver BarberContext).
//   · El rol, los permisos y la persona NO cambian con la sede: son los de
//     la fila BarberUser. La ficha de barbero (ctx.barber) solo acompaña a la
//     sede a la que pertenece: en otra sede vale null, así que un Barbero con
//     acceso a dos sedes no ve en la ajena nada como «suyo».

/**
 * Sede de la PANTALLA desde la que se hizo una escritura (encabezado que
 * pone sede-pin.ts en los POST/PUT/PATCH/DELETE del panel). Fuera de una
 * petición, o en una lectura, null.
 */
async function readPinnedBranch(): Promise<string | null> {
  try {
    return (await headers()).get(BARBER_BRANCH_PIN_HEADER) || null;
  } catch {
    return null;
  }
}

/** Lee la cookie del selector (sin validar). Fuera de una petición, null. */
async function readSelectedBranch(): Promise<string | null> {
  try {
    return (await cookies()).get(BARBER_BRANCH_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Decisión PURA de qué sede opera la sesión. `accessible` es lo que devuelve
 * getAccessibleBranchIds para la sede propia. Nunca devuelve una sede que no
 * esté en `accessible` (salvo la propia, que siempre lo está).
 */
export function pickActiveBranchId(args: {
  homeId: string;
  requested: string | null | undefined;
  accessible: readonly string[];
}): string {
  const { homeId, requested, accessible } = args;
  if (!requested || requested === BARBER_BRANCH_ALL || requested === homeId) return homeId;
  return accessible.includes(requested) ? requested : homeId;
}

/**
 * Aplica la sede elegida a un contexto armado sobre la sede propia y le pone
 * el plan y la suscripción de la matriz. Exportada para las pruebas.
 */
export async function withActiveBranch(
  home: BarberContext,
  requested: string | null | undefined,
): Promise<BarberContext> {
  const homeId = home.homeBarbershopId ?? home.barbershopId;
  const homeShop = home.homeBarbershop ?? home.barbershop;
  let active: Barbershop = homeShop;

  const wantsOther = Boolean(requested) && requested !== BARBER_BRANCH_ALL && requested !== homeId;
  if (wantsOther) {
    const accessible = await getAccessibleBranchIds(home);
    const pick = pickActiveBranchId({ homeId, requested, accessible });
    if (pick !== homeId) {
      const shop = await prisma.barbershop.findUnique({ where: { id: pick } });
      // Una sede CERRADA no se opera (ronda 2, M1): ni el dueño. Se queda en la
      // propia; las pantallas de solo lectura que consolidan (Inicio, Reportes)
      // la siguen pudiendo enseñar vía resolveBranchScope.
      if (shop && shop.isActive) active = shop;
    }
  }

  // Plan y suscripción de la MATRIZ (la que paga). Una sola consulta y solo
  // cuando la sede activa es sucursal.
  if (active.parentId) {
    const root = await prisma.barbershop.findUnique({
      where: { id: active.parentId },
      select: { plan: true, subscriptionStatus: true },
    });
    if (root) active = { ...active, plan: root.plan, subscriptionStatus: root.subscriptionStatus };
  }

  const isHome = active.id === homeId;
  return {
    ...home,
    barbershopId: active.id,
    barbershop: active,
    homeBarbershopId: homeId,
    homeBarbershop: isHome ? active : homeShop,
    // La ficha de barbero es de SU sede: en otra, no hay «lo suyo».
    barber: home.barber && home.barber.barbershopId === active.id ? home.barber : null,
  };
}

/**
 * «Último acceso» de Equipo y /admin/barberias (auditoría 14-nov, M4).
 *
 * El inicio de sesión lo hace el endpoint compartido /api/auth/login (que no
 * se toca), así que aquí se lee lo que Supabase ya sabe: `last_sign_in_at`
 * cambia en cada inicio de sesión, no en cada página. Se escribe solo cuando
 * es más nuevo que lo guardado (ultimoAccesoPorEscribir): una escritura por
 * inicio de sesión. Va a TODAS las filas de la cuenta (una por sede), igual
 * que la contraseña es una para todas.
 *
 * Nunca frena la entrada: si la base falla, se sigue sin anotar.
 */
async function anotarUltimoAcceso(
  supabaseId: string,
  bu: { lastLogin: Date | null },
  lastSignInAt: string | null | undefined,
): Promise<void> {
  const cuando = ultimoAccesoPorEscribir(bu.lastLogin, lastSignInAt);
  if (!cuando || !supabaseId) return;
  try {
    await prisma.barberUser.updateMany({
      where: { supabaseId, OR: [{ lastLogin: null }, { lastLogin: { lt: cuando } }] },
      data: { lastLogin: cuando },
    });
    bu.lastLogin = cuando;
  } catch (e) {
    console.error("[barber-auth] no se pudo anotar el último acceso:", e instanceof Error ? e.message : e);
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
 *  · OWNER de la MATRIZ ve la familia COMPLETA (no necesita filas de acceso);
 *    un OWNER cuya sede propia es una sucursal, como cualquier otro rol.
 *  · Cualquier otro rol ve su propia sede + sus filas BarberUserBranchAccess,
 *    SIEMPRE recortadas a la familia (una fila que apunte a una cadena ajena
 *    se ignora — defensa en profundidad).
 *  · Siempre incluye la sede PROPIA (homeBarbershopId). Orden: matriz primero, luego
 *    sucursales por createdAt. NO filtra isActive (eso lo decide el caller).
 *
 * Uso típico:
 *   where: { barbershopId: { in: await getAccessibleBranchIds(ctx) } }
 * La lista sale SIEMPRE de aquí, jamás del request (body/query).
 */
export async function getAccessibleBranchIds(ctx: BarberContext): Promise<string[]> {
  // SIEMPRE desde la sede PROPIA: la sede activa sale de aquí, así que usarla
  // para calcular el acceso sería circular (y un encargado de sucursal con
  // acceso a la matriz no puede «heredar» lo que la matriz alcance).
  const homeId = ctx.homeBarbershopId ?? ctx.barbershopId;
  const homeShop = ctx.homeBarbershop ?? ctx.barbershop;
  const rootId = homeShop.parentId ?? homeId;
  const family = await prisma.barbershop.findMany({
    where: { OR: [{ id: rootId }, { parentId: rootId }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const ordered = [rootId, ...family.map((s) => s.id).filter((id) => id !== rootId)];

  // Dueño = toda la cadena SOLO si su sede propia es la matriz (ronda 2, M2).
  // Un «dueño» dado de alta en una sucursal (socio, franquiciatario) ve y opera
  // su sede más las que le concedan, como cualquier otro rol: antes, con el
  // contexto siguiendo a la sede elegida, podía cobrar en la matriz.
  if (ctx.role === "OWNER" && homeId === rootId) return ordered;

  const grants = await prisma.barberUserBranchAccess.findMany({
    where: { userId: ctx.barberUserId },
    select: { barbershopId: true },
  });
  const allowed = new Set<string>([homeId, ...grants.map((g) => g.barbershopId)]);
  return ordered.filter((id) => allowed.has(id));
}
