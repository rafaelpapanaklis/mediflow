"use client";

import { useMemo } from "react";
import { useAgenda } from "./agenda-provider";
import { formatSlotTime, getTzParts } from "@/lib/agenda/time-utils";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

function dateKeyInTz(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
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

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED:    "Programada",
  CONFIRMED:    "Confirmada",
  CHECKED_IN:   "Llegó",
  IN_CHAIR:     "En sillón",
  IN_PROGRESS:  "En curso",
  COMPLETED:    "Completada",
  CHECKED_OUT:  "Salió",
  CANCELLED:    "Cancelada",
  NO_SHOW:      "No asistió",
};

function formatDayHeading(dayISO: string, timezone: string): string {
  const [y, m, d] = dayISO.split("-").map((n) => parseInt(n, 10));
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0));
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(probe);
}

export function AgendaListView() {
  const { state } = useAgenda();

  // Agrupamos por día (en clinic timezone) y ordenamos cronológicamente.
  const groups = useMemo(() => {
    const map = new Map<string, AgendaAppointmentDTO[]>();
    for (const a of state.appointments) {
      const key = dateKeyInTz(a.startsAt, state.timezone);
      const arr = map.get(key);
      if (arr) arr.push(a);
      else map.set(key, [a]);
    }
    map.forEach((arr) =>
      arr.sort((x, y) => new Date(x.startsAt).getTime() - new Date(y.startsAt).getTime()),
    );
    const ordered: Array<{ dayISO: string; appts: AgendaAppointmentDTO[] }> = [];
    map.forEach((appts, dayISO) => ordered.push({ dayISO, appts }));
    ordered.sort((a, b) => a.dayISO.localeCompare(b.dayISO));
    return ordered;
  }, [state.appointments, state.timezone]);

  if (groups.length === 0) {
    return (
      <div className={styles.listView}>
        <div className={styles.listEmpty}>No hay citas en el rango seleccionado.</div>
      </div>
    );
  }

  return (
    <div className={styles.listView} role="list">
      {groups.map((g) => (
        <div key={g.dayISO} className={styles.listGroup}>
          <div className={styles.listGroupHeader}>
            {formatDayHeading(g.dayISO, state.timezone)}
            <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
              · {g.appts.length} cita{g.appts.length === 1 ? "" : "s"}
            </span>
          </div>
          {g.appts.map((a) => (
            <ListRow key={a.id} appointment={a} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ListRow({ appointment }: { appointment: AgendaAppointmentDTO }) {
  const { state, selectAppointment } = useAgenda();
  const start = formatSlotTime(appointment.startsAt, state.timezone);
  const end = appointment.endsAt
    ? formatSlotTime(appointment.endsAt, state.timezone)
    : null;
  const doctorMeta = appointment.doctor
    ? state.doctors.find((d) => d.id === appointment.doctor!.id) ?? null
    : null;
  const docColor = appointment.doctor
    ? doctorColorFor(appointment.doctor.id, doctorMeta?.color ?? null)
    : "var(--brand)";
  const isSelected = state.selectedAppointmentId === appointment.id;

  return (
    <div
      role="listitem"
      className={`${styles.listItem} ${isSelected ? styles.selected : ""}`}
      style={
        {
          "--mf-doc-color": docColor,
          "--mf-status-color": STATUS_COLOR[appointment.status],
        } as React.CSSProperties
      }
      onClick={() => selectAppointment(appointment.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectAppointment(appointment.id);
        }
      }}
      tabIndex={0}
    >
      <div>
        <div className={styles.listItemTime}>{start}</div>
        {end && <div className={styles.listItemTimeRange}>hasta {end}</div>}
      </div>
      <div className={styles.listItemMid}>
        <div className={styles.listItemName}>{appointment.patient.name}</div>
        <div className={styles.listItemMeta}>
          {appointment.doctor && (
            <>
              <span className={styles.listItemDocAvatar} aria-hidden>
                {doctorInitials(appointment.doctor.shortName)}
              </span>
              <span>{appointment.doctor.shortName}</span>
              <span>·</span>
            </>
          )}
          <span>{appointment.reason ?? "Consulta"}</span>
        </div>
      </div>
      <span className={styles.listItemBadge}>
        {STATUS_LABEL[appointment.status]}
      </span>
    </div>
  );
}
