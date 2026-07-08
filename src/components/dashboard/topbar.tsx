"use client";

import { ChevronRight, Menu } from "lucide-react";
import { Fragment, useState, useMemo, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { CommandPalette } from "./command-palette";
import { CommandPaletteHint } from "./command-palette-hint";
import { KeyboardShortcutsPanel } from "./keyboard-shortcuts-panel";
import { NotificationsPopover } from "./notifications-popover";
import { InsightsPopover } from "./insights-popover";
import { TrialPill } from "./trial-pill";
import { WaitingRoomAlert } from "./waiting-room-alert";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import { useGoToShortcuts, useCreateShortcuts } from "@/lib/command-palette/shortcuts";
import { useT } from "@/i18n/i18n-provider";
import type { ClinicPlan } from "./sidebar";

// Mapa ruta -> clave de traducción. El valor visible se resuelve con t() en
// tiempo de render (resolveCurrentLabel recibe la t del componente).
const ROUTE_LABELS: Record<string, string> = {
  "/dashboard":               "shell.topbar.routeHoy",
  "/dashboard/agenda":        "shell.topbar.routeAgenda",
  "/dashboard/appointments":  "shell.topbar.routeAgenda",
  "/dashboard/patients":      "shell.topbar.routePacientes",
  "/dashboard/whatsapp":      "shell.topbar.routeMensajes",
  "/dashboard/ai-assistant":  "shell.topbar.routeIaAsistente",
  "/dashboard/xrays":         "shell.topbar.routeRadiografias",
  "/dashboard/before-after":  "shell.topbar.routeAntesDespues",
  "/dashboard/formulas":      "shell.topbar.routeFormulas",
  "/dashboard/exercises":     "shell.topbar.routeEjercicios",
  "/dashboard/orthotics":     "shell.topbar.routeOrtesis",
  "/dashboard/packages":      "shell.topbar.routePaquetes",
  "/dashboard/resources":         "shell.topbar.routeRecursos",
  "/dashboard/resource-bookings": "shell.topbar.routeReservasLegacy",
  "/dashboard/inventory":     "shell.topbar.routeInventario",
  "/dashboard/caja":          "shell.topbar.routeCaja",
  "/dashboard/billing":       "shell.topbar.routeFacturacion",
  "/dashboard/reports":       "shell.topbar.routeReportes",
  "/dashboard/team":          "shell.topbar.routeEquipo",
  "/dashboard/landing":       "shell.topbar.routePaginaWeb",
  "/dashboard/procedures":    "shell.topbar.routeProcedimientos",
  "/dashboard/settings":      "shell.topbar.routeConfiguracion",
};

function resolveCurrentLabelKey(pathname: string | null): string {
  if (!pathname) return "shell.topbar.routeHoy";
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  const match = Object.keys(ROUTE_LABELS)
    .filter((k) => k !== "/dashboard" && pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return ROUTE_LABELS[match];
  return "shell.topbar.routeHoy";
}

type UserRole = "SUPER_ADMIN" | "ADMIN" | "DOCTOR" | "RECEPTIONIST" | "READONLY" | "ACCOUNTANT";

type TopbarProps = {
  clinicName: string;
  right?: ReactNode;
  trialEndsAt?: Date | string | null;
  plan?: ClinicPlan;
  userRole?: UserRole;
};

export function Topbar({
  clinicName,
  right,
  trialEndsAt,
  plan,
  userRole,
}: TopbarProps) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const crumbs = useMemo(
    () => [clinicName, t(resolveCurrentLabelKey(pathname))],
    [clinicName, pathname, t],
  );
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { consult } = useActiveConsult();
  const { open: openAppt } = useNewAppointmentDialog();
  const { open: openPatient } = useNewPatientDialog();
  const modalsClosed = !paletteOpen && !shortcutsOpen;

  useGoToShortcuts({ enabled: modalsClosed });
  useCreateShortcuts({
    enabled: modalsClosed,
    onCreateAppointment: () => openAppt({ openAgendaAfter: true }),
    onCreatePatient:     () => openPatient(),
    onCreateInvoice:     () => router.push("/dashboard/caja?tab=facturas"),
    onCreateSoap: () => {
      if (consult) {
        router.push(`/dashboard/patients/${consult.patientId}?tab=soap&new=1`);
      } else {
        toast(t("shell.topbar.startConsultFirst"), { icon: "ℹ️" });
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
          aria-label={t("shell.topbar.openNav")}
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
          {/* Alert de tiempos de espera — solo recepcionista/admin que
              monitorean la sala. El componente self-renders condicional
              (null si no hay alertas activas), polea /api/analytics/waiting-room
              cada 60s con visibility pause. Multi-tenant: el endpoint usa
              clinicId desde getCurrentUser, no hay leak. */}
          {(userRole === "RECEPTIONIST" || userRole === "ADMIN" || userRole === "SUPER_ADMIN") && (
            <WaitingRoomAlert />
          )}
          {right}
          <CommandPaletteHint onClick={() => setPaletteOpen(true)} />
          {/* Insights semanales — solo admin/owner ven analytics → solo
              ellos reciben WeeklyInsight. El popover self-hides badge si
              no hay unread. */}
          {(userRole === "ADMIN" || userRole === "SUPER_ADMIN") && <InsightsPopover />}
          <NotificationsPopover />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsPanel open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
