"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useAgenda } from "./agenda-provider";
import { HoverSlotContext, type HoverSlot } from "./agenda-hover-slot-context";
import { AgendaTimeAxis } from "./agenda-time-axis";
import {
  columnFromOffsetX,
  slotFromOffsetY,
  slotStartLabel,
} from "@/lib/agenda/hover-slot";
import styles from "./agenda.module.css";

/**
 * Guía de horario de la vista Día.
 *
 * Con varias columnas de doctor abiertas, la regla de horas queda a dos
 * o tres columnas de distancia del hueco donde se hace click: agendar se
 * vuelve un ejercicio de puntería. Mientras el cursor recorre la grilla
 * marcamos tres cosas a la vez, todas en el MISMO slot que crearía el
 * click: la fila completa (ata el punto con la regla), la celda exacta
 * con su hora escrita al lado del cursor, y la hora resaltada sobre la
 * regla.
 *
 * El estado vive aquí arriba y NO en cada columna: las columnas no se
 * re-renderean al mover el mouse (traen las citas), solo esta capa y la
 * regla. Además solo cambia cuando el cursor cruza de slot o de columna,
 * no en cada píxel.
 */

/** Lo que se resalta: el slot, la columna y el ancho REAL de esa columna. */
interface HoverGeom extends HoverSlot {
  colW: number;
}

export function AgendaHoverGuide({
  columnCount,
  children,
}: {
  columnCount: number;
  children: ReactNode;
}) {
  const { state, permissions, slotHpx } = useAgenda();
  const colsRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverGeom | null>(null);

  const clear = useCallback(() => {
    setHover((prev) => (prev === null ? prev : null));
  }, []);

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      // Sin permiso de crear, el click en hueco no hace nada: prometer un
      // slot que no se va a abrir sería peor que no marcar nada (P1-3).
      if (!permissions.canCreate) return clear();
      // Botón apretado = se está arrastrando una cita; manda el drop.
      if (e.buttons !== 0) return clear();
      // Sobre una cita el click abre ESA cita, no crea una nueva.
      if ((e.target as HTMLElement).closest(`.${styles.appt}`)) return clear();

      const el = colsRef.current;
      if (!el) return clear();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // La regla de horas también dispara mousemove: ahí no hay slot.
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return clear();

      const slot = slotFromOffsetY(y, slotHpx, rect.height);
      // Ancho que ocupan las columnas DE VERDAD. Los tracks son
      // minmax(160px, 1fr): cuando la grilla no cabe se quedan en su
      // mínimo y DESBORDAN la caja, así que rect.width mide menos que
      // las columnas y el reparto marcaría la de al lado (medido en la
      // semana: caja 979px contra 1120px de columnas a 1280 con la barra
      // lateral abierta). scrollWidth sí abarca los tracks enteros, y con
      // la grilla holgada vale exactamente lo mismo.
      const spanW = Math.max(rect.width, el.scrollWidth);
      const col = columnFromOffsetX(x, spanW, columnCount);
      const colW = spanW / columnCount;
      setHover((prev) =>
        prev && prev.slot === slot && prev.col === col && prev.colW === colW
          ? prev
          : { slot, col, colW },
      );
    },
    [clear, columnCount, permissions.canCreate, slotHpx],
  );

  const slotH = "var(--mf-agenda-slot-h)";

  return (
    <HoverSlotContext.Provider value={hover}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "var(--mf-agenda-axis-w) minmax(0, 1fr)",
        }}
        onMouseMove={handleMove}
        onMouseLeave={clear}
      >
        <AgendaTimeAxis />
        <div ref={colsRef} className={styles.columnsBody}>
          {children}
          {hover && (
            <>
              <div
                className={styles.hoverRow}
                style={{ top: `calc(${hover.slot} * ${slotH})` }}
                aria-hidden
              />
              <div
                className={styles.hoverCell}
                style={{
                  top: `calc(${hover.slot} * ${slotH})`,
                  left: `${hover.col * hover.colW}px`,
                  width: `${hover.colW}px`,
                }}
                aria-hidden
              >
                {slotStartLabel(hover.slot, state.dayStart, state.slotMinutes)}
              </div>
            </>
          )}
        </div>
      </div>
    </HoverSlotContext.Provider>
  );
}
