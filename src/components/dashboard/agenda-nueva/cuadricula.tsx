"use client";

/**
 * La cuadrícula de la agenda nueva — COMPARTIDA por Día (ws1-t1) y Semana
 * (ws1-t2).
 *
 * Pinta el eje de horas, las líneas de hora y media hora, las franjas a rayas
 * de antes de abrir y después de cerrar, y la línea de «ahora». Lo que va
 * DENTRO de cada columna (las tarjetas de cita) lo pone quien la usa: en Día
 * una columna es un responsable, en Semana es un día. La cuadrícula no sabe
 * ni le importa.
 *
 * Dos decisiones que conviene conocer antes de tocarla:
 *
 *  · **La franja de cierre es POR COLUMNA**, no del lienzo entero. En Semana
 *    cada columna es un día distinto y el horario cambia por día (el sábado
 *    cierra antes); con un solo número, o el sábado queda sin rayar o el
 *    resto queda rayado de más.
 *  · **Las líneas son un gradiente, no nodos.** 12 horas × 7 columnas serían
 *    170 divs que no hacen nada; `background-image` con `background-size`
 *    100% / 112 px las dibuja gratis. Va en el CSS (`.columna`).
 */

import { useCallback, useRef, useState, type ReactNode, type Ref } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { DroppableData } from "@/lib/agenda/drag-utils";
import { comoHora, topDeHora, topDeLinea, type VentanaRejilla } from "@/lib/agenda-nueva/geometria";
import { aceptaClic, altoDeHueco, carrilDeClic, inicioDeClic } from "@/lib/agenda-nueva/interacciones";
import { ANCHO_EJE } from "@/lib/agenda-nueva/tokens";
import s from "./agenda-nueva.module.css";

export interface ColumnaCuadricula {
  /** Identificador estable (id del responsable en Día, `YYYY-MM-DD` en Semana). */
  clave: string;
  /** Lo que va en el encabezado de esta columna. */
  encabezado?: ReactNode;
  /** Lo que va dentro del lienzo: las tarjetas, posicionadas en absoluto. */
  contenido: ReactNode;
  /** Fondo de la columna (p. ej. el tinte de «hoy» en Semana). */
  fondo?: string;
  /** Minutos desde 00:00 en que cierra: de ahí al final del lienzo va rayado. */
  cierreDesdeMin?: number | null;
  /** Minutos desde 00:00 en que abre: del inicio del lienzo hasta ahí, rayado. */
  aperturaHastaMin?: number | null;
  /** Día cerrado entero: rayas de arriba abajo y el rótulo «Cerrado». */
  cerrada?: boolean;
  /** Texto centrado cuando la columna no tiene ni una cita. */
  vacia?: string | null;
  /**
   * Soltar citas aquí. El `data` es el MISMO que usan las columnas de la
   * agenda de siempre y dice qué cambia al soltar: el doctor (Día) o el día
   * (Semana). Sin esto la columna no recibe citas.
   */
  soltable?: { id: string; data: DroppableData };
  /**
   * Agendar con un clic en un hueco libre. Llega la hora ya redondeada al paso
   * de la clínica y la fracción horizontal del clic (Semana la usa para saber
   * de qué responsable es el carril). Sin esto la columna no acepta clics.
   */
  alPulsarHueco?: (hueco: { inicioMin: number; fraccionX: number }) => void;
  /** En cuántos carriles se reparte la columna (Semana), para marcar el del cursor. */
  carriles?: number;
  /** Encima de las tarjetas: la sombra de la cita que se está arrastrando. */
  superpuesto?: ReactNode;
}

export interface CuadriculaProps {
  ventana: VentanaRejilla;
  columnas: ColumnaCuadricula[];
  /** Alto del encabezado: 60 en Día, 52 en Semana. */
  altoEncabezado: number;
  /**
   * Minutos locales de «ahora», o `null` si no hay que pintar la línea
   * (porque el día que se mira no es hoy). Lo decide `minutosDeAhora`, que
   * compara EN LA ZONA DE LA CLÍNICA — en Vercel el proceso corre en UTC y
   * esto ya nos mordió antes.
   */
  ahoraMin: number | null;
  /**
   * Clave de la columna sobre la que va la línea de «ahora». `null` = a lo
   * ancho de todas (el caso de Día). En Semana es la columna de hoy.
   */
  columnaAhora?: string | null;
  /** Texto que sale cuando no queda ninguna columna visible. */
  sinColumnas?: string;
  /**
   * Ancho mínimo por columna, en px. Cuando las columnas no caben, el lienzo
   * deja de encogerlas y se DESPLAZA en horizontal — es lo que pide el README
   * («en pantallas pequeñas la cuadrícula se desplaza»).
   *
   * Lo necesita Semana: 7 días × N responsables son 7N carriles, y a 1024 px
   * cada uno se queda en ~34 px, donde un nombre de paciente es una raya. Día
   * no lo usa: tres columnas caben de sobra.
   */
  anchoMinimoColumna?: number;
  refDesplazamiento?: Ref<HTMLDivElement>;
  /**
   * El paso de la clínica en minutos (`Clinic.defaultSlotMinutes`): a él se
   * redondea la hora de un clic y mide el hueco que se marca bajo el cursor.
   */
  slotMinutes?: number;
}

export function Cuadricula({
  ventana,
  columnas,
  altoEncabezado,
  ahoraMin,
  columnaAhora = null,
  sinColumnas = "Ningún doctor ni unidad seleccionada",
  anchoMinimoColumna,
  refDesplazamiento,
  slotMinutes = 30,
}: CuadriculaProps) {
  const { minutoInicio, horaFin, alto } = ventana;

  // La cabecera sigue al cuerpo en horizontal. El cuerpo es el ÚNICO scroller
  // (los dos ejes) y la cabecera vive en un marco sin barras cuyo
  // `scrollLeft` se copia del cuerpo. Antes eran dos scrollers anidados (el de
  // fuera horizontal, el de dentro vertical) y el de dentro medía solo lo
  // visible: al desplazar la Semana en horizontal, la cabecera avanzaba y el
  // cuerpo se quedaba EN BLANCO (medido a 1024 y a 1440 con tres doctores, ya
  // en la base). Y al arrastrar una cita hacia el borde, dnd-kit desplazaba el
  // de dentro y descuadraba cabecera y cuerpo.
  const refCabecera = useRef<HTMLDivElement | null>(null);
  const alDesplazarCuerpo = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const marco = refCabecera.current;
    if (marco && marco.scrollLeft !== e.currentTarget.scrollLeft) {
      marco.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  // Índice de la columna de «ahora», para poder acotar la línea a su tramo.
  const idxAhora =
    columnaAhora === null ? -1 : columnas.findIndex((c) => c.clave === columnaAhora);
  const pintaAhora = ahoraMin !== null && (columnaAhora === null || idxAhora >= 0);
  const topAhora = ahoraMin === null ? 0 : topDeLinea(ahoraMin, minutoInicio);

  // La línea va a lo ancho de todas las columnas (Día) o solo de una (Semana).
  // Se calcula en porcentaje del ancho útil, que es el lienzo menos el eje.
  const nCols = Math.max(1, columnas.length);
  const anchoCol = 100 / nCols;

  // El mínimo va en el lienzo Y en el encabezado, los dos: si solo lo llevara
  // uno, al desplazar en horizontal la cabecera se despegaría de su columna.
  const anchoMinimo = anchoMinimoColumna
    ? ANCHO_EJE + columnas.length * anchoMinimoColumna
    : undefined;
  const estiloMinimo = anchoMinimo ? { minWidth: anchoMinimo } : undefined;
  const estiloLinea =
    columnaAhora === null
      ? { left: `${ANCHO_EJE}px`, right: 0 }
      : {
          left: `calc(${ANCHO_EJE}px + (100% - ${ANCHO_EJE}px) * ${(idxAhora * anchoCol) / 100})`,
          width: `calc((100% - ${ANCHO_EJE}px) * ${anchoCol / 100})`,
        };

  return (
    <div className={s.rejilla}>
      {/* Un solo scroller, el cuerpo, en los dos ejes; la cabecera fuera de
          él, en un marco que copia su desplazamiento horizontal
          (`alDesplazarCuerpo`). El encabezado no puede ir con
          `position: sticky` dentro del scroller: Chrome lo clampea al área de
          la rejilla. Misma lección que ya estaba aprendida en la agenda de
          siempre. */}
      <div className={s.rejillaScrollH}>
      <div className={s.rejillaEncabezadoMarco} ref={refCabecera}>
      <div className={s.rejillaEncabezado} style={{ height: altoEncabezado, ...estiloMinimo }}>
        <div className={s.rejillaEsquina} />
        {columnas.map((c) => (
          <div
            key={c.clave}
            className={s.rejillaEncabezadoCol}
            style={c.fondo ? { background: c.fondo } : undefined}
          >
            {c.encabezado}
          </div>
        ))}
      </div>
      </div>

      <div className={s.rejillaScroll} ref={refDesplazamiento} onScroll={alDesplazarCuerpo}>
        <div className={s.rejillaLienzo} style={{ height: alto, ...estiloMinimo }}>
          {/* ── Eje de horas ── */}
          <div className={s.eje}>
            {ventana.horas.map((h) => (
              <span key={h} className={s.ejeHora} style={{ top: topDeHora(h, minutoInicio) }}>
                {comoHora(h * 60)}
              </span>
            ))}
            {/* «CIERRE» bajo la hora de cierre más temprana que se rayó. El
                diseño lo pone 22 px por debajo de la línea de las 18:00. */}
            {rotuloCierre(columnas, minutoInicio, horaFin)}
            {pintaAhora && ahoraMin !== null && (
              <span className={s.ejeAhora} style={{ top: topAhora - 8 }}>
                {comoHora(ahoraMin)}
              </span>
            )}
          </div>

          {/* ── Columnas ── */}
          {columnas.map((c) => (
            <ColumnaRejilla key={c.clave} columna={c} ventana={ventana} slotMinutes={slotMinutes} />
          ))}

          {columnas.length === 0 && <div className={s.sinColumnas}>{sinColumnas}</div>}

          {/* ── Línea de «ahora» ── */}
          {pintaAhora && columnas.length > 0 && (
            <>
              <div className={s.lineaAhora} style={{ ...estiloLinea, top: topAhora }} />
              <div
                className={s.puntoAhora}
                style={{
                  left:
                    columnaAhora === null
                      ? ANCHO_EJE - 5
                      : `calc(${ANCHO_EJE}px + (100% - ${ANCHO_EJE}px) * ${
                          (idxAhora * anchoCol) / 100
                        } - 5px)`,
                  top: topAhora - 4,
                }}
              />
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Una columna del lienzo: sus franjas rayadas, sus tarjetas, y las dos cosas
 * que se hacen con el ratón sobre ella — agendar con un clic en un hueco libre
 * y soltar una cita que se viene arrastrando.
 *
 * El clic sigue el criterio de la agenda de siempre (`AgendaColumn`): la hora
 * del hueco en el que cae, redondeada hacia abajo al paso de la clínica, y
 * nada si cae sobre una cita (la tarjeta abre su panel). Además, lo que el
 * diseño pinta a rayas —antes de abrir, desde el cierre, el día cerrado— no
 * acepta clics.
 *
 * Mientras el cursor recorre la columna se marca el hueco que crearía el clic,
 * con su hora: la misma cuenta que el clic, para que la marca nunca prometa
 * una hora distinta de la que se abre (la lección de `hover-slot.ts`). El
 * estado de esa marca vive aquí, por columna: moverse no vuelve a pintar las
 * tarjetas, que llegan ya hechas en `columna.contenido`.
 */
function ColumnaRejilla({
  columna: c,
  ventana,
  slotMinutes,
}: {
  columna: ColumnaCuadricula;
  ventana: VentanaRejilla;
  slotMinutes: number;
}) {
  const { minutoInicio, horaFin } = ventana;
  const ref = useRef<HTMLDivElement | null>(null);
  const [guia, setGuia] = useState<{ inicioMin: number; carril: number } | null>(null);
  // Un clic que EMPIEZA sobre una cita y termina en el hueco (se escurrió el
  // ratón, o se soltó tarde tras cancelar un arrastre con Esc) no crea otra: el
  // navegador le manda ese clic a la columna, que es el antepasado común.
  const empezoEnCita = useRef(false);

  const { setNodeRef } = useDroppable({
    id: c.soltable?.id ?? `sin-soltar:${c.clave}`,
    data: c.soltable?.data,
    disabled: !c.soltable,
  });
  const refs = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );

  const alPulsar = c.alPulsarHueco;
  const carriles = Math.max(1, c.carriles ?? 1);

  /** El hueco bajo el puntero, o `null` si ahí no se agenda. */
  const huecoBajo = useCallback(
    (e: React.MouseEvent): { inicioMin: number; fraccionX: number } | null => {
      if (!alPulsar || c.cerrada) return null;
      // Sobre una tarjeta el clic abre ESA cita, no crea otra.
      if ((e.target as HTMLElement).closest("[data-cita]")) return null;
      const el = ref.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      const inicioMin = inicioDeClic({ y, altoLienzo: rect.height, slotMinutes, minutoInicio });
      // El colchón bajo la última hora no es un hueco de agenda.
      if (inicioMin >= horaFin * 60) return null;
      if (!aceptaClic(inicioMin, c)) return null;
      return { inicioMin, fraccionX: rect.width > 0 ? x / rect.width : 0 };
    },
    [alPulsar, c, slotMinutes, minutoInicio, horaFin],
  );

  const alMover = useCallback(
    (e: React.MouseEvent) => {
      // Con un botón apretado se está arrastrando una cita: manda el soltar.
      const h = e.buttons === 0 ? huecoBajo(e) : null;
      const carril = h ? carrilDeClic(h.fraccionX, carriles) : 0;
      setGuia((prev) => {
        if (!h) return prev === null ? prev : null;
        if (prev && prev.inicioMin === h.inicioMin && prev.carril === carril) return prev;
        return { inicioMin: h.inicioMin, carril };
      });
    },
    [huecoBajo, carriles],
  );

  const alSalir = useCallback(() => setGuia(null), []);

  const alApretar = useCallback((e: React.PointerEvent) => {
    empezoEnCita.current = !!(e.target as HTMLElement).closest("[data-cita]");
  }, []);

  const alHacerClic = useCallback(
    (e: React.MouseEvent) => {
      if (empezoEnCita.current) {
        empezoEnCita.current = false;
        return;
      }
      const h = huecoBajo(e);
      if (!h || !alPulsar) return;
      setGuia(null);
      alPulsar(h);
    },
    [huecoBajo, alPulsar],
  );

  const clases = [
    s.columna,
    c.cerrada ? s.columnaCerrada : "",
    guia ? s.columnaConGuia : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={refs}
      className={clases}
      style={c.fondo && !c.cerrada ? { backgroundColor: c.fondo } : undefined}
      data-columna={c.clave}
      onMouseMove={alPulsar ? alMover : undefined}
      onMouseLeave={alPulsar ? alSalir : undefined}
      onPointerDown={alPulsar ? alApretar : undefined}
      onClick={alPulsar ? alHacerClic : undefined}
    >
      {/* Antes de abrir */}
      {!c.cerrada && typeof c.aperturaHastaMin === "number" && c.aperturaHastaMin > minutoInicio && (
        <div
          className={s.franjaCierre}
          style={{ top: 0, height: topDeLinea(c.aperturaHastaMin, minutoInicio) }}
        />
      )}
      {/* Después de cerrar */}
      {!c.cerrada && typeof c.cierreDesdeMin === "number" && c.cierreDesdeMin < horaFin * 60 && (
        <div
          className={s.franjaCierre}
          style={{ top: topDeLinea(c.cierreDesdeMin, minutoInicio), bottom: 0 }}
        />
      )}
      {/* Día cerrado entero */}
      {c.cerrada && (
        <>
          <div className={s.franjaCierre} style={{ top: 0, bottom: 0 }} />
          <div className={s.rotuloCerrada}>Cerrado</div>
        </>
      )}

      {/* El hueco que crearía el clic, con su hora. Debajo de las tarjetas. */}
      {guia && (
        <div
          className={s.guiaHueco}
          style={{
            top: topDeLinea(guia.inicioMin, minutoInicio),
            height: altoDeHueco(slotMinutes),
            left: `calc(${(guia.carril / carriles) * 100}% + ${carriles > 1 ? 2 : 8}px)`,
            width: `calc(${100 / carriles}% - ${carriles > 1 ? 4 : 16}px)`,
          }}
          aria-hidden
        >
          <span className={s.guiaHuecoHora}>{comoHora(guia.inicioMin)}</span>
        </div>
      )}

      {c.contenido}

      {!c.cerrada && c.vacia && !guia && <div className={s.columnaVacia}>{c.vacia}</div>}

      {c.superpuesto}
    </div>
  );
}

/**
 * El rótulo «CIERRE» del eje. Se coloca bajo la hora de cierre más TEMPRANA
 * de las columnas visibles: en Día solo hay una, y en Semana marca el primer
 * momento en que alguna columna deja de atender, que es lo que el ojo busca.
 * Si ninguna columna cierra dentro del lienzo, no se pinta.
 */
function rotuloCierre(
  columnas: ColumnaCuadricula[],
  minutoInicio: number,
  horaFin: number,
): ReactNode {
  let masTemprano: number | null = null;
  for (const c of columnas) {
    if (c.cerrada) continue;
    const cierre = c.cierreDesdeMin;
    if (typeof cierre !== "number") continue;
    if (cierre >= horaFin * 60) continue;
    if (masTemprano === null || cierre < masTemprano) masTemprano = cierre;
  }
  if (masTemprano === null) return null;
  return (
    <span className={s.ejeCierre} style={{ top: topDeLinea(masTemprano, minutoInicio) + 22 }}>
      Cierre
    </span>
  );
}
