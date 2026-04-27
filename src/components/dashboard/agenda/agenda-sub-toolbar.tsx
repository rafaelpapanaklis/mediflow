"use client";

import { Settings } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import type { AgendaColumnMode } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const COLUMN_MODE_OPTIONS: Array<{ value: AgendaColumnMode; label: string }> = [
  { value: "resource", label: "Sillones" },
  { value: "doctor",   label: "Doctores" },
];

export function AgendaSubToolbar() {
  const { state, setColumnMode, openModal, togglePendingPanel } = useAgenda();

  const visibleAppts = state.appointments.filter(
    (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
  ).length;
  const inSala = state.appointments.filter((a) => a.status === "CHECKED_IN").length;
  const pendingFromState = state.appointments.filter(
    (a) => a.requiresValidation && a.status === "SCHEDULED",
  ).length;
  const pendingCount = Math.max(state.pendingValidation.length, pendingFromState);

  const isDay = state.viewMode === "day";
  const hasResources = state.resources.length > 0;
  const hasDoctors = state.doctors.some((d) => d.activeInAgenda);

  const isDayView = state.viewMode === "day";
  const isWeekView = state.viewMode === "week";
  const isMonthView = state.viewMode === "month";

  return (
    <div className={styles.subToolbar}>
      <div className={styles.subToolbarLeft}>
        {isDayView ? (
          <>
            <div className={styles.subStat}>
              <strong>{visibleAppts}</strong>
              {`cita${visibleAppts === 1 ? "" : "s"} hoy`}
            </div>
            <div className={styles.subStat}>
              <strong>{inSala}</strong>
              en sala
            </div>
            {pendingCount > 0 ? (
              <button
                type="button"
                className={`${styles.subStat} ${styles.clickable} ${styles.warning}`}
                onClick={() => togglePendingPanel()}
                title="Mostrar / colapsar pendientes de validar"
                aria-expanded={state.pendingSectionOpen}
              >
                <strong>{pendingCount}</strong>
                {`pendiente${pendingCount === 1 ? "" : "s"} validar`}
              </button>
            ) : (
              <div className={styles.subStat}>
                <strong>{pendingCount}</strong>
                pendientes validar
              </div>
            )}
          </>
        ) : isWeekView ? (
          <div className={styles.subStat}>
            <strong>{visibleAppts}</strong>
            citas esta semana
          </div>
        ) : isMonthView ? (
          <div className={styles.subStat}>
            <strong>{visibleAppts}</strong>
            citas en el mes
          </div>
        ) : (
          <div className={styles.subStat}>
            <strong>{visibleAppts}</strong>
            {`cita${visibleAppts === 1 ? "" : "s"}`}
          </div>
        )}
      </div>

      <div className={styles.subToolbarRight}>
        {isDay && hasResources && hasDoctors && (
          <>
            <span className={styles.subToolbarLabel}>Vista</span>
            <div role="tablist" aria-label="Agrupar por" className={styles.segment}>
              {COLUMN_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={state.columnMode === opt.value}
                  className={`${styles.segmentBtn} ${state.columnMode === opt.value ? styles.active : ""}`}
                  onClick={() => setColumnMode(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
        <button
          type="button"
          className={styles.gearBtn}
          onClick={() => openModal("resources")}
          aria-label="Gestionar sillones y doctores"
          title="Gestionar sillones y doctores"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
