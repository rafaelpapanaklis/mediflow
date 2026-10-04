// Dónde se abre la rejilla del Día y qué citas quedan fuera del horario (ws1-t1, tercera ronda — C-91).
//
// EL FALLO QUE CIERRA: la rejilla abría siempre arriba (a las 02:00 si una cita cancelada la estiraba, o a la
// apertura) y las citas de 18:51 y 23:01 quedaban 10–14 h más abajo, sin ningún aviso: el doctor creía que no
// estaban. Ahora la rejilla entra en la apertura o en la primera cita viva si es antes, y un aviso dice
// «2 citas fuera del horario: 18:51 · 23:01» con un botón por hora que lleva a cada una. Puro.

import { citaContada } from "./estados";

export interface CitaDelDia {
  id: string;
  inicioMin: number;
  estado: string;
}

/** El minuto en el que se coloca la rejilla al abrir un día (null = arriba, como siempre). */
export function minutoDeEntrada(citas: readonly CitaDelDia[], aperturaMin: number | null): number | null {
  const vivas = citas.filter((c) => citaContada(c.estado)).map((c) => c.inicioMin);
  const primera = vivas.length ? Math.min(...vivas) : null;
  if (aperturaMin == null) return primera;
  return primera != null && primera < aperturaMin ? primera : aperturaMin;
}

export interface CitaFueraDeHorario {
  id: string;
  minuto: number;
  hora: string;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Las citas vivas que empiezan antes de abrir o desde el cierre. Sin horario conocido, ninguna. */
export function citasFueraDeHorario(
  citas: readonly CitaDelDia[],
  aperturaMin: number | null,
  cierreMin: number | null,
): CitaFueraDeHorario[] {
  if (aperturaMin == null && cierreMin == null) return [];
  return citas
    .filter((c) => citaContada(c.estado))
    .filter((c) => (aperturaMin != null && c.inicioMin < aperturaMin) || (cierreMin != null && c.inicioMin >= cierreMin))
    .sort((a, b) => a.inicioMin - b.inicioMin)
    .map((c) => ({ id: c.id, minuto: c.inicioMin, hora: hhmm(c.inicioMin) }));
}

export function textoFueraDeHorario(n: number): string {
  return n === 1 ? "1 cita fuera del horario:" : `${n} citas fuera del horario:`;
}
