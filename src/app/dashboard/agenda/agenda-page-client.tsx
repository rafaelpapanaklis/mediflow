"use client";

import { AgendaProvider } from "@/components/dashboard/agenda/agenda-provider";
import { AgendaTopbar } from "@/components/dashboard/agenda/agenda-topbar";
import { AgendaSubToolbar } from "@/components/dashboard/agenda/agenda-sub-toolbar";
import { AgendaTimeAxis } from "@/components/dashboard/agenda/agenda-time-axis";
import { AgendaColumnHeader } from "@/components/dashboard/agenda/agenda-column-header";
import { AgendaColumn } from "@/components/dashboard/agenda/agenda-column";
import { AgendaEmptyDay } from "@/components/dashboard/agenda/agenda-empty-day";
import { AgendaHighlightListener } from "@/components/dashboard/agenda/agenda-highlight-listener";
import { AgendaDetailPanel } from "@/components/dashboard/agenda/agenda-detail-panel";
import { AgendaListView } from "@/components/dashboard/agenda/agenda-list-view";
import { AgendaMonthView } from "@/components/dashboard/agenda/agenda-month-view";
import { AgendaWeekView } from "@/components/dashboard/agenda/agenda-week-view";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import type { AgendaDayResponse } from "@/lib/agenda/types";
import styles from "@/components/dashboard/agenda/agenda.module.css";

interface Props {
  initialPayload: AgendaDayResponse;
  initialDayISO: string;
  clinicCategory: string;
  clinicName: string;
  highlightId: string | null;
}

export function AgendaPageClient(props: Props) {
  return (
    <AgendaProvider
      initialPayload={props.initialPayload}
      initialDayISO={props.initialDayISO}
      clinicCategory={props.clinicCategory}
    >
      <AgendaShell highlightId={props.highlightId} />
    </AgendaProvider>
  );
}

function AgendaShell({ highlightId }: { highlightId: string | null }) {
  const { state } = useAgenda();

  const columns = computeColumns(state);
  const detailOpen = state.selectedAppointmentId !== null;

  return (
    <div className={`${styles.page} ${detailOpen ? "" : styles.detailClosed}`}>
      <AgendaTopbar />
      <AgendaSubToolbar />
      <div className={styles.body}>
        {state.viewMode === "list" ? (
          <AgendaListView />
        ) : state.viewMode === "month" ? (
          <AgendaMonthView />
        ) : state.viewMode === "week" ? (
          <AgendaWeekView />
        ) : columns.length === 0 ? (
          <AgendaEmptyDay />
        ) : (
          <div className={styles.scrollArea}>
            <div
              className={styles.scrollGrid}
              style={
                {
                  "--mf-agenda-cols": columns.length,
                  "--mf-agenda-slot-min": state.slotMinutes,
                  "--mf-agenda-day-start": state.dayStart,
                  "--mf-agenda-day-end": state.dayEnd,
                } as React.CSSProperties
              }
            >
              <div className={styles.cornerCell} aria-hidden />
              <div className={styles.columnsHeader}>
                {columns.map((col) => (
                  <AgendaColumnHeader key={col.key} column={col} />
                ))}
              </div>
              <AgendaTimeAxis />
              <div className={styles.columnsBody}>
                {columns.map((col) => (
                  <AgendaColumn key={col.key} column={col} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <AgendaDetailPanel />
      {highlightId && <AgendaHighlightListener highlightId={highlightId} />}
    </div>
  );
}

export interface AgendaColumnDescriptor {
  key: string;
  type: "doctor" | "resource" | "unified";
  doctorId: string | null;
  resourceId: string | null;
  title: string;
  subtitle?: string;
  color?: string | null;
  occupancyPct: number;
}

function computeColumns(
  state: ReturnType<typeof useAgenda>["state"],
): AgendaColumnDescriptor[] {
  const slotsAvailablePerColumn =
    ((state.dayEnd - state.dayStart) * 60) / state.slotMinutes;

  if (state.columnMode === "unified") {
    return [
      {
        key: "unified",
        type: "unified",
        doctorId: null,
        resourceId: null,
        title: "Agenda del día",
        occupancyPct: occupancyOf(state.appointments, slotsAvailablePerColumn, state.slotMinutes),
      },
    ];
  }

  if (state.columnMode === "doctor") {
    return state.doctors.map((d) => {
      const apptsHere = state.appointments.filter((a) => a.doctor?.id === d.id);
      return {
        key: `doctor:${d.id}`,
        type: "doctor",
        doctorId: d.id,
        resourceId: null,
        title: d.shortName,
        subtitle: undefined,
        color: d.color,
        occupancyPct: occupancyOf(apptsHere, slotsAvailablePerColumn, state.slotMinutes),
      };
    });
  }

  return state.resources.map((r) => {
    const apptsHere = state.appointments.filter((a) => a.resourceId === r.id);
    return {
      key: `resource:${r.id}`,
      type: "resource",
      doctorId: null,
      resourceId: r.id,
      title: r.name,
      subtitle: r.kind === "ROOM" ? "Sala" : r.kind === "EQUIPMENT" ? "Equipo" : "Sillón",
      color: r.color,
      occupancyPct: occupancyOf(apptsHere, slotsAvailablePerColumn, state.slotMinutes),
    };
  });
}

function occupancyOf(
  appts: { startsAt: string; endsAt?: string; status: string }[],
  totalSlots: number,
  slotMinutes: number,
): number {
  if (totalSlots === 0) return 0;
  let occupied = 0;
  for (const a of appts) {
    if (a.status === "CANCELLED" || a.status === "NO_SHOW") continue;
    if (!a.endsAt) continue;
    const dur = (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000;
    occupied += Math.ceil(dur / slotMinutes);
  }
  return Math.min(100, Math.round((occupied / totalSlots) * 100));
}
