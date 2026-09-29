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
