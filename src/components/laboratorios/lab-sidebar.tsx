"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  ClipboardList,
  Wrench,
  MessageCircle,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { Logo } from "@/components/public/landing/primitives/logo";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/laboratorios/inicio",        label: "Inicio",        icon: Home },
  { href: "/laboratorios/pedidos",       label: "Pedidos",       icon: ClipboardList },
  { href: "/laboratorios/servicios",     label: "Servicios",     icon: Wrench },
  { href: "/laboratorios/chats",         label: "Chats",         icon: MessageCircle },
  { href: "/laboratorios/configuracion", label: "Configuración", icon: Settings },
];

export function LabSidebar({
  labName,
}: {
  labName: string;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/laboratorios/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/laboratorios/login";
    }
  }

  function isActive(href: string) {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItem(item: NavItem) {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-current={active ? "page" : undefined}
        className={`nav-item-new ${active ? "nav-item-new--active" : ""}`}
      >
        <Icon size={16} />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <>
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

      {/* Overlay on mobile */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
            zIndex: 40,
          }}
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
          <div className="sidebar-new__logo">
            <Logo size={20} showText={false} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-new__brandname">DaleControl</div>
            <div className="sidebar-new__brandsub">Laboratorio</div>
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
        <nav
          className="scrollbar-thin"
          style={{ flex: 1, overflowY: "auto", marginRight: -4, paddingRight: 4 }}
        >
          <div className="nav-section-new">Panel</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map(renderItem)}
          </div>
        </nav>

        {/* Footer */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 12,
            borderTop: "1px solid var(--border-soft)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-1)",
              padding: "0 8px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={labName}
          >
            {labName}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="nav-item-new"
            style={{
              color: "var(--danger)",
              width: "100%",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <LogOut size={16} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}
