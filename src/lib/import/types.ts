// Fuente ÚNICA de tipos del motor de importación ("Importar mi clínica").
// WS2-T2 (profiles) y WS2-T3 (UI del wizard) importan EXCLUSIVAMENTE desde aquí
// para no divergir del contrato. NO dupliques estos shapes en otro archivo.
//
// Contrato HTTP (resumen):
//   POST /api/patients/import          (entity="patients")
//   POST /api/import/balances          (entity="balances")
//   POST /api/import/appointments      (entity="appointments")
//   POST /api/import/medical-history   (entity="medicalHistory")
//   POST /api/import/clinical-notes    (entity="clinicalNotes")
//   POST /api/import/quotes            (entity="quotes")
// FormData: file, dryRun("true"|"false"), skipDuplicates, columnMapping?(JSON),
//           origin?(id del perfil de origen), valueMapping?(JSON, ver ValueMapping).
//   - dryRun  → PreviewResult  (añade columns + suggestedMapping)
//   - commit  → CommitResult

/** Entidad importable. La URL/handler decide cuál. */
export type Entity =
  | "patients"
  | "balances"
  | "appointments"
  | "medicalHistory"
  | "clinicalNotes"
  | "quotes";

/**
 * Mapeo columna(header tal cual en el archivo) -> campo canónico de la entidad.
 * El valor "" (o ausencia) significa "no importar esta columna".
 * Los campos canónicos válidos por entidad los define cada validador (entities.ts):
 *   patients:       firstName | lastName | email | phone | dob | gender | bloodType | address | notes
 *   balances:       name | lastName | phone | email | amount | type | description | date
 *   appointments:   name | phone | email | doctor | date | time | type | duration | notes
 *   medicalHistory: name | lastName | phone | email | allergies | chronicConditions |
 *                   currentMedications | familyHistory | nonPathologicalHistory
 *   clinicalNotes:  name | lastName | phone | email | date | doctor | title | text
 *   quotes:         name | lastName | phone | email | folio | date | title | procedure |
 *                   tooth | quantity | price | discount | total | status | doctor
 */
export type ColumnMapping = Record<string, string>;

/**
 * Decisión del usuario sobre valores que NO casaron con un catálogo de la
 * clínica: campo canónico → (clave normalizada del valor → id del catálogo, o
 * VALUE_UNLINKED). Hoy solo lo usa `quotes` con el campo "procedure" (el
 * tarifario), pero el shape es genérico a propósito.
 */
export type ValueMapping = Record<string, Record<string, string>>;

/** «Importar solo el importe, sin ligar a un elemento del catálogo». */
export const VALUE_UNLINKED = "__sin_ligar__";

export type RowStatus = "ok" | "error" | "duplicate";

/** Un valor de una fila que no casó con el catálogo de la clínica. */
export interface UnresolvedRef {
  /** Campo canónico al que pertenece (p. ej. "procedure"). */
  field: string;
  /** Clave normalizada: la que se devuelve en ValueMapping. */
  key: string;
  /** El valor tal cual venía en el archivo. */
  value: string;
}

/** Una fila evaluada del archivo (dry-run y commit comparten este shape). */
export interface PreviewRow {
  /** Nº de fila en el archivo (1-indexed contando el header). */
  row: number;
  /** Datos ya normalizados/tipados/resueltos de la fila. */
  data: Record<string, any>;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  /** Valores de la fila que no casaron con el catálogo (se agregan en PreviewResult.unresolved). */
  unresolved?: UnresolvedRef[];
}

/** Un valor sin equivalente, agregado sobre TODAS las filas del archivo. */
export interface UnresolvedValue extends UnresolvedRef {
  /** Cuántas filas lo traen. */
  rows: number;
}

/** Un elemento del catálogo de la clínica que el usuario puede elegir como equivalente. */
export interface ValueOption {
  id: string;
  label: string;
}

/** Respuesta de dry-run (validación sin escribir). */
export interface PreviewResult {
  entity: Entity;
  total: number;
  validos: number;
  invalidos: number;
  duplicados: number;
  /** Headers detectados en el archivo (para construir la UI de mapeo). */
  columns: string[];
  /** Autodetección header -> campo canónico (sugerencia para el mapeo). */
  suggestedMapping: ColumnMapping;
  /**
   * Primer valor no vacío de CADA columna, tal cual viene en el archivo (texto,
   * recortado). Es lo que deja emparejar a mano una columna que no reconocimos:
   * sin él, el paso de mapeo solo enseñaba ejemplos de lo ya mapeado.
   */
  samples?: Record<string, string>;
  /** Máx 200 filas (las demás se omiten del preview, pero sí cuentan en los totales). */
  preview: PreviewRow[];
  /**
   * El mapeo no alcanza (falta una columna obligatoria). En dry-run NO es un
   * 400: se devuelve junto a `columns` para que el usuario empareje a mano;
   * `preview` va vacío y los conteos en 0. En commit sí es un 400.
   */
  mappingError?: string;
  /** Valores que no casaron con el catálogo de la clínica, con cuántas filas los traen. */
  unresolved?: UnresolvedValue[];
  /** Catálogo para elegir equivalente, por campo (solo si hay `unresolved`). */
  options?: Record<string, ValueOption[]>;
}

/** Respuesta de commit (importación real). */
export interface CommitResult {
  entity: Entity;
  created: number;
  skipped: number;
  duplicates: number;
  errors: { row: number; errors: string[] }[];
}
