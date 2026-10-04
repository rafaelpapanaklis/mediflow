// «Nueva cita» en un día cerrado o fuera del horario: decirlo ANTES de guardar (ws1-t1, tercera ronda — N-38).
//
// EL FALLO QUE CIERRA: en domingo (cerrado) la rejilla de horas ofrecía 48 huecos «libres» de 08:00 a 19:45 y el
// aviso «la clínica está cerrada ese día según el horario de Ajustes» llegaba DESPUÉS de guardar — y el menú se
// llama Configuración, no Ajustes. La política no cambia (el alta del staff avisa, no bloquea, P1-13): solo se
// dice antes, los huecos fuera de horario se pintan apagados y «primer hueco libre» prefiere uno en horario.

export interface HorarioDelDia {
  abierto: boolean;
  aperturaMin: number | null;
  cierreMin: number | null;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** ¿Un hueco de `inicioMin` a `inicioMin + duracionMin` queda fuera del horario del día? Sin horario: no. */
export function huecoFueraDeHorario(horario: HorarioDelDia | null | undefined, inicioMin: number, duracionMin: number): boolean {
  if (!horario) return false;
  if (!horario.abierto) return true;
  if (horario.aperturaMin != null && inicioMin < horario.aperturaMin) return true;
  if (horario.cierreMin != null && inicioMin + duracionMin > horario.cierreMin) return true;
  return false;
}

/**
 * ¿El hueco se pinta «fuera de horario»? (ws1-t1, ronda final — N-A). Antes solo un hueco LIBRE se apagaba, y el
 * último del día (19:45 con 30 min) no cabe antes del final de la rejilla: salía como ocupado, sin el punteado,
 * aunque está fuera de horario igual que los demás. Un hueco que no está libre solo porque se pasa del final del
 * día se pinta también fuera de horario (sigue sin poder elegirse).
 */
export function pintarFueraDeHorario(o: { libre: boolean; seSaleDelDia: boolean; fueraDeHorario: boolean }): boolean {
  return (o.libre || o.seSaleDelDia) && o.fueraDeHorario;
}

export const DONDE_SE_CAMBIA_EL_HORARIO = "Configuración → Horarios y bloqueos";

/** La línea que va sobre la rejilla. null = nada que decir. */
export function avisoHorarioAlAgendar(
  horario: HorarioDelDia | null | undefined,
  elegido: { inicioMin: number; duracionMin: number } | null,
): string | null {
  if (!horario) return null;
  if (!horario.abierto) {
    return `La clínica está cerrada ese día (${DONDE_SE_CAMBIA_EL_HORARIO}). Puedes agendar igual: la cita se guarda con aviso.`;
  }
  if (elegido && huecoFueraDeHorario(horario, elegido.inicioMin, elegido.duracionMin)) {
    const rango = horario.aperturaMin != null && horario.cierreMin != null ? ` (${hhmm(horario.aperturaMin)}–${hhmm(horario.cierreMin)})` : "";
    return `Esa hora queda fuera del horario de la clínica${rango}. Puedes agendar igual: la cita se guarda con aviso.`;
  }
  return null;
}
