// Fuente ÚNICA de tipos del motor de importación ("Importar mi clínica").
// WS2-T2 (profiles) y WS2-T3 (UI del wizard) importan EXCLUSIVAMENTE desde aquí
// para no divergir del contrato. NO dupliques estos shapes en otro archivo.
//
// Contrato HTTP (resumen):
//   POST /api/patients/import        (entity="patients")
//   POST /api/import/balances        (entity="balances")
//   POST /api/import/appointments    (entity="appointments")
// FormData: file, dryRun("true"|"false"), skipDuplicates, columnMapping?(JSON).
//   - dryRun  → PreviewResult  (añade columns + suggestedMapping)
//   - commit  → CommitResult

/** Entidad importable. La URL/handler decide cuál. */
export type Entity = "patients" | "balances" | "appointments";

/**
 * Mapeo columna(header tal cual en el archivo) -> campo canónico de la entidad.
 * El valor "" (o ausencia) significa "no importar esta columna".
 * Los campos canónicos válidos por entidad los define cada validador (entities.ts):
 *   patients:     firstName | lastName | email | phone | dob | gender | bloodType | address | notes
 *   balances:     name | phone | email | amount
 *   appointments: name | phone | email | doctor | date | time | type | duration | notes
 */
export type ColumnMapping = Record<string, string>;

export type RowStatus = "ok" | "error" | "duplicate";

/** Una fila evaluada del archivo (dry-run y commit comparten este shape). */
export interface PreviewRow {
  /** Nº de fila en el archivo (1-indexed contando el header). */
  row: number;
  /** Datos ya normalizados/tipados/resueltos de la fila. */
  data: Record<string, any>;
  status: RowStatus;
  errors: string[];
  warnings: string[];
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
  /** Máx 200 filas (las demás se omiten del preview, pero sí cuentan en los totales). */
  preview: PreviewRow[];
}

/** Respuesta de commit (importación real). */
export interface CommitResult {
  entity: Entity;
  created: number;
  skipped: number;
  duplicates: number;
  errors: { row: number; errors: string[] }[];
}
