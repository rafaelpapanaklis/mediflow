"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Video, Footprints, AlertTriangle, Check, ArrowRight } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useAgenda } from "./agenda-provider";
import { AgendaStatusPopover } from "./agenda-status-popover";
import { formatSlotTime, timeToSlotIndex } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import { batchValidateAppointments, patchAppointmentStatus } from "@/lib/agenda/mutations";
import { nextLogicalStatus } from "@/lib/agenda/status-pipeline";
import type { AppointmentDragData } from "@/lib/agenda/drag-utils";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

interface Props {
  appointment: AgendaAppointmentDTO;
  dayISO: string;
  slotMinutes: number;
  dayStart: number;
  timezone: string;
  /** false en vistas que no soportan drag (mes, lista). */
  draggable?: boolean;
}

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED:    "var(--warning)",
  CONFIRMED:    "var(--info)",
  CHECKED_IN:   "var(--brand)",
  IN_CHAIR:     "var(--brand)",
  IN_PROGRESS:  "var(--success)",
  COMPLETED:    "var(--text-3)",
  CHECKED_OUT:  "var(--text-3)",
  CANCELLED:    "var(--text-4)",
  NO_SHOW:      "var(--danger)",
};

export function AgendaAppointmentCard({
  appointment,
  dayISO,
  slotMinutes,
  dayStart,
  timezone,
  draggable = true,
}: Props) {
  const { state, selectAppointment, dispatch } = useAgenda();
  const [pendingNext, setPendingNext] = useState(false);

  const config = { timezone, slotMinutes, dayStart, dayEnd: 24 };
  const rawSlot = timeToSlotIndex(appointment.startsAt, dayISO, config);

  const dragDisabled =
    !draggable ||
    appointment.status === "CANCELLED" ||
    appointment.status === "COMPLETED" ||
    appointment.status === "NO_SHOW";

  const dragData: AppointmentDragData = {
    kind: "appt",
    appointmentId: appointment.id,
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `appt:${appointment.id}`,
      data: dragData,
      disabled: dragDisabled,
    });

  // -1 = día calendario distinto en tz (cita ajena a esta columna).
  // Slots negativos = mismo día pero antes del agendaDayStart → los
  // clampamos a slot 0 para que sigan visibles en lugar de
  // desaparecer (eran invisibles + contadas en el contador, bug
  // histórico). Slots > slotsTotal salen del horario configurado pero
  // se posicionan según --mf-slot-start; la columna extiende su
  // height para acomodarlos.
  if (rawSlot === -1) return null;
  const startSlot = Math.max(0, rawSlot);

  const startMs = new Date(appointment.startsAt).getTime();
  const endMs = appointment.endsAt
    ? new Date(appointment.endsAt).getTime()
    : startMs + slotMinutes * 60_000;
  const durationMin = Math.max(slotMinutes, (endMs - startMs) / 60_000);
  const slotsSpan = Math.max(1, durationMin / slotMinutes);

  const compact = slotsSpan <= 1.5;

  // Estado temporal: pasada (endsAt < now), en curso (start <= now < end),
  // futura (resto). Se actualiza con el tiempo via state.dayISO change y
  // re-renders naturales (no hay setInterval — basta con que el usuario
  // navegue/refresque). El visual diferenciado se aplica solo si el
  // status no es ya terminal (COMPLETED / CHECKED_OUT / NO_SHOW /
  // CANCELLED) — esos ya tienen color propio en STATUS_COLOR.
  const now = Date.now();
  const isTerminal =
    appointment.status === "COMPLETED" ||
    appointment.status === "CHECKED_OUT" ||
    appointment.status === "NO_SHOW" ||
    appointment.status === "CANCELLED";
  const isInProgress =
    !isTerminal && startMs <= now && now < endMs;
  const isPast =
    !isTerminal && !isInProgress && endMs <= now;

  const doctorMeta = appointment.doctor
    ? state.doctors.find((d) => d.id === appointment.doctor!.id) ?? null
    : null;
  const docColor = appointment.doctor
    ? doctorColorFor(appointment.doctor.id, doctorMeta?.color ?? null)
    : "var(--brand)";
  const statusColor = STATUS_COLOR[appointment.status];

  const isSelected = state.selectedAppointmentId === appointment.id;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectAppointment(appointment.id);
  };

  // Audit ajuste 7: si la cita requiere validación, el botón inline muestra
  // "Aprobar" y dispara batch-validate (que limpia requiresValidation +
  // pone CONFIRMED). Para citas validadas, usa el flujo normal del pipeline.
  const needsValidation =
    appointment.requiresValidation && appointment.status === "SCHEDULED";
  const nextStep = needsValidation
    ? { status: "CONFIRMED" as AppointmentStatus, label: "Aprobar" }
    : nextLogicalStatus(appointment.status);

  async function advanceStatus() {
    if (!nextStep || pendingNext) return;
    setPendingNext(true);
    const original = appointment;

    if (needsValidation) {
      dispatch({ type: "OPTIMISTIC_STATUS", id: appointment.id, status: "CONFIRMED" });
      try {
        const result = await batchValidateAppointments("confirm", [appointment.id]);
        if (result.failed.length > 0) {
          throw new Error(result.failed[0]?.error ?? "update_failed");
        }
        // Refrescar para sincronizar requiresValidation: false del server.
        // (No tenemos REPLACE_APPOINTMENT con el shape completo aquí.)
      } catch (err) {
        dispatch({ type: "ROLLBACK_STATUS", original });
        toast.error(err instanceof Error ? err.message : "No se pudo aprobar");
      } finally {
        setPendingNext(false);
      }
      return;
    }

    dispatch({ type: "OPTIMISTIC_STATUS", id: appointment.id, status: nextStep.status });
    try {
      const updated = await patchAppointmentStatus(appointment.id, nextStep.status);
      dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
    } catch (err) {
      dispatch({ type: "ROLLBACK_STATUS", original });
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo cambiar";
      toast.error(reason);
    } finally {
      setPendingNext(false);
    }
  }

  const className = [
    styles.appt,
    compact ? styles.apptCompact : "",
    appointment.requiresValidation ? styles.apptPending : "",
    isSelected ? styles.selected : "",
    isDragging ? styles.dragging : "",
    isPast ? styles.apptPast : "",
    isInProgress ? styles.apptInProgress : "",
  ]
    .filter(Boolean)
    .join(" ");

  const initials = appointment.doctor
    ? doctorInitials(appointment.doctor.shortName ?? "")
    : null;

  const treatment = appointment.reason ?? "Consulta";

  return (
    <div
      ref={setNodeRef}
      data-appt-id={appointment.id}
      className={className}
      style={
        {
          "--mf-slot-start": startSlot,
          "--mf-slot-span": slotsSpan,
          "--mf-doc-color": docColor,
          "--mf-status-color": statusColor,
          minHeight: 22,
          transform: CSS.Translate.toString(transform),
          opacity: isDragging ? 0.4 : undefined,
          zIndex: isDragging ? 50 : undefined,
          cursor: dragDisabled ? "pointer" : isDragging ? "grabbing" : "grab",
          touchAction: "none",
        } as React.CSSProperties
      }
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectAppointment(appointment.id);
        }
      }}
      aria-label={`Cita: ${appointment.patient.name} a las ${formatSlotTime(appointment.startsAt, timezone)}`}
      aria-selected={isSelected}
      {...listeners}
      {...attributes}
    >
      <AgendaStatusPopover appointment={appointment} />
      {nextStep && (
        <button
          type="button"
          className={styles.apptNextBtn}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void advanceStatus();
          }}
          disabled={pendingNext}
          title={`${nextStep.label} (${appointment.patient.name})`}
          aria-label={`${nextStep.label} cita de ${appointment.patient.name}`}
        >
          {pendingNext ? (
            <span aria-hidden>…</span>
          ) : (
            <>
              {nextStep.status === "SCHEDULED" ? (
                <ArrowRight size={10} aria-hidden />
              ) : (
                <Check size={10} aria-hidden />
              )}
              <span>{nextStep.label}</span>
            </>
          )}
        </button>
      )}
      <div className={styles.apptRow1}>
        {initials && (
          <span className={styles.apptDocAvatar} aria-hidden>
            {initials}
          </span>
        )}
        <span className={styles.apptTime}>
          {formatSlotTime(appointment.startsAt, timezone)}
        </span>
        <span className={styles.apptName}>{appointment.patient.name}</span>
      </div>
      {!compact && (
        <div className={styles.apptRow2}>
          {appointment.isTeleconsult && <Video size={10} aria-hidden />}
          {appointment.isWalkIn && <Footprints size={10} aria-hidden />}
          {appointment.requiresValidation && (
            <AlertTriangle size={10} aria-hidden style={{ color: "var(--warning)" }} />
          )}
          <span className={styles.apptTreatment}>{treatment}</span>
        </div>
      )}
    </div>
  );
}
