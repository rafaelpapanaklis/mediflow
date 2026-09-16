/**
 * Los NUEVE estados de cita → cómo se pintan en la agenda nueva.
 *
 * ┌─ Por qué existe este archivo ───────────────────────────────────────────┐
 * │ El diseño de Claude Design enseña CINCO pintas (confirmada, sin         │
 * │ confirmar, esperando, en consulta, atendida). El sistema tiene NUEVE    │
 * │ estados. Los cuatro que sobran no pueden caer en un «no sé qué es esto» │
 * │ y pintarse mal — es exactamente el fallo que se arregló en la tabla de  │
 * │ citas de la ficha del paciente.                                         │
 * │                                                                         │
 * │ Por eso el mapa es un `Record<AppointmentStatus, …>` EXHAUSTIVO y no    │
 * │ hay ni un `default`, ni un `??`, ni un `as`. Si mañana alguien añade un │
 * │ décimo estado al enum, TypeScript rompe este archivo antes de que la    │
 * │ agenda lo pinte de gris por accidente.                                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * El reparto, y por qué (va también en el reporte para Rafael):
 *
 *  · SCHEDULED    → «Sin confirmar». Es la cita agendada que todavía no
 *                   confirmó nadie: el borde PUNTEADO del diseño es justo eso.
 *  · CONFIRMED    → «Confirmada». Literal.
 *  · CHECKED_IN   → «Esperando» (ámbar). El paciente llegó y está en la sala
 *                   de espera; el ámbar del diseño significa «lleva esperando»
 *                   y el chip lleva los minutos.
 *  · IN_CHAIR     → familia MORADA, chip «En sillón». Ya no está en la sala de
 *                   espera, está en el consultorio; pintarlo de ámbar lo
 *                   confundiría con la sala. Comparte familia con «en consulta»
 *                   porque es el paso inmediatamente anterior, y se distingue
 *                   por el chip y por el ícono (`chair`, no `circle`).
 *                   [Acordado con ws1-t2 para que Día, Semana y Mes coincidan.]
 *  · IN_PROGRESS  → «En consulta». Literal.
 *  · COMPLETED    → «Atendida». Literal (opacidad 0.6 del diseño).
 *  · CHECKED_OUT  → «Atendida» con chip «Salió». El paciente ya se fue; misma
 *                   pinta apagada, distinto rótulo, porque para recepción son
 *                   dos cosas distintas («terminó» vs «ya no está aquí»).
 *  · CANCELLED    → PINTA NUEVA. El diseño no la tiene. Gris apagado, borde
 *                   punteado y el nombre tachado. Ojo: hoy las canceladas NO
 *                   se dibujan en la cuadrícula de Día (`assignLanes` las
 *                   descarta) — esta pinta la usan Semana, Mes y el panel.
 *  · NO_SHOW      → PINTA NUEVA. El diseño no la tiene y NO puede caer en
 *                   «atendida»: una cita a la que el paciente no vino no es
 *                   una cita atendida. Rojo suave, en la misma familia `oklch`
 *                   que el resto para que no desentone.
 */

import type { AppointmentStatus } from "@/lib/agenda/types";
import { AGENDA_TOKENS as T } from "./tokens";

/** El ícono de Material Symbols que resume el estado (lo usa la tarjeta compacta de Semana). */
export type IconoEstado = "check" | "schedule" | "circle" | "chair" | "cancel" | "person_off" | null;

export interface PintaEstado {
  /** Fondo de la tarjeta. */
  fondo: string;
  /** Color del borde. */
  borde: string;
  /** `solid` o `dashed` — el diseño usa punteado para «sin confirmar». */
  estiloBorde: "solid" | "dashed";
  /** Opacidad de la tarjeta entera. */
  opacidad: number;
  /** Texto del chip, sin los minutos (esos los añade `pintaDeCita`). */
  chipTexto: string;
  chipFondo: string;
  chipTinta: string;
  /** Ícono relleno de la variante compacta. */
  icono: IconoEstado;
  iconoColor: string;
  /** El nombre del paciente va tachado (solo canceladas). */
  tachado: boolean;
  /** Este estado ya no cuenta como cita viva (no ocupa hueco ni suma ocupación). */
  muerta: boolean;
}

/**
 * Los nueve, exhaustivo. No añadas un `default`: la gracia es que TypeScript
 * obligue a decidir cuando aparezca un estado nuevo.
 */
export const PINTA_POR_ESTADO: Record<AppointmentStatus, PintaEstado> = {
  SCHEDULED: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "dashed",
    opacidad: 1,
    chipTexto: "Sin confirmar",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: null,
    iconoColor: T.texto2,
    tachado: false,
    muerta: false,
  },
  CONFIRMED: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "Confirmada",
    chipFondo: T.chipVerdeFondo,
    chipTinta: T.chipVerdeTinta,
    icono: "check",
    iconoColor: T.verde,
    tachado: false,
    muerta: false,
  },
  CHECKED_IN: {
    fondo: T.ambarClaro,
    borde: T.ambarBorde,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "Esperando",
    chipFondo: T.ambarFondo,
    chipTinta: T.ambarTexto,
    icono: "schedule",
    iconoColor: T.ambarIcono,
    tachado: false,
    muerta: false,
  },
  IN_CHAIR: {
    fondo: T.moradoTinte,
    borde: T.bordeConsulta,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "En sillón",
    chipFondo: T.moradoTinte,
    chipTinta: T.moradoTexto,
    icono: "chair",
    iconoColor: T.moradoTexto,
    tachado: false,
    muerta: false,
  },
  IN_PROGRESS: {
    fondo: T.moradoTinte,
    borde: T.bordeConsulta,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "En consulta",
    chipFondo: T.moradoTinte,
    chipTinta: T.moradoTexto,
    icono: "circle",
    iconoColor: T.verde,
    tachado: false,
    muerta: false,
  },
  COMPLETED: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "solid",
    opacidad: 0.6,
    chipTexto: "Atendida",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: "check",
    iconoColor: T.texto2,
    tachado: false,
    muerta: false,
  },
  CHECKED_OUT: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "solid",
    opacidad: 0.6,
    chipTexto: "Salió",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: "check",
    iconoColor: T.texto2,
    tachado: false,
    muerta: false,
  },
  // ── Las dos que el diseño no tiene ──────────────────────────────────────
  CANCELLED: {
    fondo: T.fondoCerrado,
    borde: T.bordeControl,
    estiloBorde: "dashed",
    opacidad: 0.55,
    chipTexto: "Cancelada",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: "cancel",
    iconoColor: T.texto2,
    tachado: true,
    muerta: true,
  },
  NO_SHOW: {
    fondo: T.rojoFondo,
    borde: T.rojoBorde,
    estiloBorde: "solid",
    opacidad: 0.85,
    chipTexto: "No asistió",
    chipFondo: T.chipRojoFondo,
    chipTinta: T.rojoTexto,
    icono: "person_off",
    iconoColor: T.rojoTexto,
    tachado: false,
    muerta: true,
  },
};

/**
 * Los estados que NO cuentan como cita viva. Se deriva del mapa de arriba
 * para que no haya dos listas que se puedan desincronizar.
 */
export const ESTADOS_MUERTOS: readonly AppointmentStatus[] = (
  Object.keys(PINTA_POR_ESTADO) as AppointmentStatus[]
).filter((e) => PINTA_POR_ESTADO[e].muerta);

/** ¿Esta cita sigue viva (ocupa sillón, cuenta para la ocupación)? */
export function citaViva(status: AppointmentStatus): boolean {
  return !PINTA_POR_ESTADO[status].muerta;
}
