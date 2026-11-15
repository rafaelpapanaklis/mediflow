"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { BarberNavItem } from "@/lib/barber/types";
import { BARBER_NAV_ICON, BarberIcon } from "./barber-icons";

/**
 * Menú lateral del panel BARBER — rediseño 15-nov-2026 (el menú de la
 * propuesta C que eligió Rafael, con la letra y los tamaños del panel).
 *
 *  · Arriba, el rótulo: el poste de barbero, «Barbería» chico y el NOMBRE DE
 *    LA BARBERÍA de la sesión en grande. «DaleControl» baja al pie, discreto.
 *  · Secciones en minúsculas discretas; cada entrada con su icono del oficio
 *    (src/components/barber/barber-icons.tsx); la activa, pastilla crema.
 *  · Los items, su orden, permisos y el recorte sin pagar NO se deciden
 *    aquí: llegan ya resueltos del layout (server). El menú solo pinta.
 *  · Estilos: .barber-menu* en src/app/barber/barber-theme.css.
 */

const SECTION_ORDER: BarberNavItem["section"][] = [
  "operacion",
  "negocio",
  "crecimiento",
  "cuenta",
];

export function BarberSidebar({
  shopName,
  items,
  sectionLabels,
  brandName,
  brandSub,
  logoutLabel,
  loginHref,
}: {
  shopName: string;
  items: BarberNavItem[];
  sectionLabels: Record<string, string>;
  brandName: string;
  brandSub: string;
  logoutLabel: string;
  /** A dónde ir al cerrar sesión: la entrada del vertical (/barber/entrar). */
  loginHref: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/barber/auth/logout", { method: "POST" });
    } finally {
      // A la entrada PROPIA del vertical, no al /login de las clínicas.
      window.location.href = loginHref;
    }
  }

  function isActive(href: string) {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + "/");
  }

  const sections = SECTION_ORDER.map((section) => ({
    section,
    label: sectionLabels[section] ?? section,
    items: items.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  // El rótulo lleva a Inicio solo si Inicio está en el menú (sin pagar no lo está).
  const homeHref = items.find((i) => i.key === "inicio")?.href ?? null;

  const rotulo = (
    <>
      <span className="barber-menu__poste" aria-hidden="true">
        <span />
      </span>
      <span className="barber-menu__rotulo-txt">
        <span className="barber-menu__sobre">{brandSub}</span>
        <span className="barber-menu__nombre" title={shopName}>
          {shopName}
        </span>
      </span>
    </>
  );

  return (
    <>
      {/* Hamburguesa móvil. Posición y tamaño: .barber-menu-btn en
          barber-theme.css (queda sobre la barra superior, que en celular
          deja libre ese hueco a la izquierda de las migas). */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="icon-btn-new barber-menu-btn lg:hidden"
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
        aria-controls="barber-sidebar"
      >
        <BarberIcon name="rayas" size={18} />
      </button>

      {/* Velo móvil */}
      {mobileOpen && (
        <div onClick={() => setMobileOpen(false)} className="barber-menu-veil lg:hidden" />
      )}

      {/* En celular (<lg) el menú NO ocupa sitio: barber-theme.css lo
          esconde y solo lo muestra, flotando sobre la pantalla, cuando lleva
          .barber-sidebar--open. En escritorio esa clase no hace nada. */}
      <aside
        id="barber-sidebar"
        className={`sidebar-new barber-menu${mobileOpen ? " barber-sidebar--open" : ""}`}
        style={{ zIndex: 41 }}
      >
        <div className="barber-menu__cab">
          {homeHref ? (
            <Link href={homeHref} className="barber-menu__rotulo" onClick={() => setMobileOpen(false)}>
              {rotulo}
            </Link>
          ) : (
            <div className="barber-menu__rotulo">{rotulo}</div>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="barber-menu__cerrar lg:hidden"
            aria-label="Cerrar menú"
          >
            <BarberIcon name="equis" size={16} />
          </button>
        </div>

        {/* Navegación (gating por plan + rol ya resuelto en el layout server) */}
        <nav className="barber-menu__nav" aria-label="Menú principal">
          {sections.map((s) => (
            <div key={s.section} className="barber-menu__grupo">
              <p className="barber-menu__titulo" id={`barber-menu-${s.section}`}>
                {s.label}
              </p>
              <ul className="barber-menu__lista" aria-labelledby={`barber-menu-${s.section}`}>
                {s.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className="barber-menu__ent"
                      >
                        <BarberIcon name={BARBER_NAV_ICON[item.key] ?? "poste"} size={18} />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="barber-menu__pie">
          <button type="button" onClick={handleLogout} className="barber-menu__ent barber-menu__salir">
            <BarberIcon name="salir" size={18} />
            <span>{logoutLabel}</span>
          </button>
          <div className="barber-menu__marca">{brandName}</div>
        </div>
      </aside>
    </>
  );
}
