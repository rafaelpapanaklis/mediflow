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

import type { ReactNode, Ref } from "react";
import { comoHora, topDeHora, topDeLinea, type VentanaRejilla } from "@/lib/agenda-nueva/geometria";
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
}: CuadriculaProps) {
  const { minutoInicio, horaFin, alto } = ventana;

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
      {/* Dos scrollers anidados, y el orden importa:
          · el de FUERA da el desplazamiento HORIZONTAL y envuelve al
            encabezado y al cuerpo, para que la cabecera de una columna viaje
            pegada a su columna al desplazar (con `anchoMinimoColumna`);
          · el de DENTRO da solo el VERTICAL, y deja el encabezado fijo arriba.
          El encabezado no puede ir con `position: sticky` dentro del scroller
          vertical: Chrome lo clampea al área de la rejilla. Misma lección que
          ya estaba aprendida en la agenda de siempre. */}
      <div className={s.rejillaScrollH}>
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

      <div className={s.rejillaScroll} ref={refDesplazamiento}>
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
            <div
              key={c.clave}
              className={`${s.columna} ${c.cerrada ? s.columnaCerrada : ""}`}
              style={c.fondo && !c.cerrada ? { backgroundColor: c.fondo } : undefined}
              data-columna={c.clave}
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

              {c.contenido}

              {!c.cerrada && c.vacia && <div className={s.columnaVacia}>{c.vacia}</div>}
            </div>
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
