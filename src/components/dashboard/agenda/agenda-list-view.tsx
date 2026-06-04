"use client";

import { useMemo } from "react";
import { useAgenda } from "./agenda-provider";
import { useT } from "@/i18n/i18n-provider";
import { calendarDayISO, formatTimeInTz } from "@/lib/agenda/date-ranges";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

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

const STATUS_LABEL_KEY: Record<AppointmentStatus, string> = {
  SCHEDULED:    "agenda.listView.statusScheduled",
  CONFIRMED:    "agenda.listView.statusConfirmed",
  CHECKED_IN:   "agenda.listView.statusCheckedIn",
  IN_CHAIR:     "agenda.listView.statusInChair",
  IN_PROGRESS:  "agenda.listView.statusInProgress",
  COMPLETED:    "agenda.listView.statusCompleted",
  CHECKED_OUT:  "agenda.listView.statusCheckedOut",
  CANCELLED:    "agenda.listView.statusCancelled",
  NO_SHOW:      "agenda.listView.statusNoShow",
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
  const t = useT();

  // Agrupamos por día (en clinic timezone) y ordenamos cronológicamente.
  // Excluimos CANCELLED por default (mismo criterio que vista Mes); el
  // usuario las ve en el detalle individual de la cita, no en el feed
  // de "qué viene".
  const groups = useMemo(() => {
    const map = new Map<string, AgendaAppointmentDTO[]>();
    for (const a of state.appointments) {
      if (a.status === "CANCELLED") continue;
      const key = calendarDayISO(a.startsAt, state.timezone);
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
        <div className={styles.listEmpty}>{t("agenda.listView.empty")}</div>
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
              · {t("agenda.listView.apptCount", { count: g.appts.length })}
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
  const t = useT();
  const start = formatTimeInTz(appointment.startsAt, state.timezone);
  const end = appointment.endsAt
    ? formatTimeInTz(appointment.endsAt, state.timezone)
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
        {end && <div className={styles.listItemTimeRange}>{t("agenda.listView.until", { end })}</div>}
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
          <span>{appointment.reason ?? t("agenda.listView.consultation")}</span>
        </div>
      </div>
      <span className={styles.listItemBadge}>
        {t(STATUS_LABEL_KEY[appointment.status])}
      </span>
    </div>
  );
}
