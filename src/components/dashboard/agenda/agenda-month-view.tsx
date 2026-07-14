"use client";

import { useMemo } from "react";
import { useAgenda } from "./agenda-provider";
import { useT } from "@/i18n/i18n-provider";
import { todayInTz } from "@/lib/agenda/time-utils";
import { calendarDayISO, formatTimeInTz } from "@/lib/agenda/date-ranges";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const WEEKDAY_KEYS = [
  "agenda.monthView.dowMon",
  "agenda.monthView.dowTue",
  "agenda.monthView.dowWed",
  "agenda.monthView.dowThu",
  "agenda.monthView.dowFri",
  "agenda.monthView.dowSat",
  "agenda.monthView.dowSun",
];
const MONTH_PREVIEW_LIMIT = 4;

// Variante A (solo presentación): color POR ESTADO — mismo mapa de tokens
// que STATUS_COLOR de agenda-appointment-card.tsx. CANCELLED no aparece en
// vista Mes (se filtra arriba), se incluye por completitud del tipo.
const MONTH_STATUS_COLOR: Record<string, string> = {
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

interface MonthCell {
  iso: string;
  day: number;
  month: number;
  outside: boolean;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function buildMonthGrid(refISO: string): MonthCell[] {
  const [y, m] = refISO.split("-").map((n) => parseInt(n, 10));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const dow = (first.getUTCDay() + 6) % 7; // Mon=0
  const startDay = -dow;
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m - 1, startDay + 1 + i));
    cells.push({
      iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      outside: d.getUTCMonth() + 1 !== m,
    });
  }
  return cells;
}

export function AgendaMonthView() {
  const { state, setDay, setViewMode, selectAppointment } = useAgenda();
  const t = useT();

  const cells = useMemo(() => buildMonthGrid(state.dayISO), [state.dayISO]);
  const today = todayInTz(state.timezone);

  // El provider ya cargó state.appointments con el rango del grid (42
  // días) cuando viewMode === "month". Solo agrupamos por día.
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaAppointmentDTO[]>();
    for (const a of state.appointments) {
      if (a.status === "CANCELLED") continue;
      const key = calendarDayISO(a.startsAt, state.timezone);
      const arr = map.get(key);
      if (arr) arr.push(a);
      else map.set(key, [a]);
    }
    map.forEach((arr) => arr.sort((x, y) => x.startsAt.localeCompare(y.startsAt)));
    return map;
  }, [state.appointments, state.timezone]);

  function jumpToDay(iso: string) {
    setDay(iso);
    setViewMode("day");
  }

  function handleApptClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    selectAppointment(id);
  }

  return (
    <div className={styles.monthView}>
      <div className={styles.monthHeader}>
        {WEEKDAY_KEYS.map((dowKey) => (
          <div key={dowKey} className={styles.monthHeaderCell}>
            {t(dowKey)}
          </div>
        ))}
      </div>
      <div className={styles.monthGrid}>
        {cells.map((c) => {
          const appts = byDay.get(c.iso) ?? [];
          const count = appts.length;
          const preview = appts.slice(0, MONTH_PREVIEW_LIMIT);
          const more = Math.max(0, count - preview.length);
          const classes = [
            styles.monthDay,
            c.outside ? styles.outside : "",
            c.iso === today ? styles.today : "",
            c.iso === state.dayISO ? styles.selected : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={c.iso}
              className={classes}
              onClick={() => jumpToDay(c.iso)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  jumpToDay(c.iso);
                }
              }}
              aria-label={t("agenda.monthView.dayCellAria", { iso: c.iso, count })}
              title={t("agenda.monthView.dayCellTitle", { iso: c.iso })}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                <span className={styles.monthDayNum}>{c.day}</span>
                {count > 0 && (
                  <span className={styles.monthDayBadge}>
                    {t("agenda.monthView.apptCount", { count })}
                  </span>
                )}
              </div>
              {preview.map((a) => {
                const statusColor = MONTH_STATUS_COLOR[a.status] ?? "var(--brand)";
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={(e) => handleApptClick(e, a.id)}
                    className={styles.monthDayPreview}
                    data-status={a.status}
                    style={{ "--mf-status-color": statusColor } as React.CSSProperties}
                    title={`${formatTimeInTz(a.startsAt, state.timezone)} · ${a.patient.name}${a.reason ? ` — ${a.reason}` : ""}`}
                  >
                    <span className={styles.monthChipTime}>
                      {formatTimeInTz(a.startsAt, state.timezone)}
                    </span>
                    <span className={styles.monthChipText}>
                      {a.patient.name}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </span>
                  </button>
                );
              })}
              {more > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpToDay(c.iso);
                  }}
                  className={styles.monthDayMore}
                  title={t("agenda.monthView.viewApptsTitle", { count, iso: c.iso })}
                  aria-label={t("agenda.monthView.viewApptsAria", { count, iso: c.iso })}
                >
                  {t("agenda.monthView.moreCount", { more })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
