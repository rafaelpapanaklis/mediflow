// Pediatrics — clasificación de dentición (temporal/mixta/permanente). Spec: §1.3, §4.A.1

export type DentitionType = "temporal" | "mixta" | "permanente";

export const TEMPORAL_FDI = [
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
] as const;

export const PERMANENT_FDI = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
] as const;

export const TEMPORAL_FDI_SET: ReadonlySet<number> = new Set(TEMPORAL_FDI);
export const PERMANENT_FDI_SET: ReadonlySet<number> = new Set(PERMANENT_FDI);

export function isTemporalFdi(fdi: number): boolean {
  return TEMPORAL_FDI_SET.has(fdi);
}

export function isPermanentFdi(fdi: number): boolean {
  return PERMANENT_FDI_SET.has(fdi);
}

/**
 * Clasifica la dentición según edad decimal y conteo de dientes permanentes
 * erupcionados (registrados en EruptionRecord). El umbral de "mixta" es la
 * presencia de al menos 1 permanente Y al menos 1 temporal aún presente; las
 * heurísticas por edad cubren el caso sin registros de erupción.
 */
export function classifyDentition(args: {
  ageDecimal: number;
  eruptedPermanent: number;
}): DentitionType {
  const { ageDecimal, eruptedPermanent } = args;

  if (eruptedPermanent === 0) {
    if (ageDecimal < 6) return "temporal";
    return "mixta";
  }

  if (eruptedPermanent >= 28) return "permanente";

  if (ageDecimal < 6) return "temporal";
  if (ageDecimal >= 12.5 && eruptedPermanent >= 24) return "permanente";
  return "mixta";
}
