"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Building2, CreditCard, TrendingDown, CheckSquare,
  BarChart3, Megaphone, Ticket, Settings, LogOut, Menu, X,
} from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import toast from "react-hot-toast";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
  section: "main" | "growth" | "system";
};

const NAV_ITEMS: NavItem[] = [
  { href: "/admin",              label: "Dashboard",    icon: LayoutDashboard, section: "main"   },
  { href: "/admin/clinics",      label: "Clínicas",     icon: Building2,       section: "main"   },
  { href: "/admin/payments",     label: "Pagos",        icon: CreditCard,      section: "main"   },
  { href: "/admin/churn",        label: "Retención",    icon: TrendingDown,    section: "main"   },
  { href: "/admin/onboarding",   label: "Onboarding",   icon: CheckSquare,     section: "main"   },
  { href: "/admin/reports",      label: "Reportes",     icon: BarChart3,       section: "growth" },
  { href: "/admin/announcements",label: "Anuncios",     icon: Megaphone,       section: "growth" },
  { href: "/admin/coupons",      label: "Cupones",      icon: Ticket,          section: "growth" },
  { href: "/admin/settings",     label: "Configuración",icon: Settings,        section: "system" },
];

export function AdminSidebar({ counts }: { counts?: { clinics?: number; atRisk?: number } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      const res = await fetch("/api/admin/logout", { method: "POST" });
      if (!res.ok) throw new Error("Logout failed");
      router.push("/admin/login");
    } catch {
      toast.error("Error al cerrar sesión");
    }
  }

  const mainItems   = NAV_ITEMS.filter(i => i.section === "main");
  const growthItems = NAV_ITEMS.filter(i => i.section === "growth");
  const systemItems = NAV_ITEMS.filter(i => i.section === "system");

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  function renderItem(item: NavItem) {
    const active = isActive(item.href);
    const Icon   = item.icon;
    let count: number | undefined;
    if (item.href === "/admin/clinics") count = counts?.clinics;
    if (item.href === "/admin/churn")   count = counts?.atRisk;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`nav-item-new ${active ? "nav-item-new--active" : ""}`}
      >
        <Icon size={14} />
        <span>{item.label}</span>
        {typeof count === "number" && count > 0 && (
          <span className="nav-item-new__count">{count}</span>
        )}
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
          <div
            className="sidebar-new__logo"
            style={{
              background: "linear-gradient(135deg, #dc2626, #7c3aed)",
              boxShadow: "0 0 20px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-new__brandname">MediFlow</div>
            <div className="sidebar-new__brandsub">Panel admin</div>
          </div>
          <BadgeNew tone="brand">OWNER</BadgeNew>
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
          <div className="nav-section-new">Principal</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {mainItems.map(renderItem)}
          </div>

          <div className="nav-section-new">Crecimiento</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {growthItems.map(renderItem)}
          </div>

          <div className="nav-section-new">Sistema</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {systemItems.map(renderItem)}
          </div>
        </nav>

        {/* Footer */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8 }}>
            <AvatarNew name="Super Admin" size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>Super Admin</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Platform owner
              </div>
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
    </>
  );
}

/** @deprecated kept for backwards compat — use AdminSidebar */
export function AdminNav() {
  return <AdminSidebar />;
}
