export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission, type BarberPermissionKey } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { hasBarberPaidAccess } from "@/lib/barber/paid-access";
import { barberNavItemsWhileUnpaid } from "@/lib/barber/plan-shared";
import { BARBER_NAV_ITEMS, type BarberNavItem } from "@/lib/barber/types";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BarberSidebar } from "@/components/barber/barber-sidebar";
import { BarberTopbar } from "@/components/barber/barber-topbar";
import "@/app/panel-chrome-va.css";
import "../barber-theme.css";

/**
 * Shell del panel BARBER. Guard de sesión (espejo del layout de
 * /laboratorios): sin contexto → /login compartido.
 *
 * AQUÍ NO SE CORTA EL PASO. El layout envuelve también a /barber/suscripcion
 * y no sabe en qué ruta está (src/middleware.ts no cubre /barber, así que no
 * hay header x-pathname que leer): un redirect aquí sería un bucle infinito
 * contra la pantalla donde se paga. El candado real es por página —
 * requireBarberPaidAccess de @/lib/barber/paid-access — y lo vigila la
 * prueba src/lib/barber/__tests__/candado-suscripcion.test.ts.
 *
 * Lo que SÍ hace el layout es no mentir: con la suscripción impaga el menú
 * se recorta a lo único que se puede hacer (pagar), porque un sidebar
 * completo que redirige en cada clic se lee como una app rota, no como una
 * cuenta sin pagar.
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
  const paid = await hasBarberPaidAccess(ctx);

  // Impaga: solo la sección "cuenta" sin Configuración (helper PURO y ya
  // probado de plan-shared). El recorte va ANTES del filtro de plan/permiso
  // — no después: el orden importa porque Suscripción se indulta abajo.
  const navSource = paid ? BARBER_NAV_ITEMS : barberNavItemsWhileUnpaid(BARBER_NAV_ITEMS);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const items: BarberNavItem[] = navSource.filter((item) => {
    // Sin pagar, Suscripción se ve SIEMPRE, tenga o no billing.manage: la
    // pantalla ya deja verla en solo-lectura a cualquier rol, y si el
    // permiso la escondiera un empleado vería el menú VACÍO, sin una sola
    // pista de por qué su barbería dejó de funcionar.
    if (!paid && item.key === "suscripcion") return true;
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
