// Ortodoncia — la «Secuencia de arcos» al firmar una hoja de control (ws1-t10). PURO.
// Firmar con un arco en «Arco nuevo» pone ese paso de la secuencia en «Actual» con la fecha de la visita como inicio, y
// cierra el que estaba en uso (con la misma fecha como fin). Antes la secuencia no se movía: el arco usado en el control
// seguía «futuro» sin inicio aunque «Arco actual» ya dijera ese mismo arco.
// ws1-t12 (ticket BEVADENT, punto 4b): solo se cierra lo que el arco nuevo REEMPLAZA. Cambiar el arco superior no da por
// terminado el inferior: un paso solo se cierra si todas sus arcadas las cubre el arco nuevo. Si el que estaba era de las
// dos arcadas y el nuevo es solo de una, el anterior sigue «Actual» (sigue puesto en la otra).

export type EstadoDePasoDeArco = "PLANNED" | "ACTIVE" | "COMPLETED" | "SKIPPED";

export interface PasoDeArco {
  id: string;
  status: EstadoDePasoDeArco;
  appliedDate: Date | null;
  completedDate: Date | null;
  /** Arcadas del paso. Si falta el dato (o las dos vienen en `false`, que la pantalla no permite) cuenta como las dos. */
  archUpper?: boolean | null;
  archLower?: boolean | null;
}

export interface CambioDePasoDeArco {
  id: string;
  status: EstadoDePasoDeArco;
  appliedDate: Date | null;
  completedDate: Date | null;
}

function arcadas(p: PasoDeArco): { sup: boolean; inf: boolean } {
  const sup = p.archUpper ?? true;
  const inf = p.archLower ?? true;
  return sup || inf ? { sup, inf } : { sup: true, inf: true };
}

/** ¿El arco nuevo ocupa todas las arcadas de este paso? Solo entonces lo reemplaza. */
export function arcoNuevoReemplaza(nuevo: PasoDeArco, paso: PasoDeArco): boolean {
  const n = arcadas(nuevo);
  const p = arcadas(paso);
  return (!p.sup || n.sup) && (!p.inf || n.inf);
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

  // Se cierra el que estaba en uso y el arco con el que llegó (aunque la secuencia nunca lo hubiera marcado), siempre
  // que el arco nuevo lo reemplace en todas sus arcadas.
  for (const p of pasos) {
    if (p.id === nuevo.id) continue;
    if (!arcoNuevoReemplaza(nuevo, p)) continue;
    const enUso = p.status === "ACTIVE";
    const eraElAnterior = p.id === arcoAnteriorId && p.status === "PLANNED";
    if (!enUso && !eraElAnterior) continue;
    cambios.push({ id: p.id, status: "COMPLETED", appliedDate: p.appliedDate, completedDate: p.completedDate ?? fecha });
  }
  return cambios;
}
