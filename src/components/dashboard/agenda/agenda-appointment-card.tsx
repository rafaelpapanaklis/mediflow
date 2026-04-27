"use client";

import { Video, Footprints, AlertTriangle } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime, timeToSlotIndex } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

interface Props {
  appointment: AgendaAppointmentDTO;
  dayISO: string;
  slotMinutes: number;
  dayStart: number;
  timezone: string;
}

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED:   "var(--warning)",
  CONFIRMED:   "var(--info)",
  CHECKED_IN:  "var(--brand)",
  IN_PROGRESS: "var(--success)",
  COMPLETED:   "var(--text-3)",
  CANCELLED:   "var(--text-4)",
  NO_SHOW:     "var(--danger)",
};

export function AgendaAppointmentCard({
  appointment,
  dayISO,
  slotMinutes,
  dayStart,
  timezone,
}: Props) {
  const { state, selectAppointment } = useAgenda();

  const config = { timezone, slotMinutes, dayStart, dayEnd: 24 };
  const startSlot = timeToSlotIndex(appointment.startsAt, dayISO, config);
  if (startSlot < 0) return null;

  const startMs = new Date(appointment.startsAt).getTime();
  const endMs = appointment.endsAt
    ? new Date(appointment.endsAt).getTime()
    : startMs + slotMinutes * 60_000;
  const durationMin = Math.max(slotMinutes, (endMs - startMs) / 60_000);
  const slotsSpan = Math.max(1, durationMin / slotMinutes);

  const compact = slotsSpan <= 1.5;

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

  const className = [
    styles.appt,
    compact ? styles.apptCompact : "",
    appointment.requiresValidation ? styles.apptPending : "",
    isSelected ? styles.selected : "",
  ]
    .filter(Boolean)
    .join(" ");

  const initials = appointment.doctor
    ? doctorInitials(appointment.doctor.shortName ?? "")
    : null;

  const treatment = appointment.reason ?? "Consulta";

  return (
    <div
      data-appt-id={appointment.id}
      className={className}
      style={
        {
          "--mf-slot-start": startSlot,
          "--mf-slot-span": slotsSpan,
          "--mf-doc-color": docColor,
          "--mf-status-color": statusColor,
          minHeight: 22,
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
    >
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
