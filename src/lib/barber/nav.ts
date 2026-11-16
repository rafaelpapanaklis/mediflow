import "server-only";
import type { BarberContext } from "@/lib/barber-auth";
import { hasBarberPermission, type BarberPermissionKey } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { hasBarberPaidAccess } from "@/lib/barber/paid-access";
import { barberNavItemsWhileUnpaid } from "@/lib/barber/plan-shared";
import { BARBER_NAV_ITEMS, type BarberNavItem, type BarberNavItemDef } from "@/lib/barber/types";
import { getBarberT } from "@/i18n/dictionaries/barber";

// ═══════════════════════════════════════════════════════════════════════
// El MENÚ lateral del panel, punto único (m4, auditoría de permisos 16-nov).
//
// Lo arma el layout al cargar el panel y lo vuelve a pedir el menú en cada
// navegación interna (GET /api/barber/nav): Next conserva el layout entre
// páginas, así que sin esto una entrada recién quitada seguía en el menú
// hasta recargar (visto en panel.108: quitarle «Ver caja» a Recepción y
// navegar por el menú dejaba «Caja» visible). Las páginas y las APIs ya
// cortaban; esto hace que el menú diga lo mismo.
// ═══════════════════════════════════════════════════════════════════════

/** Filtro PURO: qué entradas ve esta persona con este plan y este estado de pago. */
export function filterBarberNav(
  defs: BarberNavItemDef[],
  permUser: { role: BarberContext["role"]; permissionsOverride?: string[] | null },
  features: Record<string, boolean>,
  paid: boolean,
): BarberNavItemDef[] {
  const source = paid ? defs : barberNavItemsWhileUnpaid(defs);
  return source.filter((item) => {
    // Sin pagar, Suscripción se ve SIEMPRE, tenga o no billing.manage: la
    // pantalla ya deja verla en solo-lectura a cualquier rol, y si el
    // permiso la escondiera un empleado vería el menú VACÍO, sin una sola
    // pista de por qué su barbería dejó de funcionar.
    if (!paid && item.key === "suscripcion") return true;
    // Configuración se ve con CUALQUIER rol: quien no edita la barbería entra
    // ahí a cambiar su propia contraseña (la página le enseña solo eso).
    if (item.key === "configuracion") return true;
    if (item.featureKey && features[item.featureKey] !== true) return false;
    if (item.permission && !hasBarberPermission(permUser, item.permission as BarberPermissionKey)) return false;
    if (item.anyPermission && !item.anyPermission.some((k) => hasBarberPermission(permUser, k as BarberPermissionKey))) {
      return false;
    }
    return true;
  });
}

/** El menú de la sesión, con etiquetas: lo que pinta BarberSidebar. */
export async function resolveBarberNav(
  ctx: BarberContext,
  pre?: { features?: Record<string, boolean>; paid?: boolean },
): Promise<BarberNavItem[]> {
  const features = pre?.features ?? (await getBarberPlan(ctx.barbershop.plan)).features;
  const paid = pre?.paid ?? (await hasBarberPaidAccess(ctx));
  const t = getBarberT(ctx.barbershop.locale);
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  return filterBarberNav(BARBER_NAV_ITEMS, permUser, features, paid).map((item) => ({
    key: item.key,
    href: item.href,
    icon: item.icon,
    section: item.section,
    label: t(`barber.shell.nav.${item.key}`),
  }));
}
