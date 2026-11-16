import type { ReactNode } from "react";
import type { BarberContext } from "@/lib/barber-auth";
import { resolveBarberPermissions } from "@/lib/barber/permissions";
import { countTicketsWaitingShop } from "@/lib/barber/support";
import { Lock } from "lucide-react";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import { AdminI18n } from "./admin-ui";
import { AdminNav, type AdminTabKey } from "./admin-nav";
import s from "./admin.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Envoltorio SERVIDOR de las cuatro pantallas de administración.
//
// Resuelve aquí (una sola vez) lo que las cuatro necesitan: diccionario del
// locale de la barbería, pestañas visibles según permisos, sedes del
// el contador de soporte. La pantalla solo pinta. La SEDE se elige en un solo
// sitio, el selector de la barra de arriba (16-nov).
//
// Nota de navegación: Barberos, Equipo y Sucursales ya tienen entrada propia en
// el menú lateral (16-nov); estas pestañas siguen enlazándolas entre sí.
// ═══════════════════════════════════════════════════════════════════════

export async function AdminFrame({
  ctx,
  active,
  children,
}: {
  ctx: BarberContext;
  active: AdminTabKey;
  children: ReactNode;
}) {
  const dict = getBarberDict(ctx.barbershop.locale);
  const grants = resolveBarberPermissions(ctx.role, ctx.user.permissionsOverride);

  const tabs: AdminTabKey[] = [];
  if (grants.has("barbers.manage")) tabs.push("barberos");
  if (grants.has("team.manage")) tabs.push("equipo");
  // La pestaña de sucursales se ve aunque el plan no traiga multiBranch: la
  // pantalla explica qué se gana con Profesional.
  if (grants.has("branches.manage")) tabs.push("sucursales");
  if (grants.has("support.view")) tabs.push("soporte");

  const supportBadge = grants.has("support.view") ? await countTicketsWaitingShop(ctx) : 0;

  return (
    <AdminI18n dict={dict}>
      <div className={s.page}>
        <AdminNav tabs={tabs} active={active} supportBadge={supportBadge} />
        {children}
      </div>
    </AdminI18n>
  );
}

/**
 * Pantalla de "esto no es para ti". Se muestra cuando alguien llega por URL
 * a un área que su rol no incluye — recordatorio de que el candado real está
 * en el servidor: la API responde 403 aunque se salte esta pantalla.
 */
export function AdminDenied({ ctx }: { ctx: BarberContext }) {
  const t = getBarberT(ctx.barbershop.locale);
  return (
    <div className={s.card}>
      <div className={s.empty}>
        <div className={s.emptyIcon}>
          <Lock size={20} />
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-1)" }}>
          {t("barber.admin.common.noPermission")}
        </div>
      </div>
    </div>
  );
}
