// Tratamientos de ORTODONCIA de Dentalink → CASOS vivos del módulo (ws1-t12). Esqueleto: el enganche único de
// treatmentPlansHandler ya llama a estas dos funciones; la implementación llega en el commit siguiente.
import type { PreviewRow } from "../types";
import type { ImportContext } from "../engine";

/** process(): marca (data.ortoCaso) las filas de los tratamientos de ortodoncia. */
export async function marcarCasosDeOrtodoncia(_filas: PreviewRow[], _clinicId: string, _ctx: ImportContext): Promise<void> {
  return;
}

/** commit(): crea los casos de las filas marcadas. */
export async function commitCasosDeOrtodoncia(_filas: PreviewRow[], _clinicId: string, _ctx: ImportContext): Promise<{ created: number; skipped: number }> {
  return { created: 0, skipped: 0 };
}
