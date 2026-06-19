// ─────────────────────────────────────────────────────────────────────────────
// persistence.ts — Persistencia del visor CBCT rediseñado (WS2-T7).
//
// Mapea las anotaciones (Anno[]) y la nota del estudio (string) del visor contra
// el PatientFile del SET CBCT, vía la API existente que valida clinicId/patientId
// en el SERVIDOR (multi-tenant: el cliente NUNCA define la clínica). Las
// anotaciones del SET CBCT son su PROPIO `annotations`; NO tocan las anotaciones
// Pin3D de las mallas STL (que viven en otro PatientFile / Model3DViewer).
//
//   PATCH /api/patients/[id]/models-3d/[fileId]
//     { annotations: Anno[] }   → marcas del visor (array; puede ir vacío)
//     { doctorNotes: string }   → nota clínica del estudio
// ─────────────────────────────────────────────────────────────────────────────

import type { Anno, AnnoType } from "./types";

const ANNO_TYPES: Record<AnnoType, true> = {
  distancia: true,
  angulo: true,
  anotacion: true,
  canal: true,
  implante: true,
};

function isPt(v: any): boolean {
  return !!v && typeof v.x === "number" && typeof v.y === "number";
}

/**
 * Normaliza el `annotations` crudo del PatientFile (Json de tipo desconocido) a
 * Anno[] válido para el visor. DEFENSIVO: descarta lo que no cuadre con el
 * contrato (tipo/id/plane/puntos), para no romper el visor con datos legados o
 * de otra superficie. Devuelve [] si no es un array.
 */
export function parseInitialAnnos(raw: unknown): Anno[] {
  if (!Array.isArray(raw)) return [];
  const out: Anno[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a: any = raw[i];
    if (!a || typeof a !== "object") continue;
    if (!a.type || !(a.type in ANNO_TYPES)) continue;
    if (typeof a.id !== "string" || typeof a.plane !== "string") continue;
    // Validación por tipo de la forma de `points` / campos clave.
    if (a.type === "distancia" && !(Array.isArray(a.points) && a.points.length === 2 && a.points.every(isPt))) continue;
    if (a.type === "angulo" && !(Array.isArray(a.points) && a.points.length === 3 && a.points.every(isPt))) continue;
    if (a.type === "anotacion" && !(Array.isArray(a.points) && a.points.length >= 1 && isPt(a.points[0]))) continue;
    if (a.type === "canal" && !(Array.isArray(a.points) && a.points.length >= 1 && a.points.every(isPt))) continue;
    if (a.type === "implante" && !isPt(a.p)) continue;
    out.push(a as Anno);
  }
  return out;
}

async function patchFile(
  patientId: string,
  fileId: string,
  body: { annotations?: Anno[]; doctorNotes?: string },
): Promise<void> {
  const res = await fetch(`/api/patients/${patientId}/models-3d/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = "No se pudo guardar";
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* sin cuerpo JSON: deja el mensaje por defecto */
    }
    throw new Error(msg);
  }
}

/** Persiste las marcas (anotaciones) del SET CBCT. Lanza si la API falla. */
export function saveAnnos(patientId: string, fileId: string, annos: Anno[]): Promise<void> {
  return patchFile(patientId, fileId, { annotations: annos });
}

/** Persiste la nota clínica del estudio. Lanza si la API falla. */
export function saveNotes(patientId: string, fileId: string, notes: string): Promise<void> {
  return patchFile(patientId, fileId, { doctorNotes: notes });
}

/** Handlers listos para <CbctViewer/> (onGuardarHallazgos / onGuardarNota). */
export function makeCbctHandlers(patientId: string, fileId: string) {
  return {
    onGuardarHallazgos: (annos: Anno[]) => saveAnnos(patientId, fileId, annos),
    onGuardarNota: (notes: string) => saveNotes(patientId, fileId, notes),
  };
}
