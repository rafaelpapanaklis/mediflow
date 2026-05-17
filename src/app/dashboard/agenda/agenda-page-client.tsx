"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
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
import { AgendaRescheduleConfirmModal } from "@/components/dashboard/agenda/agenda-reschedule-confirm-modal";
import { AgendaValidateBanner } from "@/components/dashboard/agenda/agenda-validate-banner";
import { AgendaWaitlistSidebar } from "@/components/dashboard/agenda/agenda-waitlist-sidebar";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { slotIndexToUtc } from "@/lib/agenda/time-utils";
import { updateWaitlist, type ApiError } from "@/lib/agenda/mutations";
import { describeOverlapConflict } from "@/lib/agenda/conflict-copy";
import {
  detectOverlap,
  recomputeTimes,
  type AppointmentDragData,
  type DroppableData,
} from "@/lib/agenda/drag-utils";
import { rescheduleAppointment } from "@/lib/agenda/mutations";
import {
  RESOURCE_KIND_LABELS,
  TREATMENT_KINDS,
  type AgendaAppointmentDTO,
  type AgendaDayResponse,
} from "@/lib/agenda/types";
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

/* ─────── Drag overlap context (audit ajuste 3) ──────────
 * El droppable bajo el cursor pinta verde u rojo en tiempo real durante el
 * drag, según overlap detectado por el cliente. */
type DragOverlapMode = "ok" | "conflict" | null;
interface DragOverlapState {
  overId: string | null;
  mode: DragOverlapMode;
}
const DragOverlapContext = createContext<DragOverlapState>({ overId: null, mode: null });

export function useDragOverlap(droppableId: string): DragOverlapMode {
  const ctx = useContext(DragOverlapContext);
  if (ctx.overId !== droppableId) return null;
  return ctx.mode;
}

function AgendaShell({ highlightId }: { highlightId: string | null }) {
  const { state, dispatch, setDay } = useAgenda();
  const router = useRouter();
  const { open: openNewAppointment } = useNewAppointmentDialog();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const columns = computeColumns(state);
  const detailOpen = state.selectedAppointmentId !== null;

  const [dragOverlap, setDragOverlap] = useState<DragOverlapState>({ overId: null, mode: null });
  const [pendingReschedule, setPendingReschedule] = useState<{
    original: AgendaAppointmentDTO;
    newStartsAt: string;
    newEndsAt: string;
    newDoctorId: string | null;
    newResourceId: string | null;
    toDayISO: string;
    doctorName: string;
  } | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const handleDragStart = useCallback((_e: DragStartEvent) => {
    setDragOverlap({ overId: null, mode: null });
  }, []);

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over, delta } = event;
      if (!over) {
        setDragOverlap({ overId: null, mode: null });
        return;
      }
      const dragData = active.data.current as AppointmentDragData | undefined;
      if (!dragData || dragData.kind !== "appt") {
        setDragOverlap({ overId: String(over.id), mode: "ok" });
        return;
      }
      const target = over.data.current as DroppableData | undefined;
      if (!target) return;

      const original = state.appointments.find((a) => a.id === dragData.appointmentId);
      if (!original) return;

      const currentDoctorId = original.doctor?.id ?? null;
      const currentResourceId = original.resourceId;
      let toDayISO = state.dayISO;
      let newDoctorId = currentDoctorId;
      let newResourceId = currentResourceId;
      if (target.kind === "doctor-col") newDoctorId = target.doctorId;
      else if (target.kind === "resource-col") newResourceId = target.resourceId;
      else if (target.kind === "day-col") toDayISO = target.dayISO;

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

      const conflict = detectOverlap(
        state.appointments,
        original.id,
        result.startsAt,
        result.endsAt,
        newDoctorId,
        newResourceId,
      );

      setDragOverlap({
        overId: String(over.id),
        mode: conflict ? "conflict" : "ok",
      });
    },
    [state.appointments, state.dayISO, state.dayEnd, state.dayStart, state.slotMinutes, state.timezone],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragOverlap({ overId: null, mode: null });
      const { active, over, delta } = event;
      if (!over) return;
      const dragData = active.data.current as
        | AppointmentDragData
        | { kind: "waitlist"; entryId: string; patient: { id: string; name: string }; reason: string | null; preferredDoctorId: string | null }
        | undefined;
      if (!dragData) return;
      const target = over.data.current as DroppableData | undefined;
      if (!target) return;

      // ─── Waitlist → cell: abrir NewAppointmentDialog pre-llenado ───
      if (dragData.kind === "waitlist") {
        const activatorEvent = event.activatorEvent as PointerEvent | undefined;
        const startY = activatorEvent?.clientY ?? 0;
        const overRect = over.rect;
        const finalY = startY + delta.y;
        const yInColumn = finalY - overRect.top;
        const slotsTotal = ((state.dayEnd - state.dayStart) * 60) / state.slotMinutes;
        const slotHpx = overRect.height / slotsTotal;
        const slotIdx = Math.max(0, Math.min(slotsTotal - 1, Math.floor(yInColumn / slotHpx)));

        let toDayISO = state.dayISO;
        let doctorId: string | undefined = dragData.preferredDoctorId ?? undefined;
        let resourceId: string | null | undefined;

        if (target.kind === "doctor-col") {
          doctorId = target.doctorId;
        } else if (target.kind === "resource-col") {
          resourceId = target.resourceId;
        } else if (target.kind === "day-col") {
          toDayISO = target.dayISO;
        }

        const startsAt = slotIndexToUtc(slotIdx, toDayISO, {
          timezone: state.timezone,
          slotMinutes: state.slotMinutes,
          dayStart: state.dayStart,
          dayEnd: state.dayEnd,
        });

        openNewAppointment({
          initialPatient: dragData.patient,
          initialReason: dragData.reason ?? undefined,
          initialDoctorId: doctorId,
          initialSlot: {
            startsAt: startsAt.toISOString(),
            doctorId,
            resourceId: resourceId ?? null,
          },
          openAgendaAfter: true,
          onCreated: async (appt) => {
            try {
              await updateWaitlist(dragData.entryId, {
                status: "FULFILLED",
                appointmentId: appt.id,
              });
              router.refresh();
            } catch {
              toast.error("Cita creada, pero no se pudo marcar la espera");
            }
          },
        });
        return;
      }

      if (dragData.kind !== "appt") return;

      const original = state.appointments.find((a) => a.id === dragData.appointmentId);
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

      const doctor = state.doctors.find((d) => d.id === (newDoctorId ?? currentDoctorId));
      const doctorName = doctor?.shortName ?? doctor?.displayName ?? "Doctor";

      setPendingReschedule({
        original,
        newStartsAt: result.startsAt,
        newEndsAt: result.endsAt,
        newDoctorId,
        newResourceId,
        toDayISO,
        doctorName,
      });
    },
    [
      state.appointments,
      state.dayISO,
      state.dayEnd,
      state.dayStart,
      state.slotMinutes,
      state.timezone,
      state.doctors,
      openNewAppointment,
      router,
    ],
  );

  const handleConfirmReschedule = useCallback(async () => {
    if (!pendingReschedule || rescheduling) return;
    const { original, newStartsAt, newEndsAt, newDoctorId, newResourceId, toDayISO } = pendingReschedule;
    setRescheduling(true);

    const currentDoctorId = original.doctor?.id ?? null;
    const currentResourceId = original.resourceId;
    const optimisticDoctorId = newDoctorId ?? currentDoctorId ?? "";

    dispatch({
      type: "OPTIMISTIC_RESCHEDULE",
      id: original.id,
      doctorId: optimisticDoctorId,
      resourceId: newResourceId,
      startsAt: newStartsAt,
      endsAt: newEndsAt,
    });

    const apiPayload: { startsAt: string; endsAt: string; doctorId?: string; resourceId?: string | null } = {
      startsAt: newStartsAt,
      endsAt: newEndsAt,
    };
    if (newDoctorId !== currentDoctorId && newDoctorId) apiPayload.doctorId = newDoctorId;
    if (newResourceId !== currentResourceId) apiPayload.resourceId = newResourceId;

    try {
      const updated = await rescheduleAppointment(original.id, apiPayload);
      dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
      toast.success("Cita reprogramada");
      setPendingReschedule(null);
      if (toDayISO !== state.dayISO) setDay(toDayISO);
      else router.refresh();
    } catch (err) {
      dispatch({ type: "ROLLBACK_RESCHEDULE", original });
      const apiErr = err as ApiError;
      if (apiErr?.error === "appointment_overlap") {
        toast.error(describeOverlapConflict(apiErr.conflictingAppointment, {
          doctorId: optimisticDoctorId,
          resourceId: newResourceId,
        }));
      } else {
        toast.error("No se pudo reprogramar la cita");
      }
    } finally {
      setRescheduling(false);
    }
  }, [pendingReschedule, rescheduling, dispatch, state.dayISO, setDay, router]);

  const handleCancelReschedule = useCallback(() => {
    if (rescheduling) return;
    setPendingReschedule(null);
  }, [rescheduling]);

  const body = (
    <div className={styles.body}>
      <AgendaValidateBanner />
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
      <DragOverlapContext.Provider value={dragOverlap}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragOverlap({ overId: null, mode: null })}
        >
          <AgendaTopbar />
          <AgendaSubToolbar />
          {body}
          <AgendaWaitlistSidebar />
        </DndContext>
      </DragOverlapContext.Provider>
      <AgendaDetailPanel />
      <AgendaResourcesModal />
      {pendingReschedule && (
        <AgendaRescheduleConfirmModal
          open={true}
          doctorName={pendingReschedule.doctorName}
          originalStartsAt={pendingReschedule.original.startsAt}
          newStartsAt={pendingReschedule.newStartsAt}
          timezone={state.timezone}
          submitting={rescheduling}
          onConfirm={handleConfirmReschedule}
          onCancel={handleCancelReschedule}
        />
      )}
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
    // Columnas para doctores explícitamente activos en agenda.
    const activeDoctors = state.doctors.filter((d) => d.activeInAgenda);
    const renderedIds = new Set(activeDoctors.map((d) => d.id));

    // Doctores con citas hoy pero que NO están marcados como activos en
    // agenda (o que no aparecen en state.doctors). Sin esta unión, una
    // cita queda silenciosamente oculta cuando el doctor fue desactivado
    // pero todavía tiene citas — es la causa raíz observada de la
    // vista Día vacía aunque el contador muestre N citas.
    const orphanIds = new Set<string>();
    for (const a of state.appointments) {
      const id = a.doctor?.id;
      if (id && !renderedIds.has(id)) orphanIds.add(id);
    }

    const orphanDoctors = Array.from(orphanIds).map((id) => {
      const known = state.doctors.find((d) => d.id === id);
      if (known) return known;
      // El doctor no está en state.doctors (ej. role != DOCTOR o
      // isActive=false). Construimos un descriptor mínimo a partir del
      // shortName que viene en la cita.
      const fromAppt = state.appointments.find((a) => a.doctor?.id === id)?.doctor;
      return {
        id,
        displayName: fromAppt?.shortName ?? "Profesional",
        shortName: fromAppt?.shortName ?? "Profesional",
        color: null,
        avatarUrl: null,
        activeInAgenda: false,
      };
    });

    return [...activeDoctors, ...orphanDoctors].map((d) => {
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

  // Mode "resource" = "Por sillón". Solo lugares de tratamiento dental
  // (silla + consultorio dental); recepción/sala de espera/lab/radio se
  // gestionan en el modal pero no son columnas de agenda.
  return state.resources.filter((r) => TREATMENT_KINDS.includes(r.kind)).map((r) => {
    const apptsHere = state.appointments.filter((a) => a.resourceId === r.id);
    return {
      key: `resource:${r.id}`,
      type: "resource",
      doctorId: null,
      resourceId: r.id,
      title: r.name,
      subtitle: RESOURCE_KIND_LABELS[r.kind],
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
