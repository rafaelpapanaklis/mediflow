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
  const { state, setColumnMode, openModal } = useAgenda();

  const visibleAppts = state.appointments.filter(
    (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
  ).length;
  const inSala = state.appointments.filter((a) => a.status === "CHECKED_IN").length;
  const pendingCount = state.pendingValidation.length;

  const isDay = state.viewMode === "day";
  const hasResources = state.resources.length > 0;
  const hasDoctors = state.doctors.some((d) => d.activeInAgenda);

  const stats = (() => {
    if (state.viewMode === "day") {
      return [
        { value: visibleAppts, label: `cita${visibleAppts === 1 ? "" : "s"} hoy` },
        { value: inSala, label: "en sala" },
        { value: pendingCount, label: `pendiente${pendingCount === 1 ? "" : "s"} validar` },
      ];
    }
    if (state.viewMode === "week") {
      return [{ value: visibleAppts, label: "citas esta semana" }];
    }
    if (state.viewMode === "month") {
      return [{ value: visibleAppts, label: "citas en el mes" }];
    }
    return [{ value: visibleAppts, label: `cita${visibleAppts === 1 ? "" : "s"}` }];
  })();

  return (
    <div className={styles.subToolbar}>
      <div className={styles.subToolbarLeft}>
        {stats.map((s, i) => (
          <div key={i} className={styles.subStat}>
            <strong>{s.value}</strong>
            {s.label}
          </div>
        ))}
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
