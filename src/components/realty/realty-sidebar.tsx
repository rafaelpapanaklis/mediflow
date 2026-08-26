"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Building2,
  Calculator,
  CalendarCheck,
  Contact,
  CreditCard,
  FileText,
  Globe,
  Home,
  LifeBuoy,
  LogOut,
  Menu,
  MessageCircle,
  Percent,
  Settings,
  Share2,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { RealtyNavItem } from "@/lib/realty/types";

// Mapa icono-por-nombre: el layout (server) manda items SERIALIZABLES y aquí
// se resuelve el componente lucide. Mismo patrón que BarberSidebar.
//
// ⚠️ Un nombre que no esté en este mapa cae al fallback en SILENCIO. Si
// agregas un item a REALTY_NAV_ITEMS con un icono nuevo, agrégalo también
// aquí — si no, sale un edificio genérico y nadie se entera.
const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  home: Home,
  building: Building2,
  users: Users,
  "calendar-check": CalendarCheck,
  "file-text": FileText,
  wallet: Wallet,
  contact: Contact,
  percent: Percent,
  "user-plus": UserPlus,
  chart: BarChart3,
  globe: Globe,
  share: Share2,
  "message-circle": MessageCircle,
  calculator: Calculator,
  "shield-check": ShieldCheck,
  "credit-card": CreditCard,
  settings: Settings,
  "life-buoy": LifeBuoy,
};

const SECTION_ORDER: RealtyNavItem["section"][] = [
  "operacion",
  "arrendamiento",
  "negocio",
  "crecimiento",
  "cuenta",
];

export function RealtySidebar({
  accountName,
  items,
  sectionLabels,
  brandName,
  brandSub,
  logoutLabel,
}: {
  accountName: string;
  items: RealtyNavItem[];
  sectionLabels: Record<string, string>;
  brandName: string;
  brandSub: string;
  logoutLabel: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/realty/auth/logout", { method: "POST" });
    } finally {
      // El login es el COMPARTIDO (/login) — inmuebles no tiene login propio.
      window.location.href = "/login";
    }
  }

  function isActive(href: string) {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItem(item: RealtyNavItem) {
    const active = isActive(item.href);
    const Icon = ICONS[item.icon] ?? Building2;
    return (
      <Link
        key={item.key}
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

  // El filtrado por MODO, PLAN y ROL ya se hizo en el layout (server). Aquí
  // solo se agrupa. Las secciones que se quedan sin items no se pintan: así
  // un asesor independiente no ve un encabezado "Negocio" vacío.
  const sections = SECTION_ORDER.map((section) => ({
    section,
    label: sectionLabels[section] ?? section,
    items: items.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      {/* Hamburguesa móvil */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="icon-btn-new lg:hidden"
        style={{ position: "fixed", top: 12, left: 12, zIndex: 40 }}
        aria-label="Abrir menú"
      >
        <Menu size={14} />
      </button>

      {/* Overlay móvil */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,32,26,0.5)",
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
        {/* Marca */}
        <div className="sidebar-new__brand">
          <div
            className="sidebar-new__logo"
            style={{
              background: "var(--brand-grad, linear-gradient(135deg, #2F6B4D, #3F8461))",
              display: "grid",
              placeItems: "center",
              color: "#fff",
            }}
          >
            <Building2 size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-new__brandname">{brandName}</div>
            <div className="sidebar-new__brandsub">{brandSub}</div>
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

        {/* Navegación (modo + plan + rol ya resueltos en el layout server) */}
        <nav
          className="scrollbar-thin"
          style={{ flex: 1, overflowY: "auto", marginRight: -4, paddingRight: 4 }}
        >
          {sections.map((s) => (
            <div key={s.section}>
              <div className="nav-section-new">{s.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {s.items.map(renderItem)}
              </div>
            </div>
          ))}
        </nav>

        {/* Pie */}
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
            title={accountName}
          >
            {accountName}
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
            <span>{logoutLabel}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
