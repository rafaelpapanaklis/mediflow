// Periodontics — selección de fotos para comparativos pre/post. SPEC §6, COMMIT 13.

import {
  PERIO_PHOTO_COMPARE_PAIRS,
  type PerioPhotoKind,
} from "./photo-types";
import type { PerioPhotoListItem } from "./photo-load";

export interface PerioPhotoComparePair {
  beforeKind: PerioPhotoKind;
  afterKind: PerioPhotoKind;
  label: string;
  before: PerioPhotoListItem | null;
  after: PerioPhotoListItem | null;
}

/**
 * Para cada par de comparación definido en `PERIO_PHOTO_COMPARE_PAIRS`,
 * elige la foto más reciente de cada `kind`. Filtra opcionalmente por
 * `toothFdi` (eg. para mostrar evolución de un diente específico).
 *
 * Devuelve solo los pares con al menos UNA de las dos fotos disponibles —
 * pares completamente vacíos se omiten para no clutterear el UI.
 */
export function buildPerioComparePairs(
  photos: PerioPhotoListItem[],
  filter?: { toothFdi?: number },
): PerioPhotoComparePair[] {
  const filtered = filter?.toothFdi
    ? photos.filter((p) => p.toothFdi === filter.toothFdi)
    : photos;

  const latestByKind = new Map<PerioPhotoKind, PerioPhotoListItem>();
  for (const p of filtered) {
    if (!p.kind) continue;
    const existing = latestByKind.get(p.kind);
    if (!existing || p.capturedAt > existing.capturedAt) {
      latestByKind.set(p.kind, p);
    }
  }

  const result: PerioPhotoComparePair[] = [];
  for (const [beforeKind, afterKind, label] of PERIO_PHOTO_COMPARE_PAIRS) {
    const before = latestByKind.get(beforeKind) ?? null;
    const after = latestByKind.get(afterKind) ?? null;
    if (!before && !after) continue;
    result.push({ beforeKind, afterKind, label, before, after });
  }
  return result;
}

/**
 * Anotación libre sobre la foto, posicionada en coords relativas (0..1)
 * para que sea independiente del tamaño de display.
 */
export interface PhotoAnnotation {
  x: number; // 0..1
  y: number; // 0..1
  label: string;
  color?: string;
}

/**
 * Parsea anotaciones desde el campo `annotations` (Json) de ClinicalPhoto.
 * Acepta array de objetos con shape válido; descarta inválidos en silencio
 * para no romper el render por datos legacy.
 */
export function parseAnnotations(raw: unknown): PhotoAnnotation[] {
  if (!Array.isArray(raw)) return [];
  const out: PhotoAnnotation[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const x = typeof obj.x === "number" ? obj.x : null;
    const y = typeof obj.y === "number" ? obj.y : null;
    const label = typeof obj.label === "string" ? obj.label : null;
    if (x === null || y === null || label === null) continue;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    const color = typeof obj.color === "string" ? obj.color : undefined;
    out.push({ x, y, label, color });
  }
  return out;
}
