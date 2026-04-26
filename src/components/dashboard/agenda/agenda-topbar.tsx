"use client";

import { CalendarPlus } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useAgenda } from "./agenda-provider";
import { AgendaDayNav } from "./agenda-day-nav";
import { AgendaColumnModeToggle } from "./agenda-column-mode-toggle";

export function AgendaTopbar() {
  const { state } = useAgenda();
  const { open: openNew } = useNewAppointmentDialog();

  const visibleAppts = state.appointments.filter(
    (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
  ).length;
  const pendingCount = state.pendingValidation.length;

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px clamp(14px, 1.6vw, 28px)",
        borderBottom: "1px solid var(--border-soft)",
        background: "var(--bg)",
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            fontSize: "clamp(15px, 1.2vw, 18px)",
            fontWeight: 600,
            margin: 0,
            color: "var(--text-1)",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          }}
        >
          Agenda
        </h1>
        <AgendaDayNav />
        <span
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            letterSpacing: "0.04em",
          }}
        >
          {visibleAppts} cita{visibleAppts === 1 ? "" : "s"}
          {pendingCount > 0 && ` · ${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <AgendaColumnModeToggle />
        <ButtonNew
          variant="primary"
          icon={<CalendarPlus size={14} />}
          onClick={() => openNew({})}
        >
          Nueva cita
        </ButtonNew>
      </div>
    </header>
  );
}
