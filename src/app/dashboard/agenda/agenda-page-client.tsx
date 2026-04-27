"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import toast from "react-hot-toast";
import { AgendaProvider } from "@/components/dashboard/agenda/agenda-provider";
import { AgendaTopbar } from "@/components/dashboard/agenda/agenda-topbar";
import { AgendaSubToolbar } from "@/components/dashboard/agenda/agenda-sub-toolbar";
import { AgendaTimeAxis } from "@/components/dashboard/agenda/agenda-time-axis";
import { AgendaColumnHeader } from "@/components/dashboard/agenda/agenda-column-header";
import { AgendaColumn } from "@/components/dashboard/agenda/agenda-column";
import { AgendaEmptyDay } from "@/components/dashboard/agenda/agenda-empty-day";
import { AgendaEmptyResources } from "@/components/dashboard/agenda/agenda-empty-resources";
import { AgendaHighlightListener } from "@/components/dashboard/agenda/agenda-highlight-listener";
import { AgendaDetailPanel } from "@/components/dashboard/agenda/agenda-detail-panel";
import { AgendaListView } from "@/components/dashboard/agenda/agenda-list-view";
import { AgendaMonthView } from "@/components/dashboard/agenda/agenda-month-view";
import { AgendaWeekView } from "@/components/dashboard/agenda/agenda-week-view";
import { AgendaResourcesModal } from "@/components/dashboard/agenda/agenda-resources-modal";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import {
  detectOverlap,
  recomputeTimes,
  type AppointmentDragData,
  type DroppableData,
} from "@/lib/agenda/drag-utils";
import { rescheduleAppointment } from "@/lib/agenda/mutations";
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
  const { state, dispatch, setDay } = useAgenda();
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const columns = computeColumns(state);
  const detailOpen = state.selectedAppointmentId !== null;

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over, delta } = event;
      if (!over) return;
      const data = active.data.current as AppointmentDragData | undefined;
      if (!data || data.kind !== "appt") return;
      const target = over.data.current as DroppableData | undefined;
      if (!target) return;

      const original = state.appointments.find((a) => a.id === data.appointmentId);
      if (!original) return;

      const currentDoctorId = original.doctor?.id ?? null;
      const currentResourceId = original.resourceId;

      let toDayISO = state.dayISO;
      let newDoctorId = currentDoctorId;
      let newResourceId = currentResourceId;

      if (target.kind === "doctor-col") {
        newDoctorId = target.doctorId;
      } else if (target.kind === "resource-col") {
        newResourceId = target.resourceId;
      } else if (target.kind === "day-col") {
        toDayISO = target.dayISO;
      }

      const result = recomputeTimes({
        appt: original,
        deltaY: delta.y,
        slotMinutes: state.slotMinutes,
        dayStart: state.dayStart,
        dayEnd: state.dayEnd,
        fromDayISO: state.dayISO,
        toDayISO,
        timezone: state.timezone,
      });

      const noChange =
        original.startsAt === result.startsAt &&
        (original.endsAt ?? "") === result.endsAt &&
        newDoctorId === currentDoctorId &&
        newResourceId === currentResourceId;
      if (noChange) return;

      if (
        detectOverlap(
          state.appointments,
          original.id,
          result.startsAt,
          result.endsAt,
          newDoctorId,
          newResourceId,
        )
      ) {
        toast.error("Conflicto: ya hay una cita en ese horario");
        return;
      }

      const optimisticDoctorId = newDoctorId ?? currentDoctorId ?? "";
      dispatch({
        type: "OPTIMISTIC_RESCHEDULE",
        id: original.id,
        doctorId: optimisticDoctorId,
        resourceId: newResourceId,
        startsAt: result.startsAt,
        endsAt: result.endsAt,
      });

      const apiPayload: {
        startsAt: string;
        endsAt: string;
        doctorId?: string;
        resourceId?: string | null;
      } = {
        startsAt: result.startsAt,
        endsAt: result.endsAt,
      };
      if (newDoctorId !== currentDoctorId && newDoctorId) {
        apiPayload.doctorId = newDoctorId;
      }
      if (newResourceId !== currentResourceId) {
        apiPayload.resourceId = newResourceId;
      }

      rescheduleAppointment(original.id, apiPayload)
        .then((updated) => {
          dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
          if (toDayISO !== state.dayISO) {
            setDay(toDayISO);
          } else {
            router.refresh();
          }
        })
        .catch((err: { error?: string; reason?: string }) => {
          dispatch({ type: "ROLLBACK_RESCHEDULE", original });
          if (err?.error === "appointment_overlap") {
            toast.error("Conflicto detectado por el servidor");
          } else {
            toast.error(err?.reason ?? err?.error ?? "No se pudo reagendar");
          }
        });
    },
    [
      state.appointments,
      state.dayISO,
      state.dayEnd,
      state.dayStart,
      state.slotMinutes,
      state.timezone,
      dispatch,
      setDay,
      router,
    ],
  );

  const supportsDrag =
    state.viewMode === "day" || state.viewMode === "week";

  const body = (
    <div className={styles.body}>
      {state.viewMode === "list" ? (
        <AgendaListView />
      ) : state.viewMode === "month" ? (
        <AgendaMonthView />
      ) : state.viewMode === "week" ? (
        <AgendaWeekView />
      ) : state.resources.length === 0 &&
        (state.columnMode === "resource" || state.columnMode === "unified") ? (
        <AgendaEmptyResources />
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
  );

  return (
    <div className={`${styles.page} ${detailOpen ? "" : styles.detailClosed}`}>
      <AgendaTopbar />
      <AgendaSubToolbar />
      {supportsDrag ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {body}
        </DndContext>
      ) : (
        body
      )}
      <AgendaDetailPanel />
      <AgendaResourcesModal />
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
    return state.doctors
      .filter((d) => d.activeInAgenda)
      .map((d) => {
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
