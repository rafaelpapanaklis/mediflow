"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
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
import { ChangeRequestsPanel } from "@/components/dashboard/change-requests-panel";
import { AgendaWaitlistSidebar } from "@/components/dashboard/agenda/agenda-waitlist-sidebar";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { slotIndexToUtc } from "@/lib/agenda/time-utils";
import { calendarDayISO } from "@/lib/agenda/date-ranges";
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

/* ─────── Piloto rediseño Variante A (14-jul) — SOLO presentación ───────
 * Overrides scoped a .agx-agenda vía ganchos ESTABLES que los hijos ya
 * renderizan (atributos ARIA / data-*), nunca clases hasheadas del module.
 * Solo tokens de globals.css; :where() mantiene por debajo de los estados
 * del module CSS (.selected, .apptPast, .apptPending, modo sillón, .active
 * de pills) para no pisar semántica existente. Cero lógica. */
const AGX_CSS = `
/* ── Toolbar: barra única ── */
.agx-agenda > header { gap: 10px; padding: 6px 16px; box-shadow: none; }
/* Marca duplicada dentro de la agenda: el chrome del panel ya la muestra */
.agx-agenda > header > div:first-child { display: none; }

/* View switcher segmentado (Día/Semana/Mes/Lista) + segmento Sillones/Doctores */
.agx-agenda [role="tablist"] {
  background: var(--bg-elev-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 3px;
  gap: 2px;
}
.agx-agenda [role="tab"] {
  min-height: 28px;
  padding: 4px 13px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.agx-agenda [role="tab"]:hover { color: var(--text-1); }
.agx-agenda [role="tab"][aria-selected="true"] {
  background: var(--bg-elev);
  color: var(--text-1);
  font-weight: 600;
  box-shadow: var(--shadow-1);
}

/* Navegación de fechas (chevrones) + fecha 15/700 tabular */
.agx-agenda > header > div > button[aria-label] {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: var(--bg-elev);
  color: var(--text-2);
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.agx-agenda > header > div > button[aria-label]:hover { background: var(--bg-hover); color: var(--text-1); }
.agx-agenda > header > div > button + span {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
/* Botón "Hoy" */
.agx-agenda > header > button:not(:last-child) {
  min-height: 32px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: var(--bg-elev);
  color: var(--text-2);
  box-shadow: var(--shadow-1);
}
.agx-agenda > header > button:not(:last-child):hover { background: var(--bg-hover); color: var(--text-1); }

/* Pills de filtro (Doctores/Sillones/Estado): chips radius 99 + contador
   en --brand-soft. :where() deja que .filterPill.active del module gane. */
:where(.agx-agenda) > header button[aria-haspopup] {
  min-height: 32px;
  padding: 5px 12px;
  gap: 7px;
  border-radius: 99px;
  border: 1px solid var(--border-soft);
  background: var(--bg-elev);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 500;
  box-shadow: var(--shadow-1);
}
:where(.agx-agenda) > header button[aria-haspopup] > span:not([aria-hidden]) {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 10.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
:where(.agx-agenda) > header button[aria-haspopup] > span[aria-hidden] { color: var(--text-4); font-size: 10px; }

/* Búsqueda */
.agx-agenda > header input[type="search"] {
  min-height: 32px;
  padding: 6px 10px 6px 26px;
  font-size: 12.5px;
  background: var(--bg-elev);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-1);
  transition: box-shadow var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
}
.agx-agenda > header input[type="search"]:focus {
  outline: none;
  border-color: var(--border-brand);
  box-shadow: var(--ring);
}

/* CTA primario: violeta plano 36px (el degradado de marca es del sidebar) */
.agx-agenda > header > button:last-child {
  min-height: 36px;
  padding: 8px 14px;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--radius);
  background: var(--brand);
  color: #fff;
  box-shadow: var(--shadow-1);
  transition: background var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.agx-agenda > header > button:last-child:hover { background: var(--violet-700); box-shadow: var(--shadow-2); }
.agx-agenda > header > button:last-child:active { transform: scale(0.98); }

/* Sub-toolbar: contadores tabulares */
.agx-agenda > header + div strong { font-variant-numeric: tabular-nums; }

/* ── Chips de cita: color POR ESTADO (decisión 14-jul) ──
   La card ya expone --mf-status-color con el token fuerte por estado
   (SCHEDULED→warning · CONFIRMED→info · CHECKED_IN→brand ·
   IN_PROGRESS→success · COMPLETED→text-3 · CANCELLED→text-4 ·
   NO_SHOW→danger). Fondo soft derivado con color-mix (equivale a los
   tokens -soft: 10-12% del fuerte sobre --bg-elev, y adapta dark) +
   borde IZQUIERDO 2px sólido. El module conserva past/selected/
   in-progress/pending/sillón por especificidad. */
:where(.agx-agenda) [data-appt-id] {
  background: color-mix(in srgb, var(--mf-status-color, var(--brand)) 12%, var(--bg-elev));
  border-color: var(--border-soft);
  border-left-width: 2px;
  border-left-color: var(--mf-status-color, var(--brand));
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-1);
}
:where(.agx-agenda) [data-appt-id]:not([aria-selected="true"]):hover { box-shadow: var(--shadow-2); }

/* Hora 10.5/700 con el color fuerte del estado; el 22% de --text-1 lo
   oscurece en claro y lo aclara en oscuro → contraste AA en ambos temas */
:where(.agx-agenda) [data-appt-id] > div:first-of-type > :nth-child(1 of span:not([aria-hidden])) {
  color: color-mix(in srgb, var(--mf-status-color, var(--text-1)) 78%, var(--text-1));
  font-size: 10.5px;
}
:where(.agx-agenda) [data-appt-id] > div:first-of-type > span:last-child {
  font-size: 11.5px;
  font-weight: 600;
}

/* Avatar del doctor → PUNTO de color 8px con borde de superficie
   (conserva el background --mf-doc-color que ya pinta el module) */
:where(.agx-agenda) [data-appt-id] > div > span[aria-hidden] {
  order: 3;
  width: 8px;
  height: 8px;
  min-width: 8px;
  border-radius: 99px;
  border: 1.5px solid var(--bg-elev);
  font-size: 0;
  line-height: 0;
  color: transparent;
  overflow: hidden;
}

/* Línea 2 (tratamiento): texto plano --text-2, sin chip color-doctor */
:where(.agx-agenda) [data-appt-id] > div + div > span {
  background: transparent;
  padding: 0;
  color: var(--text-2);
  font-size: 10.5px;
  font-weight: 500;
}

/* Vista Lista: mismo mapa por estado (la fila ya expone --mf-status-color) */
:where(.agx-agenda) [role="listitem"] {
  background: color-mix(in srgb, var(--mf-status-color, var(--brand)) 7%, var(--bg-elev));
  border-left-color: var(--mf-status-color, var(--brand));
}

/* Móvil: el header de columnas (ahora fijo, apilado) no debe comerse el alto */
@media (max-width: 767.98px) {
  .agx-agenda .agx-day-head { max-height: 128px; overflow-y: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .agx-agenda [role="tab"],
  .agx-agenda > header button,
  .agx-agenda [data-appt-id] { transition: none; }
}
`;

function AgendaShell({ highlightId }: { highlightId: string | null }) {
  const { state, dispatch, setDay, invalidateRangeCache } = useAgenda();
  const router = useRouter();
  const t = useT();
  const { open: openNewAppointment } = useNewAppointmentDialog();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const columns = computeColumns(state, t);
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
        fromDayISO: calendarDayISO(original.startsAt, state.timezone),
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
              toast.error(t("agenda.pageClient.waitlistMarkFailed"));
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
        fromDayISO: calendarDayISO(original.startsAt, state.timezone),
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
        toast.error(t("agenda.pageClient.overlapConflict"));
        return;
      }

      const doctor = state.doctors.find((d) => d.id === (newDoctorId ?? currentDoctorId));
      const doctorName = doctor?.shortName ?? doctor?.displayName ?? t("agenda.pageClient.doctorFallback");

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
      t,
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
      // Invalida el cache SWR del provider para que volver a este dia o
      // cambiar de vista no restaure la version pre-mutacion del cacheRef.
      // NO llamamos router.refresh() porque vuelve a hidratar initialPayload
      // antes de que revalidatePath del endpoint haya completado, y termina
      // sobrescribiendo el optimistic con datos viejos (bug observado).
      invalidateRangeCache();
      toast.success(t("agenda.pageClient.rescheduleSuccess"));
      setPendingReschedule(null);
      if (toDayISO !== state.dayISO) setDay(toDayISO);
    } catch (err) {
      dispatch({ type: "ROLLBACK_RESCHEDULE", original });
      const apiErr = err as ApiError;
      if (apiErr?.error === "appointment_overlap") {
        toast.error(describeOverlapConflict(apiErr.conflictingAppointment, {
          doctorId: optimisticDoctorId,
          resourceId: newResourceId,
        }));
      } else {
        toast.error(t("agenda.pageClient.rescheduleFailed"));
      }
    } finally {
      setRescheduling(false);
    }
  }, [pendingReschedule, rescheduling, dispatch, state.dayISO, setDay, invalidateRangeCache, t]);

  const handleCancelReschedule = useCallback(() => {
    if (rescheduling) return;
    setPendingReschedule(null);
  }, [rescheduling]);

  // WS1-T5: tras aprobar/rechazar una solicitud de cambio del portal, la cita
  // cambió en el server. Mismo mecanismo que AgendaValidateBanner: limpiar el
  // cache SWR de rangos + router.refresh() para rehidratar initialPayload.
  const handleChangeRequestResolved = useCallback(() => {
    invalidateRangeCache();
    router.refresh();
  }, [invalidateRangeCache, router]);

  const body = (
    <div className={styles.body}>
      <AgendaValidateBanner />
      <ChangeRequestsPanel onResolved={handleChangeRequestResolved} />
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
        <div className={styles.scrollArea} style={{ overflowY: "hidden" }}>
          {/* Split header/cuerpo (lección del repo): Chrome clampea
              position:sticky al área del grid, así que el header de columnas
              vive en su PROPIO grid fuera del scroller vertical, como el
              prototipo (.ag-head fuera de .ag-body). El scroll horizontal lo
              sigue dando scrollArea para ambos; el vertical solo el cuerpo.
              Mismos hijos y clases del module — solo contenedores decorativos. */}
          <div
            className={styles.scrollGrid}
            style={
              {
                "--mf-agenda-cols": columns.length,
                "--mf-agenda-slot-min": state.slotMinutes,
                "--mf-agenda-day-start": state.dayStart,
                "--mf-agenda-day-end": state.dayEnd,
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minWidth: "min-content",
              } as React.CSSProperties
            }
          >
            <div
              className="agx-day-head"
              style={{
                display: "grid",
                gridTemplateColumns: "var(--mf-agenda-axis-w) minmax(0, 1fr)",
                flex: "none",
                overflowY: "hidden",
                scrollbarGutter: "stable",
              }}
            >
              <div className={styles.cornerCell} aria-hidden />
              <div className={styles.columnsHeader}>
                {columns.map((col) => (
                  <AgendaColumnHeader key={col.key} column={col} />
                ))}
              </div>
            </div>
            <div
              style={{
                flex: "1 1 0%",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                scrollbarGutter: "stable",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "var(--mf-agenda-axis-w) minmax(0, 1fr)",
                }}
              >
                <AgendaTimeAxis />
                <div className={styles.columnsBody}>
                  {columns.map((col) => (
                    <AgendaColumn key={col.key} column={col} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`${styles.page} ${detailOpen ? "" : styles.detailClosed} agx-agenda`}
      style={{ "--mf-subbar-h": "40px" } as React.CSSProperties}
    >
      <style>{AGX_CSS}</style>
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
  t: TFunction,
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
        title: t("agenda.pageClient.dayAgendaTitle"),
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
        displayName: fromAppt?.shortName ?? t("agenda.pageClient.professionalFallback"),
        shortName: fromAppt?.shortName ?? t("agenda.pageClient.professionalFallback"),
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
