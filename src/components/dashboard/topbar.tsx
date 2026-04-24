"use client";

import { ChevronRight, Menu } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CommandPalette } from "./command-palette";
import { CommandPaletteHint } from "./command-palette-hint";
import { KeyboardShortcutsPanel } from "./keyboard-shortcuts-panel";
import { NotificationsPopover } from "./notifications-popover";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useGoToShortcuts, useCreateShortcuts } from "@/lib/command-palette/shortcuts";

type TopbarProps = {
  crumbs?: string[];
  right?: ReactNode;
};

export function Topbar({
  crumbs = ["Dashboard"],
  right,
}: TopbarProps) {
  const router = useRouter();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { consult } = useActiveConsult();
  const modalsClosed = !paletteOpen && !shortcutsOpen;

  useGoToShortcuts({ enabled: modalsClosed });
  useCreateShortcuts({
    enabled: modalsClosed,
    onCreateAppointment: () => router.push("/dashboard/appointments?new=1"),
    onCreatePatient:     () => router.push("/dashboard/patients?new=1"),
    onCreateInvoice:     () => router.push("/dashboard/billing?new=1"),
    onCreateSoap: () => {
      if (consult) {
        router.push(`/dashboard/patients/${consult.patientId}?tab=soap&new=1`);
      } else {
        toast("Inicia una consulta primero", { icon: "ℹ️" });
      }
    },
    onToggleTheme: () => {
      const html = document.documentElement;
      const isDark = html.classList.contains("dark");
      html.classList.toggle("dark");
      try { localStorage.setItem("theme", isDark ? "light" : "dark"); } catch {}
    },
  });

  return (
    <>
      <div className="topbar-new">
        <button
          type="button"
          aria-label="Abrir navegación"
          onClick={() => window.dispatchEvent(new CustomEvent("mf:open-mobile-sidebar"))}
          className="lg:hidden"
          style={{
            width: 32, height: 32,
            display: "grid", placeItems: "center",
            borderRadius: 8,
            background: "var(--bg-hover)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-2)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Menu size={16} />
        </button>

        <div className="topbar-new__crumbs hidden lg:flex">
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

        <div className="hidden lg:flex" style={{ marginLeft: "auto", alignItems: "center", gap: 8 }}>
          {right}
          <CommandPaletteHint onClick={() => setPaletteOpen(true)} />
          <NotificationsPopover />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsPanel open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
