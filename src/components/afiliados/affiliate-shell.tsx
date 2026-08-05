"use client";

/**
 * Shell del panel de AFILIADO — diseño Panel-Afiliado-DaleControl.dc.html.
 *
 * Sidebar blanco de 250px con marca, navegación y la ficha del usuario abajo.
 * Todo el estilo vive en src/app/afiliados/panel.css (namespace `dcafp`);
 * aquí solo hay estructura y el estado del cajón móvil.
 *
 * Sigue llevando `mf-extpanel dashboard-shell`: la primera la usan los
 * componentes hijos que aún no migran a las clases `dcafp` (icon-btn-new,
 * badge-new), y la segunda es el gancho de `body:has(.dashboard-shell)` en
 * globals.css que pone la rampa VIOLETA de marca. Quitarlas devolvería el
 * azul al panel.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  CreditCard,
  FileText,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import "@/app/panel-chrome-va.css";
import "@/app/afiliados/panel.css";
import { PanelToast } from "./ui/panel-toast";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/afiliados/inicio", label: "Inicio", icon: Home },
  { href: "/afiliados/herramientas", label: "Herramientas", icon: SlidersHorizontal },
  { href: "/afiliados/equipo", label: "Mi equipo", icon: Users },
  { href: "/afiliados/estadisticas", label: "Estadísticas", icon: BarChart3 },
  { href: "/afiliados/reportes", label: "Reportes", icon: FileText },
  { href: "/afiliados/configuracion", label: "Datos de pago", icon: CreditCard },
  { href: "/afiliados/soporte", label: "Soporte", icon: HelpCircle },
];

/** Iniciales para el avatar. Dos como máximo: con tres se vuelven ilegibles a 36px. */
export function initialsOf(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AffiliateShell({
  affiliateName,
  children,
}: {
  affiliateName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // El cajón se cierra al navegar. Sin esto queda abierto sobre la página
  // nueva y hay que tocar el velo para verla.
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
              <div className="dcafp-brand__sub">Afiliados</div>
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
              {initialsOf(affiliateName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dcafp-user__name">{affiliateName}</div>
              <div className="dcafp-user__role">Afiliado</div>
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
