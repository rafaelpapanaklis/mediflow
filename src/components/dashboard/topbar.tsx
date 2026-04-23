"use client";

import { Search, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CommandPalette } from "./command-palette";
import { NotificationsPopover } from "./notifications-popover";

type TopbarProps = {
  crumbs?: string[];
  right?: ReactNode;
};

export function Topbar({
  crumbs = ["Dashboard"],
  right,
}: TopbarProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
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

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="topbar-new__search"
            style={{ cursor: "pointer", border: "1px solid var(--border-soft)", textAlign: "left" }}
          >
            <Search size={12} />
            <span>Buscar pacientes, citas…</span>
            <kbd>⌘K</kbd>
          </button>

          <NotificationsPopover />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
