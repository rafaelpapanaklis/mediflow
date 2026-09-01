"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "./agenda-provider";
import { AgendaDoctorOptions } from "./agenda-doctor-options";
import {
  LEGEND_CHIP_GAP_PX,
  LEGEND_MIN_DOCTORS,
  fitLegendChips,
  legendAppliesTo,
  legendDoctors,
  orderLegendStrip,
  type LegendDoctor,
} from "@/lib/agenda/doctor-legend";
import styles from "./agenda.module.css";

/**
 * Leyenda de color por doctor.
 *
 * DÓNDE: dentro de la fila de la sub-toolbar que YA existía (los 40px de
 * `--mf-subbar-h`), entre los contadores y los segmentos. Cuesta **0px de
 * alto**: `.page` sigue con sus mismas tres filas, la grilla conserva su
 * `1fr` entero y `slotHpx` no se mueve ni un píxel — lo que se ganó con
 * "el día cabe sin scroll" queda intacto.
 *
 * QUÉ HACE: además de explicar el color, ES el filtro. Cada chip lee y
 * escribe el MISMO `state.filters.doctorIds` que la pill "Doctores" de la
 * toolbar; no hay estado nuevo, así que los dos controles no pueden
 * contradecirse. El "+N" abre la lista completa con el mismo componente
 * que monta la pill (`AgendaDoctorOptions`).
 *
 * MUCHOS DOCTORES: la tira nunca crece ni envuelve. Se miden los chips en
 * un espejo oculto (mismo DOM ⇒ las container queries ya aplicadas) y se
 * pinta solo lo que cabe, con "+N" para el resto. El orden pone delante a
 * los filtrados y a los que tienen citas en la vista, así que los colores
 * que están EN PANTALLA son los primeros en aparecer.
 */
export function AgendaDoctorLegend() {
  const t = useT();
  const { state, setFilters } = useAgenda();

  const applies = legendAppliesTo(state.viewMode, state.columnMode);

  const doctors = useMemo(
    () =>
      legendDoctors(
        state.doctors,
        state.appointments,
        state.filters.doctorIds,
        t("agenda.pageClient.professionalFallback"),
      ),
    [state.doctors, state.appointments, state.filters.doctorIds, t],
  );

  const ordered = useMemo(() => orderLegendStrip(doctors), [doctors]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  // null = todavía sin medir: se pintan todos (el overflow:hidden del
  // contenedor los recorta) y el layout effect corrige antes de pintar.
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // La medición se lee de un ref y NO se re-crea con dependencias: el
  // efecto de abajo la dispara después de CADA commit. Es un punto fijo —
  // ni el ancho de la tira (lo fija el flex del padre) ni los anchos del
  // espejo (siempre pinta la lista entera) dependen de `visibleCount`, así
  // que la segunda pasada calcula lo mismo, `setVisibleCount` corta y se
  // acabó. Sin esto, el número quedaba VIEJO en Día + Sillones: al pasar
  // de Semana a Día aparecen dos contadores y el segmento "Vista", la tira
  // se estrecha a la mitad y, como ni las citas ni los doctores habían
  // cambiado, un efecto con dependencias no volvía a medir.
  const measure = () => {
    const wrap = wrapRef.current;
    const mirror = mirrorRef.current;
    if (!wrap || !mirror) return;
    const widths = Array.from(
      mirror.querySelectorAll<HTMLElement>("[data-legend-chip]"),
    ).map((el) => el.getBoundingClientRect().width);
    const moreWidth = moreRef.current?.getBoundingClientRect().width ?? 0;
    const next = fitLegendChips(
      wrap.clientWidth,
      widths,
      moreWidth,
      LEGEND_CHIP_GAP_PX,
    );
    setVisibleCount((prev) => (prev === next ? prev : next));
  };
  const measureRef = useRef(measure);

  useLayoutEffect(() => {
    measureRef.current = measure;
    measure();
  });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    // El ancho de la tira lo decide el flex del padre (`flex: 1 1 0%`), no
    // su contenido: pintar más o menos chips NO cambia el ancho observado
    // y no hay bucle de ResizeObserver.
    //
    // La medición va en un rAF a propósito: cuando el ancho cruza uno de
    // los breakpoints de @container, los chips del espejo cambian de ancho
    // por CSS, sin render de React. Medir dentro del callback del observer
    // mezclaba el ancho nuevo con anchos viejos.
    let raf = 0;
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => measureRef.current());
    });
    obs.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [applies]);

  // Popover del "+N": portal a <body> con position:fixed, como la pill de
  // filtros — el `.page` de la agenda es overflow:hidden y un panel
  // absoluto se recortaría (bug ya vivido en laptops).
  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 250;
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
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
    const onReflow = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  if (!applies || ordered.length < LEGEND_MIN_DOCTORS) return null;

  const shown = visibleCount === null ? ordered : ordered.slice(0, visibleCount);
  const hidden = visibleCount === null ? [] : ordered.slice(visibleCount);
  const hiddenSelected = hidden.some((d) => d.selected);
  const filtering = state.filters.doctorIds.length > 0;

  const toggle = (id: string) => {
    const current = state.filters.doctorIds;
    setFilters({
      ...state.filters,
      doctorIds: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };

  const chip = (d: LegendDoctor, interactive: boolean) => {
    const className = [
      styles.docChip,
      d.selected ? styles.on : "",
      filtering && !d.selected ? styles.off : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = {
      "--mf-doc-color": d.color,
      "--mf-doc-ink": d.ink,
    } as React.CSSProperties;
    const body = (
      <>
        {/* El MISMO chip que la card pinta arriba a la izquierda. */}
        <span className={styles.apptDocAvatar} aria-hidden>
          {d.initials}
        </span>
        <span className={styles.docChipName}>{d.name}</span>
      </>
    );
    if (!interactive) {
      return (
        <span key={d.id} data-legend-chip className={className} style={style}>
          {body}
        </span>
      );
    }
    return (
      <button
        key={d.id}
        type="button"
        data-legend-chip
        className={className}
        style={style}
        aria-pressed={d.selected}
        onClick={() => toggle(d.id)}
        title={
          d.selected
            ? t("agenda.doctorLegend.clearFilter", { name: d.fullName })
            : t("agenda.doctorLegend.filterBy", { name: d.fullName })
        }
      >
        {body}
      </button>
    );
  };

  return (
    <div
      ref={wrapRef}
      className={styles.docLegend}
      style={{ gap: LEGEND_CHIP_GAP_PX }}
      role="group"
      aria-label={t("agenda.doctorLegend.aria")}
    >
      {shown.map((d) => chip(d, true))}

      {hidden.length > 0 && (
        <button
          ref={btnRef}
          type="button"
          className={`${styles.docChipMore} ${hiddenSelected ? styles.on : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          title={t("agenda.doctorLegend.moreTitle", { count: hidden.length })}
        >
          {t("agenda.doctorLegend.more", { count: hidden.length })}
        </button>
      )}

      {/* Espejo de medición: el MISMO DOM (mismas clases ⇒ mismas
          container queries) fuera del flujo y sin exponerse a lector de
          pantalla. Está absoluto dentro de un contenedor con
          overflow:hidden, así que visibility:hidden no desborda nada. */}
      <div
        ref={mirrorRef}
        className={styles.docLegendMirror}
        style={{ gap: LEGEND_CHIP_GAP_PX }}
        aria-hidden
      >
        {ordered.map((d) => chip(d, false))}
        <span ref={moreRef} className={styles.docChipMore}>
          {t("agenda.doctorLegend.more", { count: ordered.length })}
        </span>
      </div>

      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.filterPanel}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              right: "auto",
              width: 250,
              zIndex: 1000,
            }}
          >
            <div className={styles.docPanelHint}>{t("agenda.doctorLegend.panelHint")}</div>
            <AgendaDoctorOptions emptyLabel={t("agenda.filterPills.noActiveDoctors")} />
          </div>,
          document.body,
        )}
    </div>
  );
}
