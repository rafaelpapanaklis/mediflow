"use client";

import { useAgenda } from "./agenda-provider";
import styles from "./agenda.module.css";

export function AgendaTimeAxis() {
  const { state } = useAgenda();
  const totalHours = state.dayEnd - state.dayStart;

  const labels = [];
  for (let h = 0; h <= totalHours; h++) {
    labels.push(state.dayStart + h);
  }

  const slotsPerHour = 60 / state.slotMinutes;
  const slotHeightVar = "var(--mf-agenda-slot-h)";

  return (
    <div className={styles.timeAxis} aria-hidden>
      {labels.map((h) => {
        const slotsFromTop = (h - state.dayStart) * slotsPerHour;
        return (
          <div
            key={h}
            className={styles.timeAxisLabel}
            style={{
              top: `calc(${slotsFromTop} * ${slotHeightVar})`,
            }}
          >
            {h.toString().padStart(2, "0")}:00
          </div>
        );
      })}
    </div>
  );
}
