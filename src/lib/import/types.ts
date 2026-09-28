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
//   POST /api/import/treatment-plans   (entity="treatmentPlans")
//   POST /api/import/odontogram        (entity="odontogram")
//   POST /api/import/treatment-notes   (entity="treatmentNotes")
//   POST /api/import/payment-history   (entity="paymentHistory")
//   POST /api/import/doctors           (entity="doctors")
//   POST /api/import/blocked-hours     (entity="blockedHours")
//   POST /api/import/appointments-history (entity="appointmentHistory")
// FormData: file, dryRun("true"|"false"), skipDuplicates, columnMapping?(JSON),
//           origin?(id del perfil de origen), valueMapping?(JSON, ver ValueMapping),
//           sheet?(nombre de la pestaña, OBLIGATORIO en un .xlsx de varias hojas: sin él,
//           el dry-run devuelve `needsSheet` con las pestañas y el commit es un 400).
//   - dryRun  → PreviewResult  (añade columns + suggestedMapping)
//   - commit  → CommitResult

/** Entidad importable. La URL/handler decide cuál. */
export type Entity =
  | "patients"
  | "balances"
  | "appointments"
  | "medicalHistory"
  | "clinicalNotes"
  | "quotes"
  | "treatmentPlans"
  | "odontogram"
  | "treatmentNotes"
  | "paymentHistory"
  // Doctores/profesionales (ws1-t12, importador Dentalink): crea o empareja
  // usuarios DOCTOR, sin invitación ni correo.
  | "doctors"
  // Bloqueos de agenda (ws1-t12, importador Dentalink): días/horas cerradas
  // del sistema anterior, sobre el modelo AgendaBlock que ya existe.
  | "blockedHours"
  // Historial de citas pasadas (ws1-t12, importador Dentalink): citas YA
  // resueltas (atendida/no asistió/cancelada) del sistema anterior. Es
  // historia de solo lectura — jamás crea una fila en Appointment ni dispara
  // recordatorios o cobros (ver src/lib/import/citas-historial/handler.ts).
  | "appointmentHistory"
  // Casos de ortodoncia migrados (ws1-t1, importador Dentalink).
  | "orthoCases"
  // Historial de gastos de laboratorio migrado (ws1-t2, importador Dentalink).
  | "labExpenseHistory"
  // Cuotas/mensualidades por vencer migradas (ws1-t6, importador Dentalink).
  | "installmentPlans"
  // Aranceles y precios migrados (ws1-t6, importador Dentalink): catálogo de procedimientos.
  | "procedureCatalog";

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
 *   treatmentPlans: name | lastName | phone | email | folio | date | title | procedure |
 *                   tooth | quantity | price | discount | total | doctor | estado |
 *                   fechaRealizado | abonado | fechaAbono | proximaVisita
 *   odontogram:     name | lastName | phone | email | patientExternalId | tooth | surface |
 *                   condition | notes
 *   treatmentNotes: name | lastName | phone | email | patientExternalId | folio | date |
 *                   doctor | title | text
 *   paymentHistory: name | lastName | phone | email | patientExternalId | externalId | amount |
 *                   method | date | doctor | description
 *   doctors:        name | lastName | email | phone | license | specialty | active
 *   blockedHours:   doctor | dateFrom | dateTo | timeFrom | timeTo | reason
 *   appointmentHistory: name | lastName | phone | email | patientExternalId | doctor | date |
 *                   time | status | type | notes
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

/**
 * Campo del valueMapping con la decisión sobre los montos ambiguos («45.000»):
 * { amountFormat: { formato: "miles" | "decimales" } }. Ver valores.ts.
 */
export const AMOUNT_FORMAT_FIELD = "amountFormat";
export const AMOUNT_FORMAT_KEY = "formato";

/**
 * ok = se importa · error = no se puede importar · duplicate = ya está (se importa de
 * todos modos SOLO si el usuario apaga «omitir duplicados») · skipped = se deja fuera
 * a propósito y NUNCA se importa (una cita pasada, algo que ya se importó antes).
 */
export type RowStatus = "ok" | "error" | "duplicate" | "skipped";

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

/** Una pestaña de un .xlsx de varias hojas, con sus primeras filas para reconocerla. */
export interface SheetInfo {
  name: string;
  /** Filas de datos (sin el encabezado). Con más de MAX_ROWS se queda en ese tope + 1. */
  rows: number;
  /** Encabezados de la pestaña. */
  columns: string[];
  /** Primeras filas, como texto, en el orden de `columns`. */
  sample: string[][];
}

/** Respuesta de dry-run (validación sin escribir). */
export interface PreviewResult {
  entity: Entity;
  total: number;
  validos: number;
  invalidos: number;
  duplicados: number;
  /** Filas que se dejan fuera a propósito (citas pasadas, ya importadas). Ausente = 0. */
  omitidos?: number;
  /**
   * El archivo tiene VARIAS pestañas: siempre las lista (con sus primeras filas) para que el
   * usuario confirme o cambie la que trae estos datos. Ausente en .csv y en libros de una hoja.
   */
  sheets?: SheetInfo[];
  /** La pestaña que propone su nombre («Saldos» para saldos), o null si ninguna se llama así. */
  suggestedSheet?: string | null;
  /** Falta que el usuario elija pestaña: no se procesó nada (columns/preview van vacíos). */
  needsSheet?: boolean;
  /** La pestaña con la que se calculó esta vista previa (solo con varias). */
  sheet?: string;
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
  /** Filas dejadas fuera a propósito, ver RowStatus "skipped". Ausente = 0. */
  omitted?: number;
  errors: { row: number; errors: string[] }[];
}
