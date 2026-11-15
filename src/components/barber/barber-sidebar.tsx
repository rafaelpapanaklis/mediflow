"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Calendar,
  Contact,
  CreditCard,
  Crown,
  Globe,
  Home,
  Inbox,
  LifeBuoy,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Percent,
  Scissors,
  Settings,
  Timer,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { BarberNavItem } from "@/lib/barber/types";

// Mapa icono-por-nombre: el layout (server) manda items serializables y aquí
// se resuelve el componente lucide. Mismo patrón visual que LabSidebar.
const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  home: Home,
  calendar: Calendar,
  timer: Timer,
  inbox: Inbox,
  users: Users,
  scissors: Scissors,
  contact: Contact,
  wallet: Wallet,
  percent: Percent,
  crown: Crown,
  package: Package,
  globe: Globe,
  "message-circle": MessageCircle,
  "credit-card": CreditCard,
  settings: Settings,
  "life-buoy": LifeBuoy,
};

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

  function renderItem(item: BarberNavItem) {
    const active = isActive(item.href);
    const Icon = ICONS[item.icon] ?? Scissors;
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

  const sections = SECTION_ORDER.map((section) => ({
    section,
    label: sectionLabels[section] ?? section,
    items: items.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

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
        <Menu size={16} />
      </button>

      {/* Overlay móvil */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(18,16,16,0.5)",
            backdropFilter: "blur(2px)",
            zIndex: 40,
          }}
          className="lg:hidden"
        />
      )}

      {/* En celular (<lg) el menú NO ocupa sitio: barber-theme.css lo
          esconde y solo lo muestra, flotando sobre la pantalla, cuando lleva
          .barber-sidebar--open. En escritorio esa clase no hace nada. */}
      <aside
        id="barber-sidebar"
        className={`sidebar-new${mobileOpen ? " barber-sidebar--open" : ""}`}
        style={{ zIndex: 41 }}
      >
        {/* Marca */}
        <div className="sidebar-new__brand">
          <div
            className="sidebar-new__logo"
            style={{
              background: "var(--brand-grad, linear-gradient(135deg, #A2612F, #BE7A3C))",
              display: "grid",
              placeItems: "center",
              color: "#fff",
            }}
          >
            <Scissors size={18} />
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

        {/* Navegación (gating por plan + rol ya resuelto en el layout server) */}
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
            title={shopName}
          >
            {shopName}
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
