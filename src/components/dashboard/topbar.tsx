"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette } from "./command-palette";
import { CommandPaletteHint } from "./command-palette-hint";
import { KeyboardShortcutsPanel } from "./keyboard-shortcuts-panel";
import { NotificationsPopover } from "./notifications-popover";
import { useCommandPalette } from "@/hooks/use-command-palette";
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
  const modalsClosed = !paletteOpen && !shortcutsOpen;

  useGoToShortcuts({ enabled: modalsClosed });
  useCreateShortcuts({
    enabled: modalsClosed,
    onCreateAppointment: () => router.push("/dashboard/appointments?new=1"),
    onCreatePatient:     () => router.push("/dashboard/patients?new=1"),
    onCreateInvoice:     () => router.push("/dashboard/billing?new=1"),
    onCreateSoap:        () => {
      // TODO(Fase 2.3): conectar con useActiveConsult()
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
          <CommandPaletteHint onClick={() => setPaletteOpen(true)} />
          <NotificationsPopover />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsPanel open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
