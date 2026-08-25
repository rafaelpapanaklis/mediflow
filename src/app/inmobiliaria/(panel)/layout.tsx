export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import {
  REALTY_NAV_ITEMS,
  navItemAllowsMode,
  type RealtyNavItem,
} from "@/lib/realty/types";
import { getRealtyT } from "@/i18n/dictionaries/realty";
import { RealtySidebar } from "@/components/realty/realty-sidebar";
import { RealtyTopbar } from "@/components/realty/realty-topbar";
import "@/app/panel-chrome-va.css";
import "../realty-theme.css";

/**
 * Shell del panel de INMUEBLES. Guard de sesión (espejo del layout de
 * /barber): sin contexto → /login compartido. El gate de suscripción impaga
 * vive en /inmobiliaria/page.tsx (router) y, por página, lo cablea la ola de
 * suscripción — aquí no se corta para no crear un loop con
 * /inmobiliaria/suscripcion.
 *
 * La navegación se resuelve AQUÍ (server) con un AND de tres filtros:
 *   1. MODO de la cuenta (AGENCY / AGENT / OWNER) → campo `modes`
 *   2. FEATURE del plan (realty_plan_configs)     → campo `featureKey`
 *   3. PERMISO del rol                            → campo `permission`
 * El sidebar solo pinta. Ninguna pantalla vuelve a decidir esto con un if.
 */
export default async function RealtyPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const t = getRealtyT(ctx.account.locale);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const items: RealtyNavItem[] = REALTY_NAV_ITEMS.filter((item) => {
    if (!navItemAllowsMode(item, ctx.mode)) return false;
    if (item.featureKey && ctx.plan.features[item.featureKey] !== true) return false;
    if (item.permission && !hasRealtyPermission(permUser, item.permission as RealtyPermissionKey)) {
      return false;
    }
    return true;
  }).map((item) => ({
    key: item.key,
    href: item.href,
    icon: item.icon,
    section: item.section,
    label: t(`realty.shell.nav.${item.key}`),
  }));

  const sectionLabels: Record<string, string> = {
    operacion: t("realty.shell.navSections.operacion"),
    arrendamiento: t("realty.shell.navSections.arrendamiento"),
    negocio: t("realty.shell.navSections.negocio"),
    crecimiento: t("realty.shell.navSections.crecimiento"),
    cuenta: t("realty.shell.navSections.cuenta"),
  };

  return (
    <div className="realty-shell mf-extpanel flex min-h-screen font-sans">
      <RealtySidebar
        accountName={ctx.account.name}
        items={items}
        sectionLabels={sectionLabels}
        brandName={t("realty.shell.brand.product")}
        brandSub={t("realty.shell.brand.vertical")}
        logoutLabel={t("realty.shell.logout")}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <RealtyTopbar
          rootLabel={t("realty.shell.topbar.root")}
          accountName={ctx.account.name}
          modeLabel={t(`realty.shell.modes.${ctx.mode}`)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pt-20 lg:pt-6"
          style={{
            padding: "clamp(12px, 1.5vw, 28px)",
            paddingTop: "clamp(16px, 2vw, 24px)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
