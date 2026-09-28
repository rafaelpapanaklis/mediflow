// H66: «lo que una ortodoncista espera y no encuentra» — la hoja registra la
// visita pero no da la película del caso. Dos datos que ya se pueden calcular
// con lo capturado: los brackets caídos acumulados y una lectura de la
// cooperación del paciente. PURO.

export interface ControlParaResumen {
  status: string;
  brokenBrackets: ReadonlyArray<{ toothFdi: number; reBondedDate: string | null }>;
}

/** Brackets caídos en TODO el caso (solo controles firmados) y cuántos siguen sin recementar. */
export function bracketsDelCaso(cards: readonly ControlParaResumen[]): { caidos: number; pendientes: number } {
  let caidos = 0;
  let pendientes = 0;
  for (const c of cards) {
    if (c.status !== "SIGNED") continue;
    for (const b of c.brokenBrackets) {
      caidos += 1;
      if (!b.reBondedDate) pendientes += 1;
    }
  }
  return { caidos, pendientes };
}

export type Cooperacion = "buena" | "regular" | "baja";

/**
 * Cooperación del paciente a partir de asistencia y uso de elásticos (ambos en
 * %, `null` = sin datos). Con un solo dato se juzga por ese; sin ninguno, no se
 * opina (`null`).
 */
export function cooperacionDelPaciente(asistenciaPct: number | null, elasticosPct: number | null): Cooperacion | null {
  const datos = [asistenciaPct, elasticosPct].filter((v): v is number => typeof v === "number");
  if (datos.length === 0) return null;
  const peor = Math.min(...datos);
  if (peor >= 85) return "buena";
  if (peor >= 70) return "regular";
  return "baja";
}
