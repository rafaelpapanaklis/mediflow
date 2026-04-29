"use client";

import { useEffect, useRef, useState } from "react";
import { useAgenda } from "./agenda-provider";
import type { AgendaFilters, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const STATUS_OPTIONS: Array<{ value: AppointmentStatus; label: string }> = [
  { value: "SCHEDULED",   label: "Programada" },
  { value: "CONFIRMED",   label: "Confirmada" },
  { value: "CHECKED_IN",  label: "Llegó" },
  { value: "IN_CHAIR",    label: "En sillón" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "COMPLETED",   label: "Completada" },
  { value: "CHECKED_OUT", label: "Salió" },
  { value: "NO_SHOW",     label: "No asistió" },
  { value: "CANCELLED",   label: "Cancelada" },
];

interface PillProps {
  label: string;
  count: number;
  selected: number;
  children: (close: () => void) => React.ReactNode;
}

function Pill({ label, count, selected, children }: PillProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={wrapRef} className={styles.filterPillWrap}>
      <button
        type="button"
        className={`${styles.filterPill} ${selected > 0 ? styles.active : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        <span className={styles.filterPillCount}>{selected > 0 ? selected : count}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && <div className={styles.filterPanel}>{children(close)}</div>}
    </div>
  );
}

export function AgendaFilterPills() {
  const { state, setFilters, clearFilters } = useAgenda();

  const doctorOptions = state.doctors.filter((d) => d.activeInAgenda);
  const resourceOptions = state.resources;

  const updateFilters = (patch: Partial<AgendaFilters>) => {
    setFilters({ ...state.filters, ...patch });
  };

  const toggle = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const totalActive =
    state.filters.doctorIds.length +
    state.filters.resourceIds.length +
    state.filters.statuses.length;

  return (
    <div className={styles.filtersRow}>
      <Pill
        label="Doctores"
        count={doctorOptions.length}
        selected={state.filters.doctorIds.length}
      >
        {() =>
          doctorOptions.length === 0 ? (
            <div className={styles.filterPanelEmpty}>Sin doctores activos</div>
          ) : (
            <>
              {doctorOptions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.filterPanelOption}
                  onClick={() => updateFilters({ doctorIds: toggle(state.filters.doctorIds, d.id) })}
                >
                  <input
                    type="checkbox"
                    checked={state.filters.doctorIds.includes(d.id)}
                    readOnly
                  />
                  <span>{d.displayName ?? d.shortName ?? d.id}</span>
                </button>
              ))}
            </>
          )
        }
      </Pill>

      <Pill
        label="Sillones"
        count={resourceOptions.length}
        selected={state.filters.resourceIds.length}
      >
        {() =>
          resourceOptions.length === 0 ? (
            <div className={styles.filterPanelEmpty}>Sin sillones registrados</div>
          ) : (
            <>
              {resourceOptions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={styles.filterPanelOption}
                  onClick={() => updateFilters({ resourceIds: toggle(state.filters.resourceIds, r.id) })}
                >
                  <input
                    type="checkbox"
                    checked={state.filters.resourceIds.includes(r.id)}
                    readOnly
                  />
                  <span>{r.name}</span>
                </button>
              ))}
            </>
          )
        }
      </Pill>

      <Pill
        label="Estado"
        count={STATUS_OPTIONS.length}
        selected={state.filters.statuses.length}
      >
        {() => (
          <>
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={styles.filterPanelOption}
                onClick={() => updateFilters({ statuses: toggle(state.filters.statuses, s.value) })}
              >
                <input
                  type="checkbox"
                  checked={state.filters.statuses.includes(s.value)}
                  readOnly
                />
                <span>{s.label}</span>
              </button>
            ))}
          </>
        )}
      </Pill>

      {totalActive > 0 && (
        <button
          type="button"
          className={styles.filterClearBtn}
          onClick={clearFilters}
          title="Quitar todos los filtros"
        >
          Limpiar
        </button>
      )}
    </div>
  );
}
