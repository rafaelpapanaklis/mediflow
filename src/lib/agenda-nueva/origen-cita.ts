// De dónde vino una cita y qué dice el subtítulo del panel de la agenda (ws1-t1, ronda de arreglos de la
// auditoría de uso — C-94 y C-97). Puro: lo pinta `panel-cita.tsx` y lo prueban sin React.

export function origenCorto(source: string): string {
  switch (source) {
    case "WHATSAPP":
      return "Por WhatsApp";
    case "PATIENT_PORTAL":
      return "Por el paciente";
    case "WEBSITE":
      return "Desde la web";
    default:
      return "En la clínica";
  }
}

/** ws1-t1 (C-97): la cita que nació de la fila de espera (walk-in) ya no se confunde con una agendada. */
export const ORIGEN_WALK_IN = "Sin cita (fila de espera)";

/**
 * El subtítulo del panel: el estado y el origen (ws1-t1, C-94). «Agendada · en la clínica»,
 * «Cancelada · por WhatsApp», «En consulta · sin cita (fila de espera)».
 */
export function subtituloDeLaCita(estado: string, source: string, esWalkIn: boolean): string {
  const origen = esWalkIn ? ORIGEN_WALK_IN : origenCorto(source);
  return `${estado} · ${origen.charAt(0).toLowerCase()}${origen.slice(1)}`;
}

/** ws1-t1 (N-44): «30 min», o «menos de 1 min» cuando terminó en segundos. */
export function textoDuracion(real: number | null, dibujada: number): string {
  if (real != null && real < 1) return "menos de 1 min";
  return `${Math.round(real ?? dibujada)} min`;
}
