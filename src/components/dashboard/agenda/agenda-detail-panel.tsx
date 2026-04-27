"use client";

import { useMemo } from "react";
import { Pencil, MessageCircle, X, Play, AlertTriangle } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import type { AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED:   "var(--warning)",
  CONFIRMED:   "var(--info)",
  CHECKED_IN:  "var(--brand)",
  IN_PROGRESS: "var(--success)",
  COMPLETED:   "var(--text-3)",
  CANCELLED:   "var(--text-4)",
  NO_SHOW:     "var(--danger)",
};

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: "SCHEDULED",   label: "Programada" },
  { value: "CONFIRMED",   label: "Confirmada" },
  { value: "CHECKED_IN",  label: "Llegó" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "COMPLETED",   label: "Completada" },
  { value: "NO_SHOW",     label: "No asistió" },
];

function patientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function AgendaDetailPanel() {
  const { state, selectAppointment } = useAgenda();

  const appt = useMemo(
    () =>
      state.selectedAppointmentId
        ? state.appointments.find((a) => a.id === state.selectedAppointmentId) ?? null
        : null,
    [state.appointments, state.selectedAppointmentId],
  );

  if (!appt) {
    return (
      <aside className={styles.detailPanel} aria-label="Detalle de cita">
        <div className={styles.detailEmpty}>
          <span>Selecciona una cita para ver su detalle</span>
        </div>
      </aside>
    );
  }

  const doctorMeta = appt.doctor
    ? state.doctors.find((d) => d.id === appt.doctor!.id) ?? null
    : null;
  const docColor = appt.doctor
    ? doctorColorFor(appt.doctor.id, doctorMeta?.color ?? null)
    : "var(--brand)";
  const statusColor = STATUS_COLOR[appt.status];

  const start = formatSlotTime(appt.startsAt, state.timezone);
  const end = appt.endsAt ? formatSlotTime(appt.endsAt, state.timezone) : null;
  const startMs = new Date(appt.startsAt).getTime();
  const endMs = appt.endsAt ? new Date(appt.endsAt).getTime() : startMs;
  const durationMin = Math.max(0, Math.round((endMs - startMs) / 60_000));

  const resource = appt.resourceId
    ? state.resources.find((r) => r.id === appt.resourceId) ?? null
    : null;

  const resourceLabel = resource
    ? resource.name
    : appt.isTeleconsult
    ? "Teleconsulta"
    : "—";

  const mode = appt.isTeleconsult
    ? "Teleconsulta"
    : appt.isWalkIn
    ? "Walk-in"
    : "Presencial";

  return (
    <aside
      className={styles.detailPanel}
      aria-label="Detalle de cita"
      style={{ "--mf-status-color": statusColor } as React.CSSProperties}
    >
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={styles.detailClose}
          onClick={() => selectAppointment(null)}
          aria-label="Cerrar detalle"
        >
          <X size={14} />
        </button>
        <div className={styles.detailPatientRow}>
          <div className={styles.detailAvatar} aria-hidden>
            {patientInitials(appt.patient.name)}
          </div>
          <div>
            <div className={styles.detailName}>{appt.patient.name}</div>
            <div className={styles.detailSub}>
              {appt.requiresValidation ? "Pendiente de validación" : "Paciente"}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.detailTimeCard}>
        <div>
          <span className={styles.detailTimeMain}>{start}</span>
          {end && <span className={styles.detailTimeEnd}>– {end}</span>}
        </div>
        <div className={styles.detailTimeMeta}>
          <strong>{durationMin} min</strong> · {mode}
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Información</div>
        {appt.doctor && (
          <div className={styles.detailRow}>
            <span className={styles.detailRowLabel}>Doctor</span>
            <span className={styles.detailRowValue}>
              <span
                className={styles.detailDocAvatar}
                style={{ background: docColor }}
                aria-hidden
              >
                {doctorInitials(appt.doctor.shortName)}
              </span>
              <span style={{ marginLeft: 8 }}>{appt.doctor.shortName}</span>
            </span>
          </div>
        )}
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>Tratamiento</span>
          <span className={styles.detailRowValue}>{appt.reason ?? "Consulta"}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>{resource?.kind === "ROOM" ? "Sala" : resource?.kind === "EQUIPMENT" ? "Equipo" : "Sillón"}</span>
          <span className={styles.detailRowValue}>{resourceLabel}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailRowLabel}>Modo</span>
          <span className={styles.detailRowValue}>{mode}</span>
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Estado</div>
      </div>
      <div className={styles.detailStatusGrid}>
        {STATUS_OPTIONS.map((opt) => {
          const active = appt.status === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`${styles.detailStatusBtn} ${active ? styles.active : ""}`}
              style={
                {
                  "--mf-status-color": STATUS_COLOR[opt.value],
                } as React.CSSProperties
              }
              disabled
              aria-pressed={active}
              title="Cambio de estado disponible próximamente"
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {appt.requiresValidation && appt.overrideReason && (
        <div className={styles.detailAlerts}>
          <div className={styles.detailAlertsTitle}>
            <AlertTriangle size={12} aria-hidden /> Validación pendiente
          </div>
          <div className={styles.detailAlertsContent}>{appt.overrideReason}</div>
        </div>
      )}

      <div className={styles.detailActions}>
        <button type="button" className={styles.detailAction} disabled>
          <Pencil size={12} aria-hidden /> Editar
        </button>
        <button type="button" className={styles.detailAction} disabled>
          <MessageCircle size={12} aria-hidden /> WhatsApp
        </button>
        <button
          type="button"
          className={`${styles.detailAction} ${styles.danger}`}
          disabled
        >
          <X size={12} aria-hidden /> Cancelar
        </button>
        <button
          type="button"
          className={`${styles.detailAction} ${styles.primary}`}
          disabled
        >
          <Play size={12} aria-hidden /> Iniciar consulta
        </button>
      </div>
    </aside>
  );
}
