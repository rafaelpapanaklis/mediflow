// El horario del bot a partir del de la clínica (ws1-t1, tercera ronda — N-53).
//
// EL FALLO QUE CIERRA: el bot de la clínica de prueba decía «Cerrado» los 7 días mientras la Agenda y la reserva
// web tenían el horario de Configuración: el horario se captura en tres sitios. Criterio conservador (anotado
// para Rafael): no se cambia solo el horario de nadie; el bot ofrece «Usar el horario de la clínica», que copia el
// de Configuración → Horarios y bloqueos en el formulario, y se guarda con «Guardar» como siempre. Puro.

export interface DiaBot {
  enabled: boolean;
  open: string;
  close: string;
}

/** Índice 0 = Lunes … 6 = Domingo, igual que ClinicSchedule y el horario del bot. */
export function horarioDelBotDesdeClinica(
  schedules: Array<{ dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }> | null | undefined,
): Record<string, DiaBot> | null {
  if (!schedules || schedules.length === 0) return null;
  const out: Record<string, DiaBot> = {};
  for (let i = 0; i < 7; i++) {
    const d = schedules.find((x) => x.dayOfWeek === i);
    out[String(i)] = d ? { enabled: !!d.enabled, open: d.openTime || "09:00", close: d.closeTime || "18:00" } : { enabled: false, open: "09:00", close: "18:00" };
  }
  return out;
}

/** ¿El bot está «Cerrado» los 7 días? Entonces se le sugiere el de la clínica. */
export function botSiempreCerrado(schedule: Record<string, { enabled: boolean }>): boolean {
  for (let i = 0; i < 7; i++) if (schedule[String(i)]?.enabled) return false;
  return true;
}
