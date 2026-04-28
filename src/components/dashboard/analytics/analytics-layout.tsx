"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Grid3x3,
  Stethoscope,
  ListChecks,
  AlertCircle,
  Clock,
  DollarSign,
  Route,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

interface TabDef {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: "overview",     label: "Resumen",       href: "/dashboard/analytics",            icon: BarChart3 },
  { id: "occupancy",    label: "Ocupación",     href: "/dashboard/analytics/occupancy",  icon: Grid3x3 },
  { id: "doctors",      label: "Doctores",      href: "/dashboard/analytics/doctors",    icon: Stethoscope },
  { id: "procedures",   label: "Procedimientos",href: "/dashboard/analytics/procedures", icon: ListChecks },
  { id: "no-shows",     label: "No-shows",      href: "/dashboard/analytics/no-shows",   icon: AlertCircle },
  { id: "waiting",      label: "Sala de espera",href: "/dashboard/analytics/waiting",    icon: Clock },
  { id: "costs",        label: "Costos & Margen",href:"/dashboard/analytics/costs",      icon: DollarSign },
  { id: "journey",      label: "Patient Journey",href:"/dashboard/analytics/journey",    icon: Route },
];

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
  rightActions?: ReactNode;
}

export function AnalyticsLayout({ children, title, subtitle, rightActions }: Props) {
  const pathname = usePathname();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gap: 20,
        padding: "clamp(14px, 1.6vw, 28px)",
        maxWidth: 1500,
        margin: "0 auto",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      {/* Sidebar tabs */}
      <aside
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          padding: 8,
          height: "fit-content",
          position: "sticky",
          top: 80,
        }}
        aria-label="Secciones de Analytics"
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "8px 10px 6px",
          }}
        >
          Analytics
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {TABS.map((tab) => {
            const isActive =
              tab.href === "/dashboard/analytics"
                ? pathname === tab.href
                : pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.id}
                href={tab.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  fontSize: 13,
                  fontWeight: 500,
                  color: isActive ? "var(--brand)" : "var(--text-2)",
                  background: isActive ? "var(--brand-softer)" : "transparent",
                  borderRadius: 8,
                  textDecoration: "none",
                  transition: "background 0.12s, color 0.12s",
                }}
              >
                <tab.icon size={14} aria-hidden style={{ flexShrink: 0 }} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main style={{ minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 22,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "clamp(18px, 1.5vw, 24px)",
                letterSpacing: "-0.02em",
                color: "var(--text-1)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              {title}
            </h1>
            {subtitle && (
              <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
                {subtitle}
              </p>
            )}
          </div>
          {rightActions && <div style={{ display: "flex", gap: 8 }}>{rightActions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
