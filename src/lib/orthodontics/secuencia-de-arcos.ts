// Ortodoncia — la «Secuencia de arcos» al firmar una hoja de control (ws1-t10). PURO.
// Firmar con un arco en «Arco nuevo» pone ese paso de la secuencia en «Actual» con la fecha de la visita como inicio, y
// cierra el que estaba en uso (con la misma fecha como fin). Antes la secuencia no se movía: el arco usado en el control
// seguía «futuro» sin inicio aunque «Arco actual» ya dijera ese mismo arco.

export type EstadoDePasoDeArco = "PLANNED" | "ACTIVE" | "COMPLETED" | "SKIPPED";

export interface PasoDeArco {
  id: string;
  status: EstadoDePasoDeArco;
  appliedDate: Date | null;
  completedDate: Date | null;
}

export interface CambioDePasoDeArco {
  id: string;
  status: EstadoDePasoDeArco;
  appliedDate: Date | null;
  completedDate: Date | null;
}

/**
 * Los cambios que la firma hace a la secuencia. Sin arco nuevo (o uno que no es de este caso) no cambia nada. Solo
 * devuelve los pasos que de verdad cambian.
 */
export function cambiosAlFirmarConArco(args: {
  pasos: readonly PasoDeArco[];
  arcoNuevoId: string | null | undefined;
  /** El arco con el que llegó el paciente a esta visita. */
  arcoAnteriorId?: string | null;
  /** El día de la visita. */
  fecha: Date;
}): CambioDePasoDeArco[] {
  const { pasos, arcoNuevoId, arcoAnteriorId, fecha } = args;
  if (!arcoNuevoId) return [];
  const nuevo = pasos.find((p) => p.id === arcoNuevoId);
  if (!nuevo) return [];

  const cambios: CambioDePasoDeArco[] = [];

  // El paso usado hoy queda «Actual». Si ya lo estaba se respeta su inicio; si volvió a un arco ya cerrado, arranca de nuevo.
  if (nuevo.status !== "ACTIVE" || !nuevo.appliedDate) {
    cambios.push({ id: nuevo.id, status: "ACTIVE", appliedDate: fecha, completedDate: null });
  }

  // Se cierra el que estaba en uso y el arco con el que llegó (aunque la secuencia nunca lo hubiera marcado).
  for (const p of pasos) {
    if (p.id === nuevo.id) continue;
    const enUso = p.status === "ACTIVE";
    const eraElAnterior = p.id === arcoAnteriorId && p.status === "PLANNED";
    if (!enUso && !eraElAnterior) continue;
    cambios.push({ id: p.id, status: "COMPLETED", appliedDate: p.appliedDate, completedDate: p.completedDate ?? fecha });
  }
  return cambios;
}
