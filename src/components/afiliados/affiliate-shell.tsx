"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Settings, LogOut, Menu, X, Handshake, BarChart3, FileText, Megaphone, Users } from "lucide-react";
import "@/app/panel-chrome-va.css";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/afiliados/inicio", label: "Inicio", icon: LayoutDashboard },
  { href: "/afiliados/herramientas", label: "Herramientas", icon: Megaphone },
  { href: "/afiliados/equipo", label: "Mi equipo", icon: Users },
  { href: "/afiliados/estadisticas", label: "Estadísticas", icon: BarChart3 },
  { href: "/afiliados/reportes", label: "Reportes", icon: FileText },
  { href: "/afiliados/configuracion", label: "Datos de pago", icon: Settings },
];

export function AffiliateShell({
  affiliateName,
  children,
}: {
  affiliateName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <div className="mf-extpanel dashboard-shell flex min-h-screen font-sans">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="icon-btn-new lg:hidden"
        style={{ position: "fixed", top: 12, left: 12, zIndex: 40 }}
        aria-label="Abrir menú"
      >
        <Menu size={14} />
      </button>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)", zIndex: 40 }}
          className="lg:hidden"
        />
      )}

      <aside
        className="sidebar-new"
        style={{
          zIndex: 41,
          position: mobileOpen ? "fixed" : undefined,
          left: mobileOpen ? 0 : undefined,
          top: mobileOpen ? 0 : undefined,
        }}
      >
        {/* Brand */}
        <div className="sidebar-new__brand">
          <div
            className="sidebar-new__logo"
            style={{
              background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
              boxShadow: "0 0 20px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
            }}
          >
            <Handshake size={14} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-new__brandname">DaleControl</div>
            <div className="sidebar-new__brandsub">Afiliados</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="icon-btn-new lg:hidden"
            style={{ marginLeft: 4 }}
            aria-label="Cerrar menú"
          >
            <X size={14} />
          </button>
        </div>

        {/* Nav */}
        <nav className="scrollbar-thin" style={{ flex: 1, overflowY: "auto", marginRight: -4, paddingRight: 4 }}>
          <div className="nav-section-new">Panel</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`nav-item-new ${active ? "nav-item-new--active" : ""}`}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {affiliateName}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Afiliado</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="icon-btn-new"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pt-20 lg:pt-6"
          style={{ padding: "clamp(12px, 1.5vw, 28px)", paddingTop: "clamp(16px, 2vw, 24px)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
