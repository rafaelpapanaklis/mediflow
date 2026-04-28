"use client";

import { useMemo } from "react";
import { useAgenda } from "./agenda-provider";
import { todayInTz } from "@/lib/agenda/time-utils";
import styles from "./agenda.module.css";

const WEEKDAYS_ES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

interface MonthCell {
  iso: string;
  day: number;
  month: number;
  outside: boolean;
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

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function AgendaMonthView() {
  const { state, setDay, setViewMode } = useAgenda();

  const cells = useMemo(() => buildMonthGrid(state.dayISO), [state.dayISO]);
  const today = todayInTz(state.timezone);

  function jumpToDay(iso: string) {
    setDay(iso);
    setViewMode("day");
  }

  const dayCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of state.appointments) {
      if (a.status === "CANCELLED") continue;
      const k = state.dayISO;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [state.appointments, state.dayISO]);

  return (
    <div className={styles.monthView}>
      <div className={styles.monthHeader}>
        {WEEKDAYS_ES.map((dow) => (
          <div key={dow} className={styles.monthHeaderCell}>
            {dow}
          </div>
        ))}
      </div>
      <div className={styles.monthGrid}>
        {cells.map((c) => {
          const count = dayCounts.get(c.iso) ?? 0;
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
              aria-label={`Abrir vista día ${c.iso}`}
              title={`Ver el día ${c.iso} en vista detallada`}
            >
              <span className={styles.monthDayNum}>{c.day}</span>
              {count > 0 && (
                <span className={styles.monthDayBadge}>
                  {count} cita{count === 1 ? "" : "s"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
