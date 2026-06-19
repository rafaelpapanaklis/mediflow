// Validación NOM-004 §6 para notas clínicas (expediente).
//
// Fuente ÚNICA de verdad para las tres superficies que firman/cierran una nota:
//   - PATCH /api/clinical-notes/[id]   (botón "Firmar nota")
//   - PATCH /api/appointments/[id]/complete  (cerrar consulta + firmar)
//   - POST  /api/clinical              (guardar consulta de especialidad ya firmada)
//
// Cierra el gap NOM004-CAMPOS-OBLIGATORIOS (auditoría 2026-06-17, brecha #19):
// "se puede firmar/cerrar una nota vacía". Mantener la lógica en un solo lugar
// evita el drift que la propia auditoría señala en helpers duplicados (AC-03).

/** Estados válidos del ciclo de vida de una nota (vive en specialtyData.status). */
export type NoteStatus = "DRAFT" | "SIGNED";

const TEXT_SOAP_FIELDS = ["subjective", "objective", "assessment", "plan"] as const;

// Claves de "bookkeeping" de specialtyData que NO cuentan como contenido clínico.
// `type` es solo el discriminador de especialidad (p.ej. "dental"); por sí solo
// no acredita que la nota tenga contenido.
const SPECIALTY_BOOKKEEPING_KEYS = new Set([
  "status",
  "signedAt",
  "appointmentId",
  "attachments",
  "type",
]);

export interface ClinicalNoteContent {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  /** JSON de especialidad (odontograma, procedimientos, vitals, medicamentos…). */
  specialtyData?: unknown;
}

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function isMeaningfulValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  // number / boolean / etc. → contenido.
  return true;
}

/**
 * NOM-004 §6: una nota que se va a FIRMAR/CERRAR no puede estar vacía.
 *
 * Consideramos "vacía" cuando NO hay ningún contenido clínico: ni texto SOAP
 * (subjective/objective/assessment/plan) ni datos de especialidad significativos
 * en `specialtyData` (más allá de las claves de bookkeeping).
 *
 * Floor deliberadamente conservador ("no vacía") en lugar de exigir un campo
 * puntual obligatorio (p.ej. diagnóstico CIE-10): las ~20 formas de especialidad
 * guardan su contenido en `specialtyData`, así que exigir un campo SOAP concreto
 * rechazaría notas legítimas (dental con odontograma, estética con procedimientos,
 * etc.). Endurecer a "diagnóstico obligatorio" es follow-up junto con CAT-CIE10-03.
 */
export function isClinicalNoteEmpty(note: ClinicalNoteContent): boolean {
  for (const f of TEXT_SOAP_FIELDS) {
    if (hasText(note[f])) return false;
  }
  const spec = note.specialtyData;
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
      if (SPECIALTY_BOOKKEEPING_KEYS.has(key)) continue;
      if (isMeaningfulValue(value)) return false;
    }
  }
  return true;
}

/** Mensaje único (es-MX) para el 422 al intentar firmar/cerrar una nota vacía. */
export const EMPTY_NOTE_ERROR =
  "No se puede firmar/cerrar una nota clínica vacía: captura al menos el contenido de la consulta (NOM-004 §6, campos mínimos del expediente).";

/**
 * Normaliza el status pedido por el cliente al conjunto válido {DRAFT, SIGNED}.
 * Cualquier valor desconocido (o ausente) cae a DRAFT — una nota SIEMPRE nace
 * con status (cierra NOM004-INALTERABILIDAD: "nace sin status" vía /api/clinical).
 */
export function normalizeNoteStatus(requested: unknown): NoteStatus {
  return requested === "SIGNED" ? "SIGNED" : "DRAFT";
}
