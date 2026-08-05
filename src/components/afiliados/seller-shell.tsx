"use client";

/**
 * Shell del panel del VENDEDOR (equipo) — espejo de affiliate-shell.tsx.
 *
 * Mismo lenguaje visual (panel.css, namespace `dcafp`), mismo cajón móvil y
 * mismo logout. Cambian el subtítulo de marca ("Vendedor"), el pie —que
 * nombra al afiliado padre— y el NAV, reducido a Inicio, Herramientas y
 * Datos de pago.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CreditCard, Home, LogOut, Menu, SlidersHorizontal, X } from "lucide-react";
import "@/app/panel-chrome-va.css";
import "@/app/afiliados/panel.css";
import { PanelToast } from "./ui/panel-toast";
import { initialsOf } from "./affiliate-shell";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/afiliados/vendedor/inicio", label: "Inicio", icon: Home },
  { href: "/afiliados/vendedor/herramientas", label: "Herramientas", icon: SlidersHorizontal },
  { href: "/afiliados/vendedor/configuracion", label: "Datos de pago", icon: CreditCard },
];

export function SellerShell({
  sellerName,
  parentName,
  children,
}: {
  sellerName: string;
  parentName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    try {
      await fetch("/api/afiliados/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/afiliados/login";
    }
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="dcafp mf-extpanel dashboard-shell font-sans">
      <div className="dcafp-shell">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="dcafp-burger"
          aria-label="Abrir menú"
          aria-expanded={mobileOpen}
        >
          <Menu size={18} />
        </button>

        {mobileOpen && <div className="dcafp-veil" onClick={() => setMobileOpen(false)} aria-hidden />}

        <aside className={`dcafp-side ${mobileOpen ? "dcafp-side--open" : ""}`}>
          <div className="dcafp-brand">
            <div className="dcafp-brand__logo" aria-hidden>
              <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1 }}>D</span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="dcafp-brand__name">DaleControl</div>
              <div className="dcafp-brand__sub">Vendedor</div>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="dcafp-iconbtn dcafp-iconbtn--bare dcafp-side__close"
              aria-label="Cerrar menú"
            >
              <X size={18} />
            </button>
          </div>

          <div className="dcafp-navkicker">PANEL</div>

          <nav className="dcafp-nav" aria-label="Navegación principal">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`dcafp-navitem ${active ? "dcafp-navitem--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="dcafp-spacer" style={{ flex: 1 }} />

          <div className="dcafp-user">
            <div className="dcafp-avatar" aria-hidden>
              {initialsOf(sellerName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dcafp-user__name">{sellerName}</div>
              <div className="dcafp-user__role">Vendedor de {parentName}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="dcafp-iconbtn dcafp-iconbtn--bare"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>

        <main id="main-content" tabIndex={-1} className="dcafp-main">
          {children}
        </main>
      </div>

      <PanelToast />
    </div>
  );
}
