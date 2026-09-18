/**
 * La aritmética de la cuadrícula de la agenda nueva.
 *
 * El README del diseño lo da masticado y aquí se transcribe tal cual:
 *
 *   top    = (inicio − 8:00)/60 × 112 + 1
 *   height = duración/60      × 112 − 2
 *
 * Las citas se colocan con ESTA aritmética, nunca con flexbox: una cita de
 * 11:00 a 11:45 tiene que caer en el mismo píxel que la línea de las 11 del
 * eje, y eso solo lo garantiza la cuenta.
 *
 * Dos avisos que ya nos mordieron antes:
 *
 *  1. **Todo minuto de aquí es hora de pared EN LA ZONA DE LA CLÍNICA.** En
 *     Vercel el proceso corre en UTC; `new Date(iso).getHours()` daría la hora
 *     del servidor. Por eso `minutosEnTz` pasa por `getTzParts` (Intl) y no
 *     hay ni un `getHours()` en este archivo.
 *  2. **La cuadrícula no empieza a las 8 ni termina a las 20.** El diseño
 *     dibuja 8–20 porque su clínica de ejemplo abre 8–18; una clínica real
 *     abre a las 9 y cierra a las 18, o abre a las 7. `ventanaDeRejilla`
 *     pinta exactamente el rango que recibe (el horario real del día, ya
 *     ensanchado con sus citas fuera de horario) y el resto de funciones toman
 *     la hora de inicio como parámetro, nunca la dan por supuesta.
 */

import { getTzParts } from "@/lib/agenda/time-utils";
import {
  ALTO_HORA,
  COLCHON_REJILLA,
  HORA_FIN_DISENO,
  HORA_INICIO_DISENO,
} from "./tokens";

/** Minutos desde la medianoche, en la zona horaria de la CLÍNICA. */
export function minutosEnTz(iso: string, timezone: string): number {
  const p = getTzParts(new Date(iso), timezone);
  return p.hour * 60 + p.minute;
}

/** El día calendario (`YYYY-MM-DD`) de un instante, en la zona de la clínica. */
export function diaEnTz(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutos del día → `HH:MM`, con cero a la izquierda. */
export function comoHora(minutos: number): string {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** `HH:MM` → minutos del día. Devuelve `null` si la cadena no es una hora. */
export function deHora(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface VentanaRejilla {
  /** Hora (entera) en la que arranca la cuadrícula. */
  horaInicio: number;
  /** Hora (entera) en la que termina. */
  horaFin: number;
  /** Minuto del día en el que arranca — el origen de todas las cuentas. */
  minutoInicio: number;
  /** Alto total del lienzo desplazable, en px. */
  alto: number;
  /** Cuántas etiquetas de hora dibuja el eje (inclusive las dos puntas). */
  horas: number[];
}

/**
 * El rango que DIBUJA la cuadrícula.
 *
 * Pinta EXACTAMENTE las horas en que la clínica está abierta ese día: una
 * clínica de 9 a 18 ve una rejilla de 9 a 18, sin la hora vacía de 8 a 9 ni
 * las dos de 18 a 20 que dibujaba el diseño (su clínica de ejemplo abría
 * 8–18 y el lienzo de 8–20 era suyo, no de todas).
 *
 * `dayStart`/`dayEnd` son las HORAS que ya calculó `paintedAgendaWindow`: el
 * horario real del día —por día de la semana, con el sábado corto incluido—
 * ENSANCHADO con las citas fuera de horario de ese día. Por eso aquí no hay
 * ni un `min` ni un `max` contra una constante: una urgencia a las 8:00 con
 * apertura a las 9 ya viene dentro del rango (`dayStart = 8`), y una cita
 * que se alargó más allá del cierre también. **Preferimos separarnos del
 * horario a esconder una cita**, pero eso lo decide quien conoce las citas,
 * no la geometría.
 *
 * Sin horario en Ajustes, `paintedAgendaWindow` ya trae la ventana de la
 * clínica de siempre (8–20 por defecto): nadie se queda con la agenda vacía.
 */
export function ventanaDeRejilla(dayStart: number, dayEnd: number): VentanaRejilla {
  // Un número que no lo es (estado a medio cargar) cae al lienzo del diseño,
  // nunca a una rejilla vacía.
  const inicio = Number.isFinite(dayStart) ? Math.floor(dayStart) : HORA_INICIO_DISENO;
  const fin = Number.isFinite(dayEnd) ? Math.ceil(dayEnd) : HORA_FIN_DISENO;
  const horaInicio = Math.max(0, Math.min(23, inicio));
  // Nunca menos de una hora de lienzo, y nunca fuera del día.
  const horaFin = Math.max(horaInicio + 1, Math.min(24, fin));
  const horas: number[] = [];
  for (let h = horaInicio; h <= horaFin; h++) horas.push(h);
  return {
    horaInicio,
    horaFin,
    minutoInicio: horaInicio * 60,
    alto: (horaFin - horaInicio) * ALTO_HORA + COLCHON_REJILLA,
    horas,
  };
}

/**
 * `top` de una tarjeta de cita, en px. README: `(inicio − 8:00)/60 × 112 + 1`.
 * El `+1` deja respirar la línea de la hora justo encima.
 */
export function topDeCita(inicioMin: number, minutoInicio = HORA_INICIO_DISENO * 60): number {
  return ((inicioMin - minutoInicio) / 60) * ALTO_HORA + 1;
}

/**
 * `height` de una tarjeta, en px. README: `duración/60 × 112 − 2`.
 * El `−2` es el hueco entre dos citas pegadas.
 */
export function altoDeCita(duracionMin: number): number {
  return Math.max(0, (duracionMin / 60) * ALTO_HORA - 2);
}

/** `top` de la línea de «ahora», en px. Sin el `+1`: la línea va sobre la hora exacta. */
export function topDeAhora(ahoraMin: number, minutoInicio = HORA_INICIO_DISENO * 60): number {
  return ((ahoraMin - minutoInicio) / 60) * ALTO_HORA;
}

/** `top` de la etiqueta de una hora en el eje. README: `k · 112 + 6`. */
export function topDeHora(hora: number, minutoInicio = HORA_INICIO_DISENO * 60): number {
  return ((hora * 60 - minutoInicio) / 60) * ALTO_HORA + 6;
}

/** `top` del borde superior de una hora (sin el desplazamiento de la etiqueta). */
export function topDeLinea(minuto: number, minutoInicio = HORA_INICIO_DISENO * 60): number {
  return ((minuto - minutoInicio) / 60) * ALTO_HORA;
}

/**
 * ¿Hay que pintar la línea de «ahora»?
 *
 * Solo si el día que se está mirando es HOY **en la zona de la clínica**, y
 * solo si el reloj cae dentro del lienzo. Devuelve los minutos locales o
 * `null`.
 *
 * `ahora` se inyecta para poder probarlo; en producción es `new Date()`.
 */
export function minutosDeAhora(args: {
  dayISO: string;
  timezone: string;
  ventana: VentanaRejilla;
  ahora?: Date;
}): number | null {
  const { dayISO, timezone, ventana } = args;
  const ahora = args.ahora ?? new Date();
  const p = getTzParts(ahora, timezone);
  const hoyISO = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (hoyISO !== dayISO) return null;
  const min = p.hour * 60 + p.minute;
  if (min < ventana.minutoInicio || min > ventana.horaFin * 60) return null;
  return min;
}

/**
 * Los carriles de una cita solapada, en porcentaje, listos para `style`.
 *
 * El reparto en carriles lo hace `assignLanes` (`src/lib/agenda/lane-layout.ts`),
 * que ya existe y es el mismo que usa la agenda de siempre; esto solo traduce
 * `lane`/`laneCount` a `left`/`width`. Con un solo carril la tarjeta va a
 * ancho completo con los 8 px de aire del diseño; con varios se reparten el
 * ancho dejando 2 px entre ellas.
 */
export function carrilDeCita(lane: number, laneCount: number): { left: string; width: string } {
  if (laneCount <= 1) return { left: "8px", width: "calc(100% - 16px)" };
  const ancho = 100 / laneCount;
  return {
    left: `calc(${lane * ancho}% + ${lane === 0 ? 8 : 2}px)`,
    width: `calc(${ancho}% - ${lane === 0 || lane === laneCount - 1 ? 10 : 4}px)`,
  };
}
