"use client";

import { useRouter } from "next/navigation";
import { Video, Footprints, AlertTriangle } from "lucide-react";
import { formatSlotTime, timeToSlotIndex } from "@/lib/agenda/time-utils";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

interface Props {
  appointment: AgendaAppointmentDTO;
  dayISO: string;
  slotMinutes: number;
  dayStart: number;
  timezone: string;
}

const STATUS_CLASS: Record<AppointmentStatus, string> = {
  SCHEDULED:   styles.statusScheduled,
  CONFIRMED:   styles.statusConfirmed,
  CHECKED_IN:  styles.statusCheckedIn,
  IN_PROGRESS: styles.statusInProgress,
  COMPLETED:   styles.statusCompleted,
  CANCELLED:   styles.statusCancelled,
  NO_SHOW:     styles.statusNoShow,
};

const STATUS_DOT_BG: Record<AppointmentStatus, string> = {
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
  const router = useRouter();

  const config = { timezone, slotMinutes, dayStart, dayEnd: 24 };
  const startSlot = timeToSlotIndex(appointment.startsAt, dayISO, config);
  if (startSlot < 0) return null;

  const startMs = new Date(appointment.startsAt).getTime();
  const endMs = new Date(appointment.endsAt).getTime();
  const durationMin = Math.max(slotMinutes, (endMs - startMs) / 60_000);
  const slotsSpan = Math.max(1, durationMin / slotMinutes);

  const compact = slotsSpan <= 1.5;
  const ultraCompact = slotsSpan <= 1.0 && slotMinutes <= 15;

  const top = `calc(${startSlot} * var(--mf-agenda-slot-h))`;
  const height = `calc(${slotsSpan} * var(--mf-agenda-slot-h) - 2px)`;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/dashboard/appointments/${appointment.id}`);
  };

  const className = [
    styles.appt,
    STATUS_CLASS[appointment.status],
    compact ? styles.apptCompact : "",
    appointment.requiresValidation ? styles.apptPending : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-appt-id={appointment.id}
      className={className}
      style={{ top, height, minHeight: 22 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/dashboard/appointments/${appointment.id}`);
        }
      }}
      aria-label={`Cita: ${appointment.patient.name} a las ${formatSlotTime(appointment.startsAt, timezone)}`}
    >
      {!ultraCompact && (
        <div className={styles.apptTime}>
          <span
            className={styles.apptStatusDot}
            style={{
              background: STATUS_DOT_BG[appointment.status],
              marginRight: 4,
              verticalAlign: "middle",
            }}
            aria-hidden
          />
          {formatSlotTime(appointment.startsAt, timezone)}
        </div>
      )}
      <div className={styles.apptName}>
        {ultraCompact && (
          <span
            className={styles.apptStatusDot}
            style={{
              background: STATUS_DOT_BG[appointment.status],
              marginRight: 4,
              verticalAlign: "middle",
            }}
            aria-hidden
          />
        )}
        {appointment.patient.name}
      </div>
      {!compact && (
        <div className={styles.apptMeta}>
          {appointment.isTeleconsult && <Video size={10} aria-hidden />}
          {appointment.isWalkIn && <Footprints size={10} aria-hidden />}
          {appointment.requiresValidation && (
            <AlertTriangle size={10} aria-hidden style={{ color: "var(--warning)" }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {appointment.reason ?? "Consulta"}
          </span>
        </div>
      )}
    </div>
  );
}
