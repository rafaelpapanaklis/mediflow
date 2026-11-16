"use client";

// ═══════════════════════════════════════════════════════════════════════
// «¿Con quién?» — el MISMO selector de barbero en la Fila (anotar y
// sentar) y en Nueva visita. Muestra solo a los que trabajan ese día
// (`pick.visible`, de src/lib/barber/quien-trabaja.ts) y, si quedaron
// ocultos, un «Ver todos (N)» para el caso raro (cubre a un compañero, el
// horario está mal cargado). El elegido siempre está en la lista aunque
// ese día no trabaje: nunca se cambia la elección a escondidas.
// ═══════════════════════════════════════════════════════════════════════
import { forwardRef, useState } from "react";
import type { BarberDTO } from "@/lib/barber/types";
import type { BarberPick } from "@/lib/barber/quien-trabaja";
import { agendaCss as css } from "./agenda-ui";

export interface BarberoSelectProps {
  barbers: BarberDTO[];
  /** null = sin datos de horario: se listan todos los activos. */
  pick: Pick<BarberPick, "visible" | "hidden"> | null;
  value: string;
  onChange: (barberId: string) => void;
  /** Primera opción con valor "" (p. ej. «El que esté libre»). */
  anyLabel?: string;
  /** Traductor de barber.agenda (textos del botón y de la marca «descansa»). */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** true = la fecha es hoy (cambia «hoy» por «ese día» en el botón). */
  isToday: boolean;
}

export const BarberoSelect = forwardRef<HTMLSelectElement, BarberoSelectProps>(function BarberoSelect(props, ref) {
  const { t } = props;
  const [all, setAll] = useState(false);
  const active = props.barbers.filter((b) => b.isActive);
  const visible = props.pick ? new Set(props.pick.visible) : null;
  const shown = active.filter((b) => all || !visible || visible.has(b.id) || b.id === props.value);
  const hidden = props.pick && !all ? active.filter((b) => !visible?.has(b.id) && b.id !== props.value).length : 0;
  const offToday = (id: string) => Boolean(visible && !visible.has(id));

  return (
    <>
      <select ref={ref} className={css.select} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.anyLabel !== undefined ? <option value="">{props.anyLabel}</option> : null}
        {shown.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nickname || b.name}
            {offToday(b.id) ? ` · ${t(props.isToday ? "barber.agenda.picker.offToday" : "barber.agenda.picker.offThatDay")}` : ""}
          </option>
        ))}
      </select>
      {hidden > 0 ? (
        <button type="button" className={css.pickerToggle} onClick={() => setAll(true)}>
          {t(props.isToday ? "barber.agenda.picker.showAllToday" : "barber.agenda.picker.showAllThatDay", { count: hidden })}
        </button>
      ) : all && props.pick && props.pick.hidden > 0 ? (
        <button type="button" className={css.pickerToggle} onClick={() => setAll(false)}>
          {t(props.isToday ? "barber.agenda.picker.onlyWorkingToday" : "barber.agenda.picker.onlyWorkingThatDay")}
        </button>
      ) : null}
    </>
  );
});
