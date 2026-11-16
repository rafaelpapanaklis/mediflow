"use client";

// ═══════════════════════════════════════════════════════════════════════
// «Otra fecha» de «Agendar su próxima» (ws6-t8, Rafael 15-nov: «aquí
// debería haber un calendario, porque si quiere en 5 semanas no se puede»).
//
// Un mes a la vista, semanas de lunes a domingo como la agenda. Apagados:
// los días que ya pasaron y los que la barbería cierra (horario semanal).
// Si el cliente tiene ritmo («suele volver cada X semanas») ese día va
// marcado. Celdas de 44 px: cómodas con el dedo. Las flechas del teclado
// mueven el foco por días (←/→) y semanas (↑/↓), como un calendario nativo.
//
// La lógica (qué día está apagado, la rejilla del mes) vive en cita-core.ts
// y tiene prueba; aquí solo se pinta.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysISO } from "@/lib/barber/agenda";
import { addMonthsISO, calendarDayState, monthGrid, monthOfISO } from "./cita-core";
import css from "./cita.module.css";

type T = (key: string, vars?: Record<string, string | number>) => string;

// 2024-01-01 fue lunes: de ahí salen los nombres cortos de la semana.
const LUNES = Date.UTC(2024, 0, 1, 12);

export function OtraFechaCalendario(props: {
  todayISO: string;
  closed: Set<number>;
  /** Día que le toca por su ritmo, o null. */
  usualISO: string | null;
  usualWeeks: number | null;
  selectedISO: string | null;
  intlLocale: string;
  disabled?: boolean;
  onPick: (dateISO: string) => void;
  t: T;
}) {
  const { todayISO, closed, usualISO, selectedISO, t } = props;
  const [month, setMonth] = useState(() => monthOfISO(selectedISO ?? usualISO ?? todayISO));
  const [focusISO, setFocusISO] = useState<string>(() => selectedISO ?? usualISO ?? todayISO);
  const grid = useMemo(() => monthGrid(month), [month]);
  // El día que entra con Tab: el enfocado si está en este mes y se puede; si
  // no, el primero que se puede (un botón apagado no recibe foco).
  const tabbable = useMemo(() => {
    const dias = grid.flat().filter((d): d is string => Boolean(d));
    const ok = (d: string) => calendarDayState({ dateISO: d, todayISO, closed }) === "open";
    return dias.includes(focusISO) && ok(focusISO) ? focusISO : (dias.find(ok) ?? null);
  }, [grid, focusISO, todayISO, closed]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const moveFocus = useRef(false);

  const firstMonth = monthOfISO(todayISO);
  const lastMonth = monthOfISO(addDaysISO(todayISO, 365));

  const fmtMonth = new Intl.DateTimeFormat(props.intlLocale, { timeZone: "UTC", month: "long", year: "numeric" });
  const fmtWeekday = new Intl.DateTimeFormat(props.intlLocale, { timeZone: "UTC", weekday: "narrow" });
  const fmtWeekdayLong = new Intl.DateTimeFormat(props.intlLocale, { timeZone: "UTC", weekday: "long" });
  const fmtDay = new Intl.DateTimeFormat(props.intlLocale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

  // Al mover el foco con el teclado a otro mes, se cambia de mes y se enfoca.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-dia="${focusISO}"]`)?.focus();
  }, [focusISO, month]);

  const onKey = (e: React.KeyboardEvent, iso: string) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!delta) return;
    e.preventDefault();
    // Salta los días apagados (no reciben foco): el siguiente día que sí.
    let next = addDaysISO(iso, delta);
    for (let i = 0; i < 60 && calendarDayState({ dateISO: next, todayISO, closed }) !== "open"; i++) {
      next = addDaysISO(next, delta);
    }
    if (calendarDayState({ dateISO: next, todayISO, closed }) !== "open") return;
    const m = monthOfISO(next);
    moveFocus.current = true;
    setFocusISO(next);
    if (m !== month) setMonth(m);
  };

  return (
    <div className={css.cal} role="group" aria-label={t("barber.agenda.cita.next.calTitle")}>
      <div className={css.calHead}>
        <button
          type="button"
          className={css.calNav}
          onClick={() => setMonth((m) => addMonthsISO(m, -1))}
          disabled={month <= firstMonth}
          aria-label={t("barber.agenda.cita.next.calPrev")}
        >
          <ChevronLeft size={18} />
        </button>
        <span className={css.calMonth} aria-live="polite">
          {fmtMonth.format(asDate(`${month}-01`))}
        </span>
        <button
          type="button"
          className={css.calNav}
          onClick={() => setMonth((m) => addMonthsISO(m, 1))}
          disabled={month >= lastMonth}
          aria-label={t("barber.agenda.cita.next.calNext")}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className={css.calGrid} ref={gridRef} role="grid" aria-label={fmtMonth.format(asDate(`${month}-01`))}>
        <div className={css.calRow} role="row">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className={css.calWd} role="columnheader" aria-label={fmtWeekdayLong.format(new Date(LUNES + i * 86_400_000))}>
              {fmtWeekday.format(new Date(LUNES + i * 86_400_000))}
            </span>
          ))}
        </div>
        {grid.map((week, wi) => (
          <div key={wi} className={css.calRow} role="row">
            {week.map((iso, di) => {
              if (!iso) return <span key={di} className={css.calEmpty} role="gridcell" />;
              const state = calendarDayState({ dateISO: iso, todayISO, closed });
              const off = state !== "open";
              const usual = iso === usualISO && !off;
              const selected = iso === selectedISO;
              const label =
                state === "past"
                  ? t("barber.agenda.cita.next.calPast", { day: fmtDay.format(asDate(iso)) })
                  : state === "closed"
                    ? t("barber.agenda.cita.next.calClosed", { day: fmtDay.format(asDate(iso)) })
                    : usual
                      ? t("barber.agenda.cita.next.calUsual", { day: fmtDay.format(asDate(iso)), weeks: props.usualWeeks ?? "" })
                      : fmtDay.format(asDate(iso));
              return (
                <span key={iso} role="gridcell" aria-selected={selected}>
                  <button
                    type="button"
                    data-dia={iso}
                    data-estado={state}
                    data-le-toca={usual ? "1" : undefined}
                    className={[
                      css.calDay,
                      state === "closed" ? css.calClosed : "",
                      usual ? css.calUsual : "",
                      iso === todayISO ? css.calToday : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={selected}
                    aria-label={label}
                    title={label}
                    disabled={off || props.disabled}
                    tabIndex={iso === tabbable ? 0 : -1}
                    onFocus={() => setFocusISO(iso)}
                    onKeyDown={(e) => onKey(e, iso)}
                    onClick={() => props.onPick(iso)}
                  >
                    {Number(iso.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {usualISO || closed.size > 0 ? (
        <div className={css.calLegend}>
          {usualISO ? (
            <span>
              <i className={`${css.calDot} ${css.calDotUsual}`} aria-hidden="true" /> {t("barber.agenda.cita.next.calLegendUsual")}
            </span>
          ) : null}
          {closed.size > 0 ? (
            <span>
              <i className={`${css.calDot} ${css.calDotClosed}`} aria-hidden="true" /> {t("barber.agenda.cita.next.calLegendClosed")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
