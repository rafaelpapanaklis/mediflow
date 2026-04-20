"use client";

import { Bell, HelpCircle, Search, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";

type TopbarProps = {
  crumbs?: string[];
  right?: ReactNode;
  hasNotifications?: boolean;
};

// Topbar compartido del dashboard (fase 1 — solo visible ≥lg para no
// duplicar la barra top móvil que renderiza el Sidebar).
export function Topbar({
  crumbs = ["Dashboard"],
  right,
  hasNotifications = false,
}: TopbarProps) {
  return (
    <div className="topbar-new hidden lg:flex">
      <div className="topbar-new__crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={`${i}-${c}`}>
            {i > 0 && (
              <ChevronRight size={12} style={{ color: "var(--text-4)" }} />
            )}
            <span className={i === crumbs.length - 1 ? "topbar-new__crumb--current" : ""}>
              {c}
            </span>
          </Fragment>
        ))}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {right}

        <div className="topbar-new__search">
          <Search size={12} />
          <span>Buscar pacientes, citas…</span>
          <kbd>⌘K</kbd>
        </div>

        <button className="icon-btn-new" title="Notificaciones" type="button">
          <Bell size={14} />
          {hasNotifications && <span className="icon-btn-new__dot" />}
        </button>

        <button className="icon-btn-new" title="Ayuda" type="button">
          <HelpCircle size={14} />
        </button>
      </div>
    </div>
  );
}
