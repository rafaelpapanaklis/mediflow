"use client";

// Layout del módulo Marketing (WS-MKT-T1 foundation). Submenú responsive con
// las 7 secciones del plan §2, resaltando la activa con usePathname, y render
// de {children}. Las páginas hijas son server components (cada dueño T2–T6 las
// llena). Estilo alineado con los tokens del panel (var(--brand), etc.).

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Megaphone,
  LayoutDashboard,
  Sparkles,
  PencilLine,
  CalendarDays,
  Library,
  Link2,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

interface MktTab {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

const TABS: MktTab[] = [
  { id: "overview",    label: "Resumen",     href: "/dashboard/marketing",             icon: LayoutDashboard },
  { id: "studio",      label: "Estudio IA",  href: "/dashboard/marketing/studio",      icon: Sparkles },
  { id: "composer",    label: "Crear post",  href: "/dashboard/marketing/composer",    icon: PencilLine },
  { id: "calendar",    label: "Calendario",  href: "/dashboard/marketing/calendar",    icon: CalendarDays },
  { id: "library",     label: "Biblioteca",  href: "/dashboard/marketing/library",     icon: Library },
  { id: "connections", label: "Conexiones",  href: "/dashboard/marketing/connections", icon: Link2 },
  { id: "insights",    label: "Métricas",    href: "/dashboard/marketing/insights",    icon: BarChart3 },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div
      className="mkt-root"
      style={{
        padding: "clamp(14px, 1.6vw, 28px)",
        maxWidth: 1500,
        margin: "0 auto",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      {/* Capa de a11y + movimiento para todo el módulo (una sola vez):
          anillo de foco visible por teclado, respeto a prefers-reduced-motion
          y transición suave al cambiar de sección del submenú. */}
      <style>{`
        .mkt-root a:focus-visible,
        .mkt-root button:focus-visible,
        .mkt-root [role="button"]:focus-visible,
        .mkt-root [tabindex]:not([tabindex="-1"]):focus-visible {
          outline: 2px solid var(--brand);
          outline-offset: 2px;
          border-radius: 8px;
        }
        .mkt-fade { animation: mkt-fade-in 0.18s ease-out both; }
        @keyframes mkt-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .mkt-root *, .mkt-root *::before, .mkt-root *::after {
            animation-duration: 0.001ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.001ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: "clamp(18px, 1.5vw, 24px)",
            letterSpacing: "-0.02em",
            color: "var(--text-1)",
            fontWeight: 600,
            margin: 0,
          }}
        >
          <Megaphone size={22} aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }} />
          Marketing
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, margin: "4px 0 0" }}>
          Crea contenido con IA, programa publicaciones y conecta tus redes.
        </p>
      </header>

      {/* Submenú: tira de pestañas responsive (scroll horizontal en pantallas chicas). */}
      <nav
        aria-label="Secciones de Marketing"
        style={{
          display: "flex",
          gap: 4,
          overflowX: "auto",
          padding: 6,
          marginBottom: 22,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          scrollbarWidth: "thin",
        }}
      >
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/dashboard/marketing"
              ? pathname === tab.href
              : pathname?.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: "nowrap",
                color: isActive ? "var(--brand)" : "var(--text-2)",
                background: isActive ? "var(--brand-softer)" : "transparent",
                borderRadius: 9,
                textDecoration: "none",
                transition: "background 0.12s, color 0.12s",
              }}
            >
              <Icon size={15} aria-hidden style={{ flexShrink: 0 }} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <main key={pathname} className="mkt-fade" style={{ minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
