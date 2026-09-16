"use client";

/**
 * La tarjeta de cita — COMPARTIDA por Día (ws1-t1) y Semana (ws1-t2).
 *
 * Dos variantes, las dos del README:
 *  · `"dia"`    — nombre + horario + chip de estado, y una segunda línea con
 *                 «Tratamiento · detalle» que desaparece si la cita es corta.
 *  · `"semana"` — compacta: nombre + ícono de estado, y «11:00 · Resina».
 *
 * La tarjeta NO decide dónde va. El `top`/`alto` salen de la aritmética
 * (`geometria.ts`) y el carril (`left`/`width`) lo calcula quien la coloca:
 * en Día, `assignLanes` + `carrilDeCita`; en Semana, un carril por responsable
 * dentro del día. Así una sola tarjeta sirve para las dos rejillas.
 *
 * Los colores salen de `pinta` (el mapa exhaustivo de los nueve estados), y la
 * barra izquierda de 3 px es el color del responsable. Ni un hex aquí dentro.
 */

import { Armchair, Ban, Check, Circle, Clock, UserX } from "lucide-react";
import type { IconoEstado } from "@/lib/agenda-nueva/estados";
import type { CitaVista } from "@/lib/agenda-nueva/vista-modelo";
import { AGENDA_SOMBRAS } from "@/lib/agenda-nueva/tokens";
import s from "./agenda-nueva.module.css";

/** Debajo de esto la segunda línea no cabe: el README la oculta bajo 30 min. */
const MINUTOS_SIN_SEGUNDA_LINEA = 30;

export interface GeometriaTarjeta {
  top: number;
  alto: number;
  left: string;
  width: string;
  /**
   * Cuántas citas se reparten el ancho aquí (1 = la tarjeta va entera).
   * Con dos o más, la tarjeta se queda sin sitio para el horario y la segunda
   * línea, así que los esconde. Va como número y no deducido del `width`:
   * adivinarlo leyendo la cadena CSS es justo el tipo de cosa que se rompe
   * sola el día que alguien cambia el cálculo del carril.
   */
  carriles?: number;
}

export interface TarjetaCitaProps {
  cita: CitaVista;
  variante: "dia" | "semana";
  geometria: GeometriaTarjeta;
  seleccionada?: boolean;
  onAbrir?: (id: string) => void;
}

export function TarjetaCita({
  cita,
  variante,
  geometria,
  seleccionada = false,
  onAbrir,
}: TarjetaCitaProps) {
  const { pinta } = cita;

  // El borde de 3 px del responsable es un `inset box-shadow`, como el diseño;
  // el anillo de selección se le SUMA (no lo sustituye) para que una cita
  // abierta siga enseñando de quién es.
  const sombra = [
    `inset 3px 0 0 ${cita.colorResponsable}`,
    seleccionada ? AGENDA_SOMBRAS.seleccion : null,
  ]
    .filter(Boolean)
    .join(", ");

  const corta = cita.duracionMin < MINUTOS_SIN_SEGUNDA_LINEA;
  // Con la tarjeta partida en carriles no cabe la segunda línea ni el horario:
  // dos citas encimadas dejan cada mitad demasiado estrecha para tres cosas.
  const estrecha = variante === "dia" && (geometria.carriles ?? 1) > 1;

  const clases = [
    s.tarjeta,
    variante === "semana" ? s.tarjetaSemana : "",
    corta && variante === "dia" ? s.tarjetaCorta : "",
    corta || (variante === "dia" && estrecha) ? s.tarjetaSinFila2 : "",
  ]
    .filter(Boolean)
    .join(" ");

  const segundaLinea = [cita.tratamiento, cita.detalle].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className={clases}
      onClick={(e) => {
        e.stopPropagation();
        onAbrir?.(cita.id);
      }}
      aria-pressed={seleccionada}
      title={`${cita.nombrePaciente} · ${cita.rango} · ${cita.chip}`}
      style={{
        top: geometria.top,
        height: geometria.alto,
        left: geometria.left,
        width: geometria.width,
        background: pinta.fondo,
        borderColor: pinta.borde,
        borderStyle: pinta.estiloBorde,
        opacity: pinta.opacidad,
        boxShadow: sombra,
      }}
    >
      <span className={s.tarjetaFila1}>
        <span
          className={`${s.tarjetaNombre} ${pinta.tachado ? s.tarjetaNombreTachado : ""}`}
        >
          {cita.nombrePaciente}
        </span>

        {variante === "dia" ? (
          <>
            {!estrecha && <span className={s.tarjetaHora}>{cita.rango}</span>}
            <span
              className={s.tarjetaChip}
              style={{ background: pinta.chipFondo, color: pinta.chipTinta }}
            >
              {cita.chip}
            </span>
          </>
        ) : (
          <IconoDeEstado icono={pinta.icono} color={pinta.iconoColor} />
        )}
      </span>

      <span className={s.tarjetaFila2}>
        {variante === "semana" ? `${cita.horaInicio} · ${cita.tratamiento}` : segundaLinea}
      </span>
    </button>
  );
}

/**
 * El ícono relleno de la variante compacta.
 *
 * El diseño pide Material Symbols Rounded, pero la fuente recortada del panel
 * (`src/fonts/material-symbols-rounded-menu.woff2`) no trae ni la mitad de
 * estos nombres, y ampliarla tocaría un archivo compartido con el menú. La
 * casa ya usa `lucide-react` en todas partes, así que la agenda nueva usa
 * lucide con los equivalentes. Queda anotado en el reporte.
 */
function IconoDeEstado({ icono, color }: { icono: IconoEstado; color: string }) {
  if (!icono) return null;
  const props = { size: 14, color, strokeWidth: 2.4, className: s.tarjetaIconoEstado };
  switch (icono) {
    case "check":
      return <Check {...props} />;
    case "schedule":
      return <Clock {...props} />;
    case "circle":
      return <Circle {...props} fill={color} />;
    case "chair":
      return <Armchair {...props} />;
    case "cancel":
      return <Ban {...props} />;
    case "person_off":
      return <UserX {...props} />;
  }
}
