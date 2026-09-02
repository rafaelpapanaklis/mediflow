"use client";

import { useAgenda } from "./agenda-provider";
import { useAgendaHoverSlot } from "./agenda-hover-slot-context";
import { slotStartLabel } from "@/lib/agenda/hover-slot";
import { showHalfHourLabels } from "@/lib/agenda/slot-metrics";
import styles from "./agenda.module.css";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function AgendaTimeAxis() {
  const { state, slotHpx } = useAgenda();
  const hover = useAgendaHoverSlot();
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
      {/* Hora exacta del slot bajo el cursor. Va sobre la regla, con fondo
          opaco, para tapar el rótulo en punto cuando caen en la misma Y:
          quien agenda lee "12:15" sin despegar la vista de su columna. */}
      {hover && (
        <div
          className={styles.timeAxisHoverChip}
          style={{
            top: `calc((${hover.slot} + 0.5) * ${slotHeightVar})`,
          }}
        >
          {slotStartLabel(hover.slot, state.dayStart, state.slotMinutes)}
        </div>
      )}
    </div>
  );
}
