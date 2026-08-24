export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission, type BarberPermissionKey } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { BARBER_NAV_ITEMS, type BarberNavItem } from "@/lib/barber/types";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BarberSidebar } from "@/components/barber/barber-sidebar";
import { BarberTopbar } from "@/components/barber/barber-topbar";
import "@/app/panel-chrome-va.css";
import "../barber-theme.css";

/**
 * Shell del panel BARBER. Guard de sesión (espejo del layout de
 * /laboratorios): sin contexto → /login compartido. El gate de suscripción
 * impaga vive en /barber/page.tsx (router) y, por página, lo cablea la ola
 * de suscripción — aquí no se corta para no crear loops con /barber/suscripcion.
 *
 * La navegación se resuelve AQUÍ (server): gating por features del plan
 * (barber_plan_configs) + permisos del rol. El sidebar solo pinta.
 */
export default async function BarberPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const items: BarberNavItem[] = BARBER_NAV_ITEMS.filter((item) => {
    if (item.featureKey && plan.features[item.featureKey] !== true) return false;
    if (item.permission && !hasBarberPermission(permUser, item.permission as BarberPermissionKey)) {
      return false;
    }
    return true;
  }).map((item) => ({
    key: item.key,
    href: item.href,
    icon: item.icon,
    section: item.section,
    label: t(`barber.shell.nav.${item.key}`),
  }));

  const sectionLabels: Record<string, string> = {
    operacion: t("barber.shell.navSections.operacion"),
    negocio: t("barber.shell.navSections.negocio"),
    crecimiento: t("barber.shell.navSections.crecimiento"),
    cuenta: t("barber.shell.navSections.cuenta"),
  };

  return (
    <div className="barber-shell mf-extpanel flex min-h-screen font-sans">
      <BarberSidebar
        shopName={ctx.barbershop.name}
        items={items}
        sectionLabels={sectionLabels}
        brandName={t("barber.shell.brand.product")}
        brandSub={t("barber.shell.brand.vertical")}
        logoutLabel={t("barber.shell.logout")}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <BarberTopbar rootLabel={t("barber.shell.topbar.root")} shopName={ctx.barbershop.name} />
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
