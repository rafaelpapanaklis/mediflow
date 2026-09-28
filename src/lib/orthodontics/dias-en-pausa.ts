// H45: «Pasado de su fecha» contaba los meses que el caso estuvo en pausa: un
// paciente pausado seis meses salía atrasado. El caso no guarda su historial de
// pausas, pero cada cambio de estado queda en la bitácora
// (`ortho.treatmentPlan.statusChanged`, con `status: {before, after}`): de ahí
// se suman los días que estuvo en «En pausa». PURO.

export interface CambioDeEstado {
  at: Date;
  antes: string | null;
  despues: string | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Días totales en `ON_HOLD`, dado el historial de cambios (en cualquier orden) y el estado actual. */
export function diasEnPausa(cambios: readonly CambioDeEstado[], estadoActual: string, ahora: Date): number {
  const orden = [...cambios].sort((a, b) => a.at.getTime() - b.at.getTime());
  let desde: Date | null = null;
  let total = 0;
  for (const c of orden) {
    if (c.despues === "ON_HOLD" && desde === null) desde = c.at;
    else if (c.antes === "ON_HOLD" && c.despues !== "ON_HOLD" && desde !== null) {
      total += c.at.getTime() - desde.getTime();
      desde = null;
    }
  }
  if (desde !== null && estadoActual === "ON_HOLD") total += ahora.getTime() - desde.getTime();
  return Math.max(0, Math.round(total / DIA_MS));
}

/** Lee los cambios de estado de la bitácora (`changes.status`). */
export function cambiosDeEstadoDeBitacora(
  filas: ReadonlyArray<{ createdAt: Date; changes: unknown }>,
): CambioDeEstado[] {
  const out: CambioDeEstado[] = [];
  for (const f of filas) {
    const st = (f.changes as { status?: { before?: unknown; after?: unknown } } | null)?.status;
    if (!st) continue;
    out.push({
      at: f.createdAt,
      antes: typeof st.before === "string" ? st.before : null,
      despues: typeof st.after === "string" ? st.after : null,
    });
  }
  return out;
}
