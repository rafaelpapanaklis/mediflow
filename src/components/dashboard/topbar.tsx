"use client";

import { ChevronRight, Menu } from "lucide-react";
import { Fragment, useState, useMemo, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { CommandPalette } from "./command-palette";
import { CommandPaletteHint } from "./command-palette-hint";
import { KeyboardShortcutsPanel } from "./keyboard-shortcuts-panel";
import { NotificationsPopover } from "./notifications-popover";
import { TrialPill } from "./trial-pill";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useGoToShortcuts, useCreateShortcuts } from "@/lib/command-palette/shortcuts";
import type { ClinicPlan } from "./sidebar";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard":               "Hoy",
  "/dashboard/appointments":  "Agenda",
  "/dashboard/patients":      "Pacientes",
  "/dashboard/whatsapp":      "Mensajes",
  "/dashboard/clinical":      "Expedientes",
  "/dashboard/ai-assistant":  "IA asistente",
  "/dashboard/xrays":         "Radiografías",
  "/dashboard/before-after":  "Antes/Después",
  "/dashboard/formulas":      "Fórmulas",
  "/dashboard/exercises":     "Ejercicios",
  "/dashboard/orthotics":     "Ortesis",
  "/dashboard/treatments":    "Tratamientos",
  "/dashboard/packages":      "Paquetes",
  "/dashboard/resources":     "Recursos",
  "/dashboard/inventory":     "Inventario",
  "/dashboard/billing":       "Facturación",
  "/dashboard/reports":       "Reportes",
  "/dashboard/team":          "Equipo",
  "/dashboard/landing":       "Página web",
  "/dashboard/procedures":    "Procedimientos",
  "/dashboard/settings":      "Configuración",
};

function resolveCurrentLabel(pathname: string | null): string {
  if (!pathname) return "Hoy";
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  const match = Object.keys(ROUTE_LABELS)
    .filter((k) => k !== "/dashboard" && pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return ROUTE_LABELS[match];
  return "Hoy";
}

type TopbarProps = {
  clinicName: string;
  right?: ReactNode;
  trialEndsAt?: Date | string | null;
  plan?: ClinicPlan;
};

export function Topbar({
  clinicName,
  right,
  trialEndsAt,
  plan,
}: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const crumbs = useMemo(
    () => [clinicName, resolveCurrentLabel(pathname)],
    [clinicName, pathname],
  );
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

        {trialEndsAt && plan && (
          <TrialPill
            trialEndsAt={trialEndsAt}
            plan={plan}
            onUpgradeClick={() => router.push("/dashboard/settings?tab=subscription")}
          />
        )}

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
