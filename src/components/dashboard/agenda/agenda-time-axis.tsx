"use client";

import { useAgenda } from "./agenda-provider";
import { showHalfHourLabels } from "@/lib/agenda/slot-metrics";
import styles from "./agenda.module.css";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function AgendaTimeAxis() {
  const { state, slotHpx } = useAgenda();
  const totalHours = state.dayEnd - state.dayStart;

  const hours = [];
  for (let h = 0; h <= totalHours; h++) {
    hours.push(state.dayStart + h);
  }

  const slotsPerHour = 60 / state.slotMinutes;
  const slotHeightVar = "var(--mf-agenda-slot-h)";
  // Medias horas solo cuando la densidad les da aire real (≥28px entre
  // rótulos); con el día ajustado a pantalla serían ruido apilado.
  const withHalves = showHalfHourLabels(state.slotMinutes, slotHpx);

  return (
    <div className={styles.timeAxis} aria-hidden>
      {hours.map((h) => {
        const slotsFromTop = (h - state.dayStart) * slotsPerHour;
        return (
          <div
            key={h}
            className={`${styles.timeAxisLabel} ${styles.timeAxisHour}`}
            style={{
              top: `calc(${slotsFromTop} * ${slotHeightVar})`,
            }}
          >
            {pad2(h)}:00
          </div>
        );
      })}
      {withHalves &&
        hours.slice(0, -1).map((h) => {
          const slotsFromTop =
            (h - state.dayStart) * slotsPerHour + slotsPerHour / 2;
          return (
            <div
              key={`${h}-half`}
              className={`${styles.timeAxisLabel} ${styles.timeAxisHalf}`}
              style={{
                top: `calc(${slotsFromTop} * ${slotHeightVar})`,
              }}
            >
              {pad2(h)}:30
            </div>
          );
        })}
    </div>
  );
}
