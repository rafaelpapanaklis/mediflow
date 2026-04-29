"use client";

import { useMemo } from "react";
import { useAgenda } from "./agenda-provider";
import { getTzParts, todayInTz } from "@/lib/agenda/time-utils";
import { doctorColorFor } from "@/lib/agenda/doctor-color";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const WEEKDAYS_ES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

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

function dateKeyInTz(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function fmtHHMMInTz(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function AgendaMonthView() {
  const { state, setDay, setViewMode, selectAppointment } = useAgenda();

  const cells = useMemo(() => buildMonthGrid(state.dayISO), [state.dayISO]);
  const today = todayInTz(state.timezone);

  // El provider ya cargó state.appointments con el rango del grid (42
  // días) cuando viewMode === "month". Solo agrupamos por día.
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaAppointmentDTO[]>();
    for (const a of state.appointments) {
      if (a.status === "CANCELLED") continue;
      const key = dateKeyInTz(a.startsAt, state.timezone);
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
        {WEEKDAYS_ES.map((dow) => (
          <div key={dow} className={styles.monthHeaderCell}>
            {dow}
          </div>
        ))}
      </div>
      <div className={styles.monthGrid}>
        {cells.map((c) => {
          const appts = byDay.get(c.iso) ?? [];
          const count = appts.length;
          const preview = appts.slice(0, 5);
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
              aria-label={`Abrir vista día ${c.iso}, ${count} cita${count === 1 ? "" : "s"}`}
              title={`Ver el día ${c.iso} en vista detallada`}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                <span className={styles.monthDayNum}>{c.day}</span>
                {count > 0 && (
                  <span className={styles.monthDayBadge}>
                    {count} cita{count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {preview.map((a) => {
                const docMeta = a.doctor
                  ? state.doctors.find((d) => d.id === a.doctor!.id) ?? null
                  : null;
                const docColor = a.doctor
                  ? doctorColorFor(a.doctor.id, docMeta?.color ?? null)
                  : "var(--brand)";
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={(e) => handleApptClick(e, a.id)}
                    className={styles.monthDayPreview}
                    style={{
                      border: 0,
                      borderLeft: `3px solid ${docColor}`,
                      background: "transparent",
                      padding: "0 0 0 5px",
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                    }}
                    title={`${fmtHHMMInTz(a.startsAt, state.timezone)} · ${a.patient.name}${a.reason ? ` — ${a.reason}` : ""}`}
                  >
                    {fmtHHMMInTz(a.startsAt, state.timezone)} {a.patient.name}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </button>
                );
              })}
              {more > 0 && (
                <div className={styles.monthDayPreview} style={{ fontWeight: 600 }}>
                  +{more} más
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
