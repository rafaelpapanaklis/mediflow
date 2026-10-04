// «Última visita» de la lista de pacientes (ws1-t1, ronda de arreglos de la auditoría de uso — C-93).
//
// EL FALLO QUE CIERRA: la columna salía de la última NOTA CLÍNICA (`records[0].visitDate`), así que un paciente
// con su cita completada pero sin nota firmada decía «Última visita: Nunca». Una visita es que el paciente vino:
// cuenta la última cita COMPLETADA (o «Salió») y la última nota, la que sea más reciente.

/** Estados de cita que son «vino a la clínica». */
export const ESTADOS_DE_VISITA = ["COMPLETED", "CHECKED_OUT"] as const;

export function ultimaVisita(
  ultimaNota: Date | string | null | undefined,
  ultimaCitaAtendida: Date | string | null | undefined,
): string | null {
  const ms = [ultimaNota, ultimaCitaAtendida]
    .filter((v): v is Date | string => v !== null && v !== undefined)
    .map((v) => new Date(v).getTime())
    .filter((n) => Number.isFinite(n));
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null;
}
