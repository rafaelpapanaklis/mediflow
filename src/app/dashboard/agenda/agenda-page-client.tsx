"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
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
import type { Role } from "@prisma/client";
import { AgendaProvider, type AgendaPermissions } from "@/components/dashboard/agenda/agenda-provider";
import { AgendaNueva } from "@/components/dashboard/agenda-nueva/agenda-nueva";
import { AgendaTopbar } from "@/components/dashboard/agenda/agenda-topbar";
import { AgendaSubToolbar } from "@/components/dashboard/agenda/agenda-sub-toolbar";
import { AgendaHoverGuide } from "@/components/dashboard/agenda/agenda-hover-guide";
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
import { updateWaitlist, type ApiError } from "@/lib/agenda/mutations";
import { describeOverlapConflict } from "@/lib/agenda/conflict-copy";
import { bookingRuleMessage } from "@/lib/agenda/booking-rules";
import type { AppointmentDragData, DroppableData } from "@/lib/agenda/drag-utils";
import {
  DRAG_ACTIVATION_DISTANCE_PX,
  commitReschedule,
  optimisticDoctorIdOf,
  planReschedule,
} from "@/lib/agenda/reschedule-flow";
import { bloqueoQueTapa } from "@/lib/agenda-bloqueos/core";
import { useBloqueosAgenda } from "@/components/dashboard/bloqueos/usar-bloqueos-agenda";
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
  /** Clinic.cfdiTaxMode ("exempt" | "iva16") — SOLO ese escalar, nunca la fila
   *  Clinic. Baja hasta el cobro inline del panel de detalle para que el CFDI se
   *  timbre con el régimen de la clínica sin depender de ningún fetch. */
  clinicTaxMode: string | null;
  /** Permisos granulares de agenda (P1-3), calculados server-side. */
  permissions: AgendaPermissions;
  /**
   * ¿Esta clínica ve la agenda nueva de Claude Design? Sale del interruptor
   * por clínica `menu-dos-niveles` (`clinic_feature_flags`), resuelto en el
   * server component. Apagado (el caso de todas las clínicas menos Altabrisa),
   * abajo se monta el `AgendaShell` de SIEMPRE y no se toca ni un píxel.
   */
  agendaNueva?: boolean;
  /**
   * El rol de quien mira. Lo usa la agenda nueva para preguntar a la máquina
   * de estados qué transiciones puede hacer ESTA persona, y no ofrecerle un
   * botón que el servidor rechazará. El servidor revalida igual.
   */
  userRole?: Role;
}

export function AgendaPageClient(props: Props) {
  return (
    <AgendaProvider
      initialPayload={props.initialPayload}
      initialDayISO={props.initialDayISO}
      clinicCategory={props.clinicCategory}
      permissions={props.permissions}
    >
      {/* El interruptor elige UN armazón u otro, y los dos cuelgan del MISMO
          proveedor de datos: las citas, los doctores, las unidades, el refetch
          y las mutaciones son idénticos. Lo único que cambia es quién las
          pinta. Con la bandera apagada esto es, literalmente, el árbol de
          antes. */}
      {props.agendaNueva ? (
        <AgendaNueva
          clinicTaxMode={props.clinicTaxMode}
          userRole={props.userRole}
          highlightId={props.highlightId}
        />
      ) : (
        <AgendaShell highlightId={props.highlightId} clinicTaxMode={props.clinicTaxMode} />
      )}
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

/* ── Cards de cita: reglas MOVIDAS al module (Agenda-Legible, 31-ago) ──
   El piloto del 14-jul pintaba la card por ESTADO (fondo 12% + borde 2px)
   y reducía al doctor a un punto de 8px: en un día real todas las citas
   confirmadas se veían idénticas. La decisión nueva (doctor = superficie
   [banda 4px + tinte 22% + chip de iniciales], estado = punto compacto +
   modificadores) vive ahora en agenda.module.css como única fuente; aquí
   ya no se pisa nada de la card. */

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
  .agx-agenda > header button { transition: none; }
}
`;

function AgendaShell({ highlightId, clinicTaxMode }: { highlightId: string | null; clinicTaxMode: string | null }) {
  const { state, dispatch, permissions, setDay, invalidateRangeCache, slotHpx, viewportRef } = useAgenda();
  const router = useRouter();
  const t = useT();
  const { open: openNewAppointment } = useNewAppointmentDialog();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
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

      // La cuenta vive en reschedule-flow.ts: la comparte la agenda nueva.
      const planned = planReschedule({
        original,
        target,
        deltaY: delta.y,
        slotHpx,
        slotMinutes: state.slotMinutes,
        dayStart: state.dayStart,
        dayEnd: state.dayEnd,
        currentDayISO: state.dayISO,
        timezone: state.timezone,
        appointments: state.appointments,
      });

      setDragOverlap({
        overId: String(over.id),
        mode: planned.overlap ? "conflict" : "ok",
      });
    },
    [state.appointments, state.dayISO, state.dayEnd, state.dayStart, state.slotMinutes, state.timezone, slotHpx],
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
        // Agendar desde la waitlist CREA una cita: exige agenda.create (P1-3).
        if (!permissions.canCreate) return;
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
      // El drag ya nace deshabilitado sin agenda.edit (card); esto es el
      // cinturón por si un drag llega igual (P1-3).
      if (!permissions.canEdit) return;

      const original = state.appointments.find((a) => a.id === dragData.appointmentId);
      if (!original) return;

      const planned = planReschedule({
        original,
        target,
        deltaY: delta.y,
        slotHpx,
        slotMinutes: state.slotMinutes,
        dayStart: state.dayStart,
        dayEnd: state.dayEnd,
        currentDayISO: state.dayISO,
        timezone: state.timezone,
        appointments: state.appointments,
      });

      if (planned.unchanged) return;

      if (planned.overlap) {
        toast.error(t("agenda.pageClient.overlapConflict"));
        return;
      }

      const doctor = state.doctors.find(
        (d) => d.id === (planned.newDoctorId ?? original.doctor?.id ?? null),
      );
      const doctorName = doctor?.shortName ?? doctor?.displayName ?? t("agenda.pageClient.doctorFallback");

      setPendingReschedule({
        original,
        newStartsAt: planned.newStartsAt,
        newEndsAt: planned.newEndsAt,
        newDoctorId: planned.newDoctorId,
        newResourceId: planned.newResourceId,
        toDayISO: planned.toDayISO,
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
      slotHpx,
      permissions.canCreate,
      permissions.canEdit,
      openNewAppointment,
      router,
      t,
    ],
  );

  // ── El bloqueo del DESTINO del arrastre (WS1-T3) ──
  //
  // De los bloqueos que la agenda ya tiene cargados: solo se puede soltar
  // sobre columnas que están en pantalla, así que el destino cae siempre
  // dentro del rango que llegó junto a las citas. Ni una consulta más.
  const bloqueosCargados = useBloqueosAgenda();
  const bloqueoDelDestino = useMemo(() => {
    if (!pendingReschedule || bloqueosCargados.length === 0) return null;
    const b = bloqueoQueTapa(
      bloqueosCargados,
      pendingReschedule.newStartsAt,
      pendingReschedule.newEndsAt,
      pendingReschedule.newDoctorId ?? pendingReschedule.original.doctor?.id ?? null,
    );
    return b ? { doctorId: b.doctorId, doctorNombre: b.doctorNombre, reason: b.reason } : null;
  }, [pendingReschedule, bloqueosCargados]);

  const handleConfirmReschedule = useCallback(async () => {
    if (!pendingReschedule || rescheduling) return;
    const plan = pendingReschedule;
    setRescheduling(true);

    try {
      // Optimista → PATCH → REPLACE, o ROLLBACK si el servidor dice que no.
      // Vive en reschedule-flow.ts porque la agenda nueva hace lo MISMO.
      const result = await commitReschedule(plan, {
        dispatch,
        // «Ya lo confirmé»: el aviso que la persona acaba de leer en la
        // ventana. Solo si de verdad hay un bloqueo en el destino.
        bloqueoConfirmado: bloqueoDelDestino !== null,
      });
      if (result.ok) {
        // P1-13: fuera-de-horario/día cerrado ya no bloquea — se avisa.
        if (result.scheduleWarning?.message) toast(result.scheduleWarning.message, { duration: 6000 });
        // Invalida el cache SWR del provider para que volver a este dia o
        // cambiar de vista no restaure la version pre-mutacion del cacheRef.
        // NO llamamos router.refresh() porque vuelve a hidratar initialPayload
        // antes de que revalidatePath del endpoint haya completado, y termina
        // sobrescribiendo el optimistic con datos viejos (bug observado).
        invalidateRangeCache();
        toast.success(t("agenda.pageClient.rescheduleSuccess"));
        setPendingReschedule(null);
        if (plan.toDayISO !== state.dayISO) setDay(plan.toDayISO);
      } else {
        const apiErr = result.error as ApiError;
        if (apiErr?.error === "appointment_overlap") {
          toast.error(describeOverlapConflict(apiErr.conflictingAppointment, {
            doctorId: optimisticDoctorIdOf(plan),
            resourceId: plan.newResourceId,
          }));
        } else {
          // Reglas del servidor (mover al pasado, cita cerrada…): su frase, no el genérico.
          toast.error(bookingRuleMessage(apiErr) ?? t("agenda.pageClient.rescheduleFailed"));
        }
      }
    } finally {
      setRescheduling(false);
    }
  }, [pendingReschedule, rescheduling, dispatch, state.dayISO, setDay, invalidateRangeCache, t, bloqueoDelDestino]);

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
                // Misma fuente que recomputeTimes/badge de drag: el slotHpx
                // del provider. El 30px del module queda solo como fallback SSR.
                "--mf-agenda-slot-h": `${slotHpx}px`,
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
              ref={viewportRef}
              style={{
                flex: "1 1 0%",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                scrollbarGutter: "stable",
              }}
            >
              {/* La guía monta la regla + el cuerpo de columnas porque
                  necesita medir la grilla para resaltar el slot bajo el
                  cursor (ver agenda-hover-guide). Misma estructura. */}
              <AgendaHoverGuide columnCount={columns.length}>
                {columns.map((col) => (
                  <AgendaColumn key={col.key} column={col} />
                ))}
              </AgendaHoverGuide>
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
      <AgendaDetailPanel clinicTaxMode={clinicTaxMode} />
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
          // ⚠ El aviso va DENTRO de esta ventana y no en una segunda encima:
          // soltar una cita ya abre una confirmación, y encadenar dos para un
          // solo gesto se vuelve dos «aceptar» que nadie lee. «Cancelar» sigue
          // dejando la cita donde estaba.
          bloqueo={bloqueoDelDestino}
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
