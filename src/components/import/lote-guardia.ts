// Reglas de la carga por lote que NO pueden depender de un efecto de React (I1 de la revisión final, 28-sep-2026):
// cada archivo se confirma SOLO con su análisis y su mapeo, y un archivo al que le falta algo se detiene y lo pide.
import type { PreviewResult } from "./import-client";

/** ¿El mapeo nombra solo columnas que ESTE archivo tiene? Un mapeo del archivo anterior no pasa. */
export function mapeoEsDeEsteArchivo(mapping: Record<string, string>, columnas: readonly string[]): boolean {
  const propias = new Set(columnas);
  return Object.keys(mapping).every((k) => propias.has(k));
}

/**
 * ¿Se puede confirmar este archivo (a mano o con «Confirmar automáticamente»)?
 *  · la vista previa tiene que ser DEL archivo actual (`previewKey === currentKey`): al avanzar de archivo, durante
 *    un render la vista previa y el mapeo siguen siendo los del anterior;
 *  · sin mapeo pendiente ni hoja por elegir;
 *  · sin nada por decidir: montos ambiguos, un doctor o un hallazgo sin equivalente;
 *  · y no todas las filas con error.
 */
export function puedeConfirmarSolo(args: {
  previewKey: string | null;
  currentKey: string | null;
  preview: Pick<PreviewResult, "columns" | "unresolved" | "mappingError" | "needsSheet" | "stats"> | null;
  mapping: Record<string, string>;
}): boolean {
  const { previewKey, currentKey, preview, mapping } = args;
  if (!preview || !currentKey || previewKey !== currentKey) return false;
  if (preview.mappingError || preview.needsSheet) return false;
  if (!mapeoEsDeEsteArchivo(mapping, preview.columns.map((c) => c.source))) return false;
  if (preview.unresolved?.some((u) => u.field === "amountFormat" || u.field === "doctor" || u.field === "condition")) return false;
  if (preview.stats.valid === 0 && preview.stats.errors > 0) return false;
  return true;
}

// ── Decisiones de valores sin equivalente (doctor, hallazgo del odontograma) ─────────────────────────────────
/** Campos cuya decisión hace que la vista previa se RECALCULE (las filas pasan de error a válidas al elegir). */
export const CAMPOS_QUE_REFRESCAN = ["doctor", "condition"] as const;

/** ¿Elegir un equivalente de este campo obliga a recalcular la vista previa? */
export function refrescaAlDecidir(campo: string | null | undefined): campo is (typeof CAMPOS_QUE_REFRESCAN)[number] {
  return campo === "doctor" || campo === "condition";
}

/**
 * El `valueMapping` que se manda al servidor (vista previa o importar): las decisiones bajo el campo que las pidió
 * (`campo`, el que reportó el motor o el último que decidió la persona: tras recalcular ya no queda `unresolved`) y el
 * formato de montos. `undefined` si no hay nada que mandar.
 */
export function valueMappingDeDecisiones(
  campo: string | null | undefined,
  decisions: Record<string, string>,
  formatoMontos?: string,
): Record<string, Record<string, string>> | undefined {
  const out: Record<string, Record<string, string>> = {};
  if (campo && Object.keys(decisions).length > 0) out[campo] = decisions;
  if (formatoMontos) out.amountFormat = { formato: formatoMontos };
  return Object.keys(out).length > 0 ? out : undefined;
}
