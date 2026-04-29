"use client";

import { useEffect, useMemo, useState } from "react";
import { useAgenda } from "./agenda-provider";
import { getTzParts, todayInTz } from "@/lib/agenda/time-utils";
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
  const fromISO = cells[0].iso;
  const toISO = cells[cells.length - 1].iso;

  // Cargamos appointments para el grid completo (42 días). Mantenemos
  // state.appointments del store sin tocar — ese es el día activo y lo
  // usan vista día/semana/lista. El mes maneja su propio cache local.
  const [monthAppts, setMonthAppts] = useState<AgendaAppointmentDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/agenda/range?from=${fromISO}&to=${toISO}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("range_failed");
        return r.json();
      })
      .then((data: { appointments: AgendaAppointmentDTO[] }) => {
        setMonthAppts(data.appointments ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [fromISO, toISO]);

  // Agrupamos por día (en clinic timezone) para counts + preview.
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaAppointmentDTO[]>();
    for (const a of monthAppts) {
      if (a.status === "CANCELLED") continue;
      const key = dateKeyInTz(a.startsAt, state.timezone);
      const arr = map.get(key);
      if (arr) arr.push(a);
      else map.set(key, [a]);
    }
    map.forEach((arr) => arr.sort((x, y) => x.startsAt.localeCompare(y.startsAt)));
    return map;
  }, [monthAppts, state.timezone]);

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
      <div className={styles.monthGrid} aria-busy={loading || undefined}>
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
              {preview.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={(e) => handleApptClick(e, a.id)}
                  className={styles.monthDayPreview}
                  style={{
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                  }}
                  title={`${fmtHHMMInTz(a.startsAt, state.timezone)} · ${a.patient.name}${a.reason ? ` — ${a.reason}` : ""}`}
                >
                  {fmtHHMMInTz(a.startsAt, state.timezone)} {a.patient.name}
                  {a.reason ? ` · ${a.reason}` : ""}
                </button>
              ))}
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
