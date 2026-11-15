"use client";

// ═══════════════════════════════════════════════════════════════════════
// Lo que se pinta DEBAJO de las visitas en una columna de la rejilla, igual
// en la vista Día y en la vista Semana:
//
//   · líneas de hora (marcadas) y de media hora (punteadas, más suaves);
//   · lo que está fuera de horario, rayado (y «Descansa» si no trabaja);
//   · los bloqueos con su motivo — el de TODA la barbería más marcado que el
//     de un barbero, porque cierra a todos;
//   · la línea de «ahora».
//
// Nada de esto captura el puntero: el resalte del hueco y el clic los
// recibe la columna, y quien decide si un hueco vale es el servidor.
// ═══════════════════════════════════════════════════════════════════════
import { formatMinutes, minuteToLabel, type MinuteWindow } from "@/lib/barber/agenda";
import { agendaCss as css } from "./agenda-ui";
import type { DragPreview } from "./use-card-drag";

export function GridLines({
  marks,
  yOf,
  end,
}: {
  marks: { minute: number; kind: "hour" | "half" }[];
  yOf: (minute: number) => number;
  end: number;
}) {
  // Las medias horas se dibujan aunque la regleta no tenga sitio para su
  // etiqueta (Semana): por eso se calculan aparte de `marks`.
  const lines: { minute: number; kind: "hour" | "half" }[] = [];
  const hours = marks.filter((m) => m.kind === "hour");
  for (const h of hours) {
    lines.push(h);
    if (h.minute + 30 < end) lines.push({ minute: h.minute + 30, kind: "half" });
  }
  return (
    <>
      {lines.map(({ minute, kind }) => (
        <div
          key={`${kind}-${minute}`}
          className={kind === "hour" ? css.hourLine : css.halfLine}
          style={{ top: yOf(minute) }}
          aria-hidden
        />
      ))}
    </>
  );
}

export function ClosedBands({
  bands,
  yOf,
  pxPerMin,
  label,
}: {
  bands: MinuteWindow[];
  yOf: (minute: number) => number;
  pxPerMin: number;
  /** Rótulo para una columna cerrada de arriba abajo («Descansa»). */
  label?: string | null;
}) {
  return (
    <>
      {bands.map((band) => {
        const height = Math.max(0, (band.end - band.start) * pxPerMin);
        return (
          <div
            key={`c-${band.start}`}
            className={css.closedBand}
            style={{ top: yOf(band.start), height }}
            aria-hidden
          >
            {label && height >= 120 ? <span className={css.closedLabel}>{label}</span> : null}
          </div>
        );
      })}
    </>
  );
}

export function TimeOffBand({
  top,
  height,
  wholeShop,
  text,
}: {
  top: number;
  height: number;
  wholeShop: boolean;
  text: string;
}) {
  return (
    <div
      className={`${css.timeOffBand} ${wholeShop ? css.timeOffShop : ""}`}
      style={{ top, height }}
      title={text}
    >
      <span className={css.timeOffText}>{text}</span>
    </div>
  );
}

/**
 * El fantasma de lo que se arrastra: DÓNDE caería y si cabe, mientras se
 * mueve. Mover: «10:30 – 11:00 a. m. · Beto». Alargar: «Hasta 11:15 a. m. ·
 * 45 min». Si no cabe, en rojo y con el MOTIVO (antes decía «Ahí no cabe» y,
 * al soltar, no decía nada).
 */
export function DragGhost({
  preview,
  top,
  height,
  left,
  width,
  barberName,
  compact = false,
  t,
}: {
  preview: DragPreview;
  top: number;
  height: number;
  left: string;
  width: string;
  barberName: string;
  compact?: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const start = minuteToLabel(preview.startMin);
  const end = minuteToLabel(preview.startMin + preview.durationMin);
  const main =
    preview.mode === "resize"
      ? t("barber.agenda.resize.until", { time: end, duration: formatMinutes(preview.durationMin) })
      : compact
        ? start
        : `${start} – ${end}`;
  const sub = !preview.ok ? preview.reason : preview.mode === "move" && !compact ? barberName : "";
  return (
    <div
      className={`${css.ghost} ${preview.ok ? "" : css.ghostBad} ${compact ? css.ghostCompact : ""}`}
      style={{ top, height, left, width }}
      data-ghost={preview.ok ? "ok" : "bad"}
      role="status"
      aria-live="polite"
    >
      <span className={css.ghostTime}>{main}</span>
      {sub ? <span className={css.ghostSub}>{sub}</span> : null}
    </div>
  );
}

export function NowLine({ top }: { top: number }) {
  return (
    <div className={css.nowLine} style={{ top }} aria-hidden>
      <span className={css.nowDot} />
    </div>
  );
}
