"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   Barra de pestañas de abajo. Cuatro destinos, pulgar-friendly.

   ⚠️ Este componente se pinta FUERA de .dcr-public (el elemento con
   container-type). Un position:fixed dentro de un contenedor se ancla al
   contenedor y la barra acabaría flotando a media pantalla. Ver la nota en
   realty-portal.css.

   Cada cara tiene SU menú. Un inquilino no ve una sola entrada de las del
   propietario, ni al revés — y aunque escribiera la URL a mano, el guard
   del servidor lo devuelve a su lado.
   ═══════════════════════════════════════════════════════════════════════ */

const TENANT_TABS = [
  { href: "/i/portal/inquilino", key: "nav.inquilinoInicio" },
  { href: "/i/portal/inquilino/pagos", key: "nav.inquilinoPagos" },
  { href: "/i/portal/inquilino/fallas", key: "nav.inquilinoFallas" },
  { href: "/i/portal/inquilino/documentos", key: "nav.inquilinoDocumentos" },
] as const;

const OWNER_TABS = [
  { href: "/i/portal/propietario", key: "nav.propietarioInicio" },
  { href: "/i/portal/propietario/estado-de-cuenta", key: "nav.propietarioEstado" },
  { href: "/i/portal/propietario/mantenimientos", key: "nav.propietarioMantenimientos" },
  { href: "/i/portal/propietario/contratos", key: "nav.propietarioContratos" },
] as const;

export function PortalTabs({ role }: { role: "INQUILINO" | "PROPIETARIO" }) {
  const t = useMemo(() => portalT(), []);
  const pathname = usePathname() ?? "";
  const tabs = role === "INQUILINO" ? TENANT_TABS : OWNER_TABS;

  return (
    <nav className="dcr-tabs" aria-label={t("marca.portal")}>
      {tabs.map((tab) => {
        // El inicio de cada cara solo se marca con coincidencia EXACTA: si
        // no, se queda encendido en las cuatro pantallas (todas cuelgan de
        // su ruta) y la barra deja de decir dónde estás.
        const activo =
          tab.href.endsWith("/inquilino") || tab.href.endsWith("/propietario")
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={activo ? "dcr-tab dcr-tab--on" : "dcr-tab"}
            aria-current={activo ? "page" : undefined}
          >
            <span className="dcr-tab__dot" aria-hidden="true" />
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
