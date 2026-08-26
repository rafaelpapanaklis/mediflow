"use client";

// ═══════════════════════════════════════════════════════════════════════
// La rejilla del calendario. UNA sola para las dos vistas:
//
//   · DÍA    → una columna por asesor. Arrastrar de lado cambia de asesor.
//   · SEMANA → una columna por día.    Arrastrar de lado cambia de día.
//
// Es la misma máquina porque el gesto es el mismo: la altura da la HORA y
// la columna da la otra dimensión. Quien monta el tablero decide cuál es
// esa otra dimensión (`columnKind`) y recibe el destino ya resuelto.
//
// EL ARRASTRE ES CON EVENTOS DE PUNTERO A PELO, no con @dnd-kit (que sí
// está instalado y lo usa el kanban de prospectos). La razón es la misma
// que documentó la agenda de barber: la rejilla tendría cientos de zonas
// soltables (15 min × N columnas) y lo que hace falta es una posición
// continua con snap, no un catálogo de destinos discretos.
//
// FECHAS: la posición vertical sale de realtyMinuteOfDay() EN LA ZONA DE LA
// CUENTA, nunca de getHours(). En Vercel el proceso corre en UTC y una
// visita de las 11:00 en Guadalajara se pintaba a las 17:00.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useMemo, useRef, useState } from "react";
import type { TFunction } from "@/i18n/t";
import css from "./visits.module.css";
import {
  assignVisitLanes,
  computeVisitGridBounds,
  isVisitMovable,
  minuteToLabel,
  REALTY_CARD_MIN_PX,
  REALTY_DAY_PX_PER_MIN,
  REALTY_SLOT_MINUTES,
  REALTY_VISIT_BLOCK_MIN,
  REALTY_WEEK_PX_PER_MIN,
  realtyMinuteOfDay,
  snapMinute,
  type RealtyVisitCardDTO,
} from "./visit-core";

export interface BoardColumn {
  id: string;
  label: string;
  meta?: string | null;
  /** Solo en la vista de semana: para la línea del "ahora" y el resaltado. */
  isToday?: boolean;
}

export interface DropTarget {
  visit: RealtyVisitCardDTO;
  columnId: string;
  minute: number;
}

interface DragState {
  visitId: string;
  pointerId: number;
  originX: number;
  originY: number;
  active: boolean;
  minute: number;
  columnId: string;
}

export function VisitBoard({
  visits,
  columns,
  columnOf,
  columnKind,
  timeZone,
  t,
  now,
  canDrag,
  onOpen,
  onDrop,
}: {
  visits: RealtyVisitCardDTO[];
  columns: BoardColumn[];
  /** A qué columna pertenece cada visita. Devuelve null si no cabe en ninguna. */
  columnOf: (visit: RealtyVisitCardDTO) => string | null;
  columnKind: "agent" | "day";
  timeZone: string;
  t: TFunction;
  /** Epoch en ms; se usa para la línea del "ahora" y para apagar el pasado. */
  now: number;
  canDrag: boolean;
  onOpen: (visit: RealtyVisitCardDTO) => void;
  onDrop: (target: DropTarget) => void;
}) {
  const PX = columnKind === "day" ? REALTY_DAY_PX_PER_MIN : REALTY_WEEK_PX_PER_MIN;

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // Separa "clic" de "cola de arrastre": sin esto, soltar la tarjeta abría
  // el detalle de la visita que se acababa de mover.
  const justDragged = useRef(false);
  const columnRefs = useRef(new Map<string, HTMLDivElement>());

  const placed = useMemo(() => {
    const out: { visit: RealtyVisitCardDTO; columnId: string; minute: number }[] = [];
    for (let i = 0; i < visits.length; i++) {
      const v = visits[i];
      const columnId = columnOf(v);
      if (!columnId) continue;
      out.push({ visit: v, columnId, minute: realtyMinuteOfDay(new Date(v.scheduledAt), timeZone) });
    }
    return out;
  }, [visits, columnOf, timeZone]);

  const bounds = useMemo(
    () => computeVisitGridBounds(placed.map((p) => p.minute)),
    [placed],
  );

  const height = Math.max(260, (bounds.end - bounds.start) * PX);
  const yOf = useCallback((minute: number) => (minute - bounds.start) * PX, [bounds.start, PX]);

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = bounds.start; m <= bounds.end; m += 60) marks.push(m);
    return marks;
  }, [bounds.start, bounds.end]);

  const nowMinute = realtyMinuteOfDay(new Date(now), timeZone);

  /**
   * En qué columna cae la x del puntero.
   *
   * 🔴 Fuera de la rejilla se devuelve la columna MÁS CERCANA, no la primera
   * que se encontró. Con "la primera" bastaba con arrastrar un poco más allá
   * del borde derecho para que la visita saltara al PRIMER asesor de la
   * lista — una reasignación silenciosa que nadie pidió.
   */
  const columnAt = useCallback((clientX: number): string | null => {
    let nearest: string | null = null;
    let nearestDistance = Infinity;
    const entries = Array.from(columnRefs.current.entries());
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i][0];
      const rect = entries[i][1].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return id;
      const distance =
        clientX < rect.left ? rect.left - clientX : clientX - rect.right;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = id;
      }
    }
    return nearest;
  }, []);

  const byColumn = useMemo(() => {
    const map = new Map<string, { visit: RealtyVisitCardDTO; minute: number }[]>();
    for (let i = 0; i < columns.length; i++) map.set(columns[i].id, []);
    for (let i = 0; i < placed.length; i++) {
      const bucket = map.get(placed[i].columnId);
      if (bucket) bucket.push({ visit: placed[i].visit, minute: placed[i].minute });
    }
    return map;
  }, [columns, placed]);

  function startDrag(e: React.PointerEvent, item: { visit: RealtyVisitCardDTO; minute: number }, columnId: string) {
    justDragged.current = false;
    if (!canDrag || !isVisitMovable(item.visit.status)) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      visitId: item.visit.id,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      active: false,
      minute: item.minute,
      columnId,
    });
  }

  function moveDrag(e: React.PointerEvent, item: { visit: RealtyVisitCardDTO; minute: number }) {
    const current = dragRef.current;
    if (!current || current.visitId !== item.visit.id) return;
    const dx = e.clientX - current.originX;
    const dy = e.clientY - current.originY;
    // Umbral de 4 px: un clic tembloroso no debe contar como arrastre.
    if (!current.active && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;
    const minute = Math.max(
      0,
      Math.min(24 * 60 - REALTY_SLOT_MINUTES, snapMinute(item.minute + dy / PX, REALTY_SLOT_MINUTES)),
    );
    setDrag({
      ...current,
      active: true,
      minute,
      columnId: columnAt(e.clientX) ?? current.columnId,
    });
  }

  function endDrag(e: React.PointerEvent, item: { visit: RealtyVisitCardDTO; minute: number }, columnId: string) {
    const current = dragRef.current;
    setDrag(null);
    if (!current || current.visitId !== item.visit.id) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(current.pointerId);
    } catch {
      /* el navegador ya lo soltó */
    }
    if (!current.active) return; // fue un toque: lo atiende onClick
    justDragged.current = true;
    const movedTime = Math.abs(current.minute - item.minute) >= 1;
    const movedColumn = current.columnId !== columnId;
    if (!movedTime && !movedColumn) return;
    onDrop({ visit: item.visit, columnId: current.columnId, minute: current.minute });
  }

  return (
    <div className={css.board}>
      <div className={css.scroller}>
        <div
          className={css.grid}
          style={{ gridTemplateColumns: `54px repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}
        >
          <div className={css.headCorner} style={{ height: 40 }} />
          {columns.map((col) => (
            <div
              key={`h-${col.id}`}
              className={col.isToday ? `${css.headCell} ${css.headToday}` : css.headCell}
              style={{ height: 40 }}
            >
              <div className={css.headLabel}>{col.label}</div>
              {col.meta ? <div className={css.headMeta}>{col.meta}</div> : null}
            </div>
          ))}

          <div className={css.gutter} style={{ height }}>
            {hourMarks.map((m) => (
              <span key={`g-${m}`} className={css.gutterMark} style={{ top: yOf(m) }}>
                {minuteToLabel(m)}
              </span>
            ))}
          </div>

          {columns.map((col) => {
            const items = byColumn.get(col.id) ?? [];
            const lanes = assignVisitLanes(items.map((i) => i.minute));
            const isDropTarget = drag !== null && drag.active && drag.columnId === col.id;
            return (
              <div
                key={col.id}
                ref={(node) => {
                  if (node) columnRefs.current.set(col.id, node);
                  else columnRefs.current.delete(col.id);
                }}
                className={isDropTarget ? `${css.column} ${css.columnDrop}` : css.column}
                style={{ height }}
              >
                {hourMarks.map((m) =>
                  m < bounds.end ? (
                    <div
                      key={`hb-${m}`}
                      className={css.halfBand}
                      style={{ top: yOf(m + 30), height: 30 * PX }}
                    />
                  ) : null,
                )}
                {hourMarks.map((m) => (
                  <div key={`hl-${m}`} className={css.hourLine} style={{ top: yOf(m) }} />
                ))}

                {col.isToday && nowMinute >= bounds.start && nowMinute <= bounds.end ? (
                  <div className={css.nowLine} style={{ top: yOf(nowMinute) }} aria-hidden="true">
                    <span className={css.nowDot} />
                  </div>
                ) : null}

                {items.map((item, idx) => {
                  const lane = lanes[idx] ?? { lane: 0, laneCount: 1 };
                  const width = 100 / lane.laneCount;
                  const dragging = drag !== null && drag.active && drag.visitId === item.visit.id;
                  const past = new Date(item.visit.scheduledAt).getTime() < now;
                  const movable = canDrag && isVisitMovable(item.visit.status);
                  const classes = [css.card];
                  if (movable) classes.push(css.cardDraggable);
                  if (dragging) classes.push(css.cardDragging);
                  if (past) classes.push(css.cardPast);
                  return (
                    <button
                      key={item.visit.id}
                      type="button"
                      data-status={item.visit.status}
                      className={classes.join(" ")}
                      style={{
                        top: yOf(item.minute),
                        height: Math.max(
                          REALTY_CARD_MIN_PX,
                          (Math.min(bounds.end, item.minute + REALTY_VISIT_BLOCK_MIN) -
                            Math.max(bounds.start, item.minute)) *
                            PX,
                        ),
                        left: `calc(${lane.lane * width}% + 3px)`,
                        width: `calc(${width}% - 6px)`,
                      }}
                      aria-label={t("card.aria", {
                        time: minuteToLabel(item.minute),
                        property: item.visit.propertyTitle,
                      })}
                      onPointerDown={(e) => startDrag(e, item, col.id)}
                      onPointerMove={(e) => moveDrag(e, item)}
                      onPointerUp={(e) => endDrag(e, item, col.id)}
                      onPointerCancel={() => setDrag(null)}
                      onClick={() => {
                        if (justDragged.current) {
                          justDragged.current = false;
                          return;
                        }
                        onOpen(item.visit);
                      }}
                    >
                      <span className={css.cardTime}>{minuteToLabel(item.minute)}</span>
                      <span className={css.cardName}>{item.visit.propertyTitle}</span>
                      <span className={css.cardMeta}>
                        {item.visit.leadName
                          ? t("card.with", { name: item.visit.leadName })
                          : t("card.noLead")}
                      </span>
                    </button>
                  );
                })}

                {isDropTarget ? (
                  <div
                    className={css.ghost}
                    style={{
                      top: yOf(drag.minute),
                      height: Math.max(REALTY_CARD_MIN_PX, REALTY_VISIT_BLOCK_MIN * PX),
                      left: 3,
                      right: 3,
                    }}
                  >
                    {minuteToLabel(drag.minute)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
