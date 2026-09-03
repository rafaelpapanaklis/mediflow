"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { eduAgendaSlotAtY, eduAgendaSlotLabel } from "@/lib/edu/agenda-rejilla";

/**
 * LA GUÍA DE HORARIO — dónde está el puntero, dicho con la hora escrita.
 *
 * Con doce sillones abiertos (o los siete días de la semana), el eje de
 * horas queda a media pantalla del hueco donde se va a hacer click: quien
 * agenda no sabe si le está atinando a las 12:15 o a las 12:30, y la cita
 * sale a la hora equivocada. Mientras el cursor recorre la rejilla se
 * marcan tres cosas a la vez, todas en el MISMO renglón que abriría el
 * click:
 *
 *   · la FILA completa, que ata el punto donde está el dedo con el eje;
 *   · la CELDA exacta, con su hora escrita dentro;
 *   · la hora sobre el EJE, resaltada y con fondo opaco.
 *
 * Es la misma guía que la agenda del dental estrenó en la vista Día
 * (`src/components/dashboard/agenda/agenda-hover-guide.tsx`), traída al
 * vertical con sus dos diferencias: aquí sirve para las dos vistas —Día y
 * Semana— y aquí la celda tiene DOS lecturas, porque en Semana el click no
 * agenda (ver `hueco`).
 *
 * ── POR QUÉ EL ESTADO VIVE AQUÍ Y NO EN CADA COLUMNA ───────────────────
 * Las columnas traen las citas. Si el renglón resaltado fuera estado suyo,
 * mover el mouse re-renderearía doce columnas con todas sus tarjetas en
 * cada cruce de renglón. Aquí arriba, las columnas llegan como `children`
 * —el mismo elemento de siempre— y React se salta su subárbol entero: solo
 * se vuelven a pintar esta capa y el eje, que lee la hora por contexto.
 *
 * Y el estado solo cambia cuando el cursor CRUZA de renglón o de columna,
 * no en cada píxel.
 */

export interface EduAgendaHover {
  /** Renglón de 15 min desde el techo de la ventana pintada. */
  slot: number;
  /** Columna, contada desde la primera (el eje no cuenta). */
  col: number;
  /** "12:15" — lo que va a recibir el alta si se hace click. */
  label: string;
  /**
   * ¿Ese click ABRE algo? En Día sobre un sillón real, sí. En Semana no
   * —la columna es un día y el alta necesita un sillón—, y tampoco sin
   * permiso ni sobre "Otros sillones". Cuando es `false` la celda se pinta
   * como lo que es, una lectura de la hora, y NO como el borrador de una
   * cita: prometer un hueco que no se va a abrir es peor que no marcar
   * nada.
   */
  hueco: boolean;
}

/* En un contexto —y no en props— para que el eje de horas lea la hora sin
   que la rejilla entera tenga que re-renderearse para pasársela. */
const HoverCtx = createContext<EduAgendaHover | null>(null);

export function useEduAgendaHover(): EduAgendaHover | null {
  return useContext(HoverCtx);
}

export function EduAgendaGuia({
  slots,
  window: ventana,
  columnCount,
  children,
}: {
  /** Renglones de la ventana pintada (`eduAgendaSlots`). */
  slots: number;
  window: { dayStart: number; dayEnd: number };
  /** Columnas pintadas. Todas miden igual: mismo `flex` y mismo `min-width`. */
  columnCount: number;
  /** El eje de horas y las columnas, tal cual los monta la rejilla. */
  children: ReactNode;
}) {
  const filaRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<EduAgendaHover | null>(null);

  const limpiar = useCallback(() => {
    setHover((prev) => (prev === null ? prev : null));
  }, []);

  const alMover = useCallback(
    (e: React.MouseEvent) => {
      const destino = e.target as HTMLElement;
      // Sobre una tarjeta el click abre ESA cita, no marca un hueco.
      if (destino.closest(".edu-ag__cita")) return limpiar();
      // Botón apretado = se está arrastrando una cita; manda el arrastre,
      // que ya pinta su propio destino y su propia hora.
      if (e.buttons !== 0) return limpiar();
      // El eje de horas está dentro de la misma fila y también dispara
      // `mousemove`: ahí no hay renglón que marcar.
      const col = destino.closest<HTMLElement>(".edu-ag__col");
      const fila = filaRef.current;
      if (!col || !fila) return limpiar();

      const caja = col.getBoundingClientRect();
      if (caja.height <= 0) return limpiar();

      const slot = eduAgendaSlotAtY(e.clientY - caja.top, caja.height, slots);
      const i = Number(col.dataset.eduCol ?? "-1");
      if (!Number.isInteger(i) || i < 0) return limpiar();
      const hueco = col.dataset.eduHueco === "1";

      setHover((prev) =>
        prev && prev.slot === slot && prev.col === i && prev.hueco === hueco
          ? prev
          : { slot, col: i, hueco, label: eduAgendaSlotLabel(slot, ventana) },
      );
    },
    [limpiar, slots, ventana],
  );

  /* 🔴 AL DESPLAZARSE, LA GUÍA MIENTE SI NO SE BORRA. La marca se coloca en
     coordenadas de la REJILLA (`renglón * --edu-ag-slot-h`), así que al
     rodar la rueda se queda pegada a su renglón mientras el cursor —que no
     se movió— pasa a señalar otro. El siguiente click usa la posición real
     y agenda en un renglón distinto al marcado, que es justamente el fallo
     que esta guía existe para evitar. No hay `mousemove` garantizado
     después de un desplazamiento, así que se borra y vuelve al primer
     movimiento. */
  useEffect(() => {
    const caja = filaRef.current?.closest(".edu-ag__scroll");
    if (!caja) return;
    caja.addEventListener("scroll", limpiar, { passive: true });
    return () => caja.removeEventListener("scroll", limpiar);
  }, [limpiar]);

  // El ancho de una columna: lo que queda de la fila después del eje,
  // repartido entre todas. En CSS y no en píxeles medidos, para que siga
  // siendo cierto si la ventana cambia de tamaño con la marca puesta.
  const anchoCol = `((100% - var(--edu-ag-eje-w)) / ${Math.max(1, columnCount)})`;

  return (
    <HoverCtx.Provider value={hover}>
      <div className="edu-ag__fila" ref={filaRef} onMouseMove={alMover} onMouseLeave={limpiar}>
        {children}
        {hover && (
          <>
            <div
              className="edu-ag__guiafila"
              aria-hidden="true"
              style={{ top: `calc(${hover.slot} * var(--edu-ag-slot-h))` }}
            />
            <div
              className={`edu-ag__guiaceld${hover.hueco ? " edu-ag__guiaceld--hueco" : ""}`}
              aria-hidden="true"
              style={{
                top: `calc(${hover.slot} * var(--edu-ag-slot-h))`,
                left: `calc(var(--edu-ag-eje-w) + ${anchoCol} * ${hover.col})`,
                width: `calc(${anchoCol})`,
              }}
            >
              {hover.label}
            </div>
          </>
        )}
      </div>
    </HoverCtx.Provider>
  );
}
