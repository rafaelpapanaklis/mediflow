export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { hasBarberPaidAccess } from "@/lib/barber/paid-access";
import type { BarberNavItem } from "@/lib/barber/types";
import { resolveBarberNav } from "@/lib/barber/nav";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { BARBER_LOGIN_PATH, BARBER_PRODUCT_NAME } from "@/lib/barber/marketing";
import { BARBER_CHANGE_PASSWORD_PATH } from "@/lib/barber/contrasena";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BarberSidebar } from "@/components/barber/barber-sidebar";
import { BarberTopbar } from "@/components/barber/barber-topbar";
import { BarberBranchBadge } from "@/components/barber/barber-branch-badge";
import { BarberSedePin } from "@/components/barber/barber-sede-pin";
import { RegistradorUso } from "@/components/barber/uso/registrador-uso";
import { listBranchOptions, readBranchCookie } from "@/lib/barber/branches";
import { BARBER_BRANCH_ALL } from "@/lib/barber/branch-cookie";
import { getBarberWaChatAcceso } from "@/lib/barber/wa-chat";
import { BarberWaChatProvider } from "@/components/barber/wa-chat";
import "@/app/panel-chrome-va.css";
import "../barber-theme.css";

// Título de la pestaña en TODO el panel. Sin esto se heredaba el del sitio,
// «DaleControl — Software para clínicas en México» (auditoría 14-nov, M12).
// `absolute` para que la plantilla del layout raíz no le cuelgue «| DaleControl».
export const metadata: Metadata = {
  title: { absolute: BARBER_PRODUCT_NAME },
  robots: { index: false, follow: false },
};

/**
 * Shell del panel BARBER. Guard de sesión: sin contexto → /barber/entrar,
 * la entrada propia del vertical (BARBER_LOGIN_PATH), no el /login dental.
 *
 * AQUÍ NO SE CORTA EL PASO. El layout envuelve también a /barber/suscripcion
 * y no sabe en qué ruta está (src/middleware.ts no cubre /barber, así que no
 * hay header x-pathname que leer): un redirect aquí sería un bucle infinito
 * contra la pantalla donde se paga. El candado real es por página —
 * requireBarberPaidAccess de @/lib/barber/paid-access — y lo vigila la
 * prueba src/lib/barber/__tests__/candado-suscripcion.test.ts.
 *
 * Lo que SÍ hace el layout es no mentir: con la suscripción impaga el menú
 * se recorta a lo único que se puede hacer (pagar o pedir ayuda), porque un sidebar
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
  if (!ctx) redirect(BARBER_LOGIN_PATH);
  // Contraseña temporal pendiente: primero la suya. La pantalla del cambio
  // vive FUERA de (panel), así que este redirect no puede hacer bucle.
  if (ctx.mustChangePassword) redirect(BARBER_CHANGE_PASSWORD_PATH);

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const paid = await hasBarberPaidAccess(ctx);
  // El menú sale de resolveBarberNav (nav.ts): el MISMO cálculo que vuelve a
  // pedir el menú en cada navegación interna (GET /api/barber/nav, m4), así
  // una entrada que se le quita a alguien desaparece sin recargar. Sin pagar,
  // se recorta a pagar o pedir ayuda (barberNavItemsWhileUnpaid).
  const items: BarberNavItem[] = await resolveBarberNav(ctx, { features: plan.features, paid });
  // «Administrar sucursales…» del selector de sede (sucursales-menu, ws6-t6) pide branches.manage.
  // Mismo permUser que nav.ts: hasBarberPermission ya trae el arreglo G1 (BARBER_NO_PERMISSIONS).
  // Unión pase 22: permisos-audit movió el menú a nav.ts y se llevó el import y permUser que esto usa.
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  // Sede activa en la barra de arriba (sucursales de verdad, 15-nov). Las
  // opciones son las que la sesión YA alcanza (getAccessibleBranchIds); con
  // una sola sede no se pinta nada.
  // ¿Los botones «WhatsApp» de un cliente abren Mensajes o wa.me? (ws6-t8)
  const [branchOptions, branchCookie, waChat] = await Promise.all([
    listBranchOptions(ctx).catch(() => []),
    readBranchCookie(),
    getBarberWaChatAcceso(ctx, plan, paid),
  ]);

  const sectionLabels: Record<string, string> = {
    operacion: t("barber.shell.navSections.operacion"),
    negocio: t("barber.shell.navSections.negocio"),
    crecimiento: t("barber.shell.navSections.crecimiento"),
    cuenta: t("barber.shell.navSections.cuenta"),
  };

  return (
    <div className="barber-shell barber-panel mf-extpanel flex min-h-screen font-sans">
      {/* Cada escritura lleva la sede de ESTA pantalla (ronda 2, M3). */}
      <BarberSedePin branchId={ctx.barbershopId} message={t("barber.shell.topbar.branchChanged")} />
      {/* Uso del panel (entradas, pantallas y toques) para /admin/barberias: ver registrador-uso.tsx. */}
      <RegistradorUso />
      <BarberSidebar
        shopName={ctx.barbershop.name}
        items={items}
        sectionLabels={sectionLabels}
        brandName={t("barber.shell.brand.product")}
        brandSub={t("barber.shell.brand.vertical")}
        logoutLabel={t("barber.shell.logout")}
        navLabel={t("barber.shell.navLabel")}
        unreadLabel={t("barber.shell.unreadChats")}
        unreadLabelOne={t("barber.shell.unreadChat")}
        loginHref={BARBER_LOGIN_PATH}
      />
      {/* min-w-0: sin él la columna crece hasta el ancho mínimo de su
          contenido (tablas, agenda) y en celular la página entera se desborda;
          con él, cada tabla hace scroll dentro de su propio contenedor. En
          escritorio ya valía 0 por el overflow-y-auto. */}
      <div className="barber-columna flex min-h-screen min-w-0 flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <BarberTopbar
          rootLabel={t("barber.shell.topbar.root")}
          shopName={ctx.barbershop.name}
          branch={
            <BarberBranchBadge
              options={branchOptions.map((b) => ({ id: b.id, label: b.label, isActive: b.isActive }))}
              activeId={ctx.barbershopId}
              consolidated={branchCookie === BARBER_BRANCH_ALL && branchOptions.length > 1}
              selectedId={branchCookie}
              manageHref={
                hasBarberPermission(permUser, "branches.manage") ? "/barber/sucursales" : null
              }
              labels={{
                branch: t("barber.shell.topbar.branch"),
                aria: t("barber.shell.topbar.branchAria"),
                all: t("barber.shell.topbar.branchAll"),
                closed: t("barber.shell.topbar.branchClosed"),
                closedGroup: t("barber.shell.topbar.branchClosedGroup"),
                manage: t("barber.shell.topbar.branchManage"),
              }}
            />
          }
        />
        {/* Sin pt-20: el padding en línea siempre lo pisó. La hamburguesa
            del celular vive sobre la barra superior, no sobre el contenido. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1"
          style={{
            padding: "clamp(12px, 1.5vw, 28px)",
            paddingTop: "clamp(16px, 2vw, 24px)",
          }}
        >
          <BarberWaChatProvider value={waChat}>{children}</BarberWaChatProvider>
        </main>
      </div>
    </div>
  );
}
