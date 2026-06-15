"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "./agenda-provider";
import type { AgendaFilters, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

// `labelKey` resuelve vía t(...) en el render — nunca en module scope.
const STATUS_OPTIONS: Array<{ value: AppointmentStatus; labelKey: string }> = [
  { value: "SCHEDULED",   labelKey: "agenda.filterPills.statusScheduled" },
  { value: "CONFIRMED",   labelKey: "agenda.filterPills.statusConfirmed" },
  { value: "CHECKED_IN",  labelKey: "agenda.filterPills.statusCheckedIn" },
  { value: "IN_CHAIR",    labelKey: "agenda.filterPills.statusInChair" },
  { value: "IN_PROGRESS", labelKey: "agenda.filterPills.statusInProgress" },
  { value: "COMPLETED",   labelKey: "agenda.filterPills.statusCompleted" },
  { value: "CHECKED_OUT", labelKey: "agenda.filterPills.statusCheckedOut" },
  { value: "NO_SHOW",     labelKey: "agenda.filterPills.statusNoShow" },
  { value: "CANCELLED",   labelKey: "agenda.filterPills.statusCancelled" },
];

interface PillProps {
  label: string;
  count: number;
  selected: number;
  children: (close: () => void) => React.ReactNode;
}

function Pill({ label, count, selected, children }: PillProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // El panel se renderiza en un PORTAL a <body> con position:fixed para que NO
  // lo recorte el `overflow:hidden` del contenedor .page de la agenda (ese era
  // el bug en laptops: el dropdown se abría vacío/recortado; en 4K había
  // espacio de sobra y no se notaba). Anclamos sus coords al botón.
  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => reposition();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    // capture:true → re-posiciona aunque el scroll ocurra en un contenedor interno.
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={styles.filterPillWrap}>
      <button
        ref={btnRef}
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
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.filterPanel}
            style={{ position: "fixed", top: pos.top, right: pos.right, left: "auto", zIndex: 1000 }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function AgendaFilterPills() {
  const t = useT();
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
        label={t("agenda.filterPills.doctors")}
        count={doctorOptions.length}
        selected={state.filters.doctorIds.length}
      >
        {() =>
          doctorOptions.length === 0 ? (
            <div className={styles.filterPanelEmpty}>{t("agenda.filterPills.noActiveDoctors")}</div>
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
        label={t("agenda.filterPills.chairs")}
        count={resourceOptions.length}
        selected={state.filters.resourceIds.length}
      >
        {() =>
          resourceOptions.length === 0 ? (
            <div className={styles.filterPanelEmpty}>{t("agenda.filterPills.noChairsRegistered")}</div>
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
        label={t("agenda.filterPills.status")}
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
                <span>{t(s.labelKey)}</span>
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
          title={t("agenda.filterPills.clearAllTitle")}
        >
          {t("common.clear")}
        </button>
      )}
    </div>
  );
}
