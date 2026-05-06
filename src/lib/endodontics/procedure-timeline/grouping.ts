// Endodontics — agrupación de ClinicalPhoto en fases del procedimiento
// (acceso → conductometría → preparación → obturación → control).
// Usa los enums canónicos de main: ClinicalPhotoType + ClinicalPhotoStage.

import type { ClinicalPhotoStage, ClinicalPhotoType } from "@prisma/client";

export type EndoProcedurePhase =
  | "acceso"
  | "conductometria"
  | "preparacion"
  | "obturacion"
  | "control";

export const PHASE_ORDER: readonly EndoProcedurePhase[] = [
  "acceso",
  "conductometria",
  "preparacion",
  "obturacion",
  "control",
];

export const PHASE_LABEL: Record<EndoProcedurePhase, string> = {
  acceso: "Acceso",
  conductometria: "Conductometría",
  preparacion: "Preparación",
  obturacion: "Obturación",
  control: "Control",
};

/**
 * Resuelve la fase para una foto. Prioridad:
 *   1. photoType en {endo_access, endo_working_length, endo_obturation}
 *      domina sobre el stage.
 *   2. Si no hay match por photoType, cae al stage:
 *        pre → acceso
 *        during → preparacion
 *        post → obturacion
 *        control → control
 */
export function phaseFromPhoto(args: {
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
}): EndoProcedurePhase {
  if (args.photoType === "endo_access") return "acceso";
  if (args.photoType === "endo_working_length") return "conductometria";
  if (args.photoType === "endo_obturation") return "obturacion";
  switch (args.stage) {
    case "pre":
      return "acceso";
    case "during":
      return "preparacion";
    case "post":
      return "obturacion";
    case "control":
      return "control";
  }
}

export interface ProcedurePhoto {
  id: string;
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
  blobUrl: string;
  thumbnailUrl: string | null;
  capturedAt: string;
  toothFdi: number | null;
  notes: string | null;
  /** Etiqueta de conducto (MV, ML, MB2, D, …) extraída de annotations. */
  canalLabel?: string | null;
}

export interface SessionGroup {
  /** ISO date YYYY-MM-DD que define la sesión. */
  sessionKey: string;
  sessionDate: Date;
  phases: Array<{ phase: EndoProcedurePhase; label: string; photos: ProcedurePhoto[] }>;
  totalPhotos: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Agrupa fotos por sesión (día) y dentro de cada día por fase. El orden
 * de fases respeta PHASE_ORDER, dejando vacías las que no tienen fotos
 * para que la línea temporal sea consistente.
 */
export function groupPhotosBySession(photos: ProcedurePhoto[]): SessionGroup[] {
  const map = new Map<
    string,
    { sessionDate: Date; perPhase: Map<EndoProcedurePhase, ProcedurePhoto[]> }
  >();

  for (const p of photos) {
    const dt = new Date(p.capturedAt);
    const key = dayKey(dt);
    const phase = phaseFromPhoto({ photoType: p.photoType, stage: p.stage });
    const entry =
      map.get(key) ??
      {
        sessionDate: dt,
        perPhase: new Map<EndoProcedurePhase, ProcedurePhoto[]>(),
      };
    const arr = entry.perPhase.get(phase) ?? [];
    arr.push(p);
    entry.perPhase.set(phase, arr);
    if (dt < entry.sessionDate) entry.sessionDate = dt;
    map.set(key, entry);
  }

  const groups: SessionGroup[] = [];
  map.forEach((value, sessionKey) => {
    let total = 0;
    const phases = PHASE_ORDER.map((phase) => {
      const photos = (value.perPhase.get(phase) ?? []).slice().sort(
        (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      );
      total += photos.length;
      return { phase, label: PHASE_LABEL[phase], photos };
    });
    groups.push({
      sessionKey,
      sessionDate: value.sessionDate,
      phases,
      totalPhotos: total,
    });
  });
  groups.sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
  return groups;
}

export const ENDO_CANAL_LABELS = ["MV", "ML", "MB2", "D", "DV", "DL", "P", "V", "L", "C"] as const;
export type EndoCanalLabel = (typeof ENDO_CANAL_LABELS)[number];

export function isCanalLabel(value: unknown): value is EndoCanalLabel {
  return typeof value === "string" && (ENDO_CANAL_LABELS as readonly string[]).includes(value);
}

/**
 * Las anotaciones de ClinicalPhoto son [{ x, y, label, color? }]. Si una
 * de las anotaciones tiene label = MV/ML/MB2/D/etc., la consideramos la
 * etiqueta del conducto. Si hay varias, se devuelve la primera con
 * matching válido.
 */
export function extractCanalLabel(
  annotations: Array<{ label?: string | null }> | null | undefined,
): EndoCanalLabel | null {
  if (!annotations) return null;
  for (const a of annotations) {
    if (a.label && isCanalLabel(a.label)) return a.label;
  }
  return null;
}
