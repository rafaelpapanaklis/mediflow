// ============================================================================
// "Importar mi clínica" — capa de datos del wizard (CONTRATO de frontend).
//
// WS2-T3 define este contrato; WS2-T4 implementará el cliente REAL contra las
// APIs (`src/lib/import/client.ts`, NO existe aún). El wizard depende SOLO de
// la interfaz `ImportClient`; recibe una instancia por prop (default = Mock).
// Esto deja el wiring de datos en UN solo punto de inyección.
//
// El Mock devuelve exactamente las cifras/filas del prototipo de diseño para
// que el flujo sea navegable de punta a punta sin backend.
// ============================================================================

// Entidad y mapeos: los del contrato del motor (src/lib/import/types.ts), no
// una copia — una entidad nueva allí aparece aquí sola.
import type { ColumnMapping, Entity, SheetInfo, UnresolvedValue, ValueMapping, ValueOption } from "@/lib/import/types";
export type { Entity, ColumnMapping, SheetInfo, ValueMapping, UnresolvedValue, ValueOption } from "@/lib/import/types";
export { VALUE_UNLINKED } from "@/lib/import/types";

/**
 * Progreso REAL de subida del archivo, tal cual lo reporta `xhr.upload.onprogress`
 * (bytes ya enviados / totales). `pct` es 0..100 entero. Solo mide la SUBIDA; el
 * procesamiento del servidor no expone progreso por fila y se muestra aparte como
 * "Procesando…".
 */
export interface UploadProgressEvent {
  loaded: number;
  total: number;
  pct: number;
}
export type OnUploadProgress = (p: UploadProgressEvent) => void;

/** Sistema de origen (paso 1). `hasProfile` = auto-mapeo + instrucciones propias. */
export interface Origin {
  id: string;
  name: string;
  /** Color de marca del logo (fijo, no depende del tema). */
  color: string;
  /** Con perfil → instrucciones específicas + mapeo automático en paso 5. */
  hasProfile: boolean;
  /**
   * El perfil se validó contra un export REAL de ese sistema. `false` (o ausente en un
   * origen con perfil) = mapeo estimado: la interfaz avisa y exige revisar la vista previa.
   */
  verified?: boolean;
  /** Texto del logo cuadrado; si falta, se usa la inicial del nombre. */
  glyph?: string;
}

/** Columna detectada en el archivo subido (paso 5 · mapear). */
export interface DetectedColumn {
  /** Encabezado tal cual viene en el archivo del usuario. */
  source: string;
  /** Valor de muestra de la primera fila, para dar contexto. */
  sample: string;
  /** Campo de DaleControl sugerido por el perfil del origen (si lo hay). */
  suggestion?: string;
}

/** Campo destino de DaleControl al que se puede mapear una columna. */
export interface TargetField {
  value: string;
  label: string;
  /** Clave i18n opcional; si está, la UI la traduce y `label` queda solo de fallback. */
  labelKey?: string;
}

/** Fila de muestra validada para la pantalla de revisión (paso 6). */
export interface PreviewRow {
  row: number;
  name: string;
  phone: string;
  balance: string;
  /** Solo en saldos: "credit" = a favor (verde), "debt" = adeudo. */
  kind?: "debt" | "credit";
  /** Solo en citas: fecha y hora EN LA ZONA DE LA CLÍNICA («15/01/2030 15:30»). */
  when?: string;
  /** Solo en citas: el doctor tal como lo dice el archivo. */
  doctor?: string;
  /** Solo en citas: minutos de duración. */
  duration?: number;
  /** Resumen de la fila para las entidades sin saldo (nota: fecha y título; presupuesto: procedimiento e importe). */
  detail?: string;
  status: "ok" | "error" | "duplicate" | "skipped";
  /** Motivo del error/duplicado/omisión (se muestra en tooltip). */
  reason?: string;
}

export interface PreviewResult {
  /** Total de filas detectadas en el archivo. */
  totalRows: number;
  /** Columnas detectadas + sugerencia de mapeo (para el paso 5). */
  columns: DetectedColumn[];
  /** Campos destino disponibles en DaleControl (para los selects del paso 5). */
  targetFields: TargetField[];
  /** Conteos para las stat-cards del paso 6. */
  stats: { valid: number; errors: number; duplicates: number; omitted?: number };
  /** Muestra de filas validadas para la tabla del paso 6. */
  rows: PreviewRow[];
  /** Solo en citas: la zona horaria de la clínica en la que se enseñan las horas. */
  timezone?: string;
  /** El archivo trae varias pestañas: el paso 5 pide confirmar cuál (nunca toma la primera). */
  sheets?: SheetInfo[];
  /** La pestaña que propone el nombre, o null si ninguna se llama como estos datos. */
  suggestedSheet?: string | null;
  /** Falta elegir pestaña: todavía no hay columnas ni filas que revisar. */
  needsSheet?: boolean;
  /** La pestaña con la que se calculó esta vista previa. */
  sheet?: string;
  /** Falta emparejar una columna obligatoria: el paso 5 lo pide en vez de fallar. */
  mappingError?: string;
  /** Valores sin equivalente en el catálogo de la clínica (hoy: procedimientos). */
  unresolved?: UnresolvedValue[];
  /** Catálogo para elegir equivalente, por campo. */
  options?: Record<string, ValueOption[]>;
}

export interface CommitResult {
  created: number;
  errors: number;
  duplicates: number;
  /** Filas dejadas fuera a propósito (citas pasadas, ya importadas). */
  omitted?: number;
  /** Resumen para las "pills" de la pantalla de resultado: creados por entidad importada. */
  summary: Partial<Record<Entity, number>>;
  /** URL del reporte de errores descargable (TODO(T4): generar real). */
  errorReportUrl?: string;
}

export interface AssistedResult {
  ok: boolean;
  ticketId?: string;
}

/**
 * Contrato que el wizard consume. WS2-T4 entrega la implementación real;
 * hasta entonces se usa `MockImportClient`.
 */
export interface ImportClient {
  getOrigins(): Promise<Origin[]>;
  preview(
    entity: Entity,
    file: File,
    mapping?: ColumnMapping,
    onProgress?: OnUploadProgress,
    /**
     * `origin`: id del sistema elegido en el paso 1 (el backend aplica su perfil).
     * `valueMapping`: decisiones ya tomadas (p. ej. cómo leer los montos ambiguos), para
     * que la vista previa refleje lo que se va a importar.
     */
    opts?: { origin?: string | null; valueMapping?: ValueMapping; sheet?: string | null },
  ): Promise<PreviewResult>;
  commit(
    entity: Entity,
    file: File,
    mapping: ColumnMapping,
    opts: { skipDuplicates: boolean; origin?: string | null; valueMapping?: ValueMapping; sheet?: string | null },
    onProgress?: OnUploadProgress,
  ): Promise<CommitResult>;
  templateUrl(): string;
  submitAssisted(file: File, note: string): Promise<AssistedResult>;
}

// ---------------------------------------------------------------------------
// Catálogo de orígenes (paso 1). Los 9 con perfil + Excel/Otro manuales.
// ---------------------------------------------------------------------------
export const ORIGINS: Origin[] = [
  { id: "dentalink", name: "Dentalink", color: "#0ea5e9", hasProfile: true, verified: false },
  { id: "medilink", name: "Medilink", color: "#14b8a6", hasProfile: true, verified: false },
  { id: "identalsoft", name: "iDentalSoft", color: "#f97316", hasProfile: true, verified: false },
  { id: "opendental", name: "Open Dental", color: "#16a34a", hasProfile: true, verified: false },
  { id: "dentrix", name: "Dentrix", color: "#2563eb", hasProfile: true, verified: false },
  { id: "eaglesoft", name: "Eaglesoft", color: "#7c3aed", hasProfile: true, verified: false },
  { id: "gesden", name: "Gesden", color: "#dc2626", hasProfile: true, verified: false },
  { id: "dentidesk", name: "Dentidesk", color: "#0891b2", hasProfile: true, verified: false },
  { id: "dentalcore", name: "DentalCore", color: "#db2777", hasProfile: true, verified: false },
  { id: "excel", name: "Mi Excel", color: "#15803d", hasProfile: false, glyph: "XLS" },
  { id: "otro", name: "Otro", color: "#6b7280", hasProfile: false, glyph: "?" },
];

/** Inicial/glyph del logo de un origen. */
export function originGlyph(o: Origin): string {
  return o.glyph ?? o.name.charAt(0);
}

// ---------------------------------------------------------------------------
// Tipos de dato a importar (paso 3), en el ORDEN en que se importan: pacientes
// primero, porque todo lo demás se empareja con un paciente que ya existe.
// ---------------------------------------------------------------------------
export interface DataType {
  id: string;
  /** Clave i18n del nombre, bajo shell.importClinic.step3.*. */
  labelKey: string;
  descKey: string;
  icon: "users" | "money" | "calendar" | "stack" | "file" | "clipboard" | "activity";
  badge: "rec" | "easy" | "adv";
  /** Seleccionado por defecto. */
  on: boolean;
  entity: Entity;
  /**
   * Se importa SOLO, con su propia vista previa. Lo clínico no puede colarse
   * como entidad secundaria (esas se importan sin revisión, autodetectando
   * columnas): un CSV de pacientes con «Fecha» y «Notas» acabaría en notas de
   * evolución que nadie vio.
   */
  solo?: boolean;
}

/** Entidades clínicas: van solas y nunca reimportan duplicados (ver entities.ts). */
export const CLINICAL_ENTITIES: ReadonlySet<Entity> = new Set<Entity>([
  "medicalHistory", "clinicalNotes", "quotes", "treatmentPlans", "odontogram", "treatmentNotes",
]);

export const DATA_TYPES: DataType[] = [
  { id: "pacientes", labelKey: "patients", descKey: "patientsMeta", icon: "users", badge: "rec", on: true, entity: "patients" },
  // Saldos y citas van SOLOS, con su propia vista previa: son dinero y mensajes a pacientes.
  // Importados como secundarios de otro archivo se autodetectaban y entraban SIN que nadie
  // viera una sola fila (la revisión del paso 6 es la de la entidad principal).
  { id: "saldos", labelKey: "balances", descKey: "balancesMeta", icon: "money", badge: "easy", on: false, entity: "balances", solo: true },
  { id: "citas", labelKey: "appointments", descKey: "appointmentsMeta", icon: "calendar", badge: "easy", on: false, entity: "appointments", solo: true },
  { id: "expedientes", labelKey: "medicalHistory", descKey: "medicalHistoryMeta", icon: "clipboard", badge: "adv", on: false, entity: "medicalHistory", solo: true },
  { id: "notas", labelKey: "clinicalNotes", descKey: "clinicalNotesMeta", icon: "file", badge: "adv", on: false, entity: "clinicalNotes", solo: true },
  { id: "presupuestos", labelKey: "quotes", descKey: "quotesMeta", icon: "stack", badge: "adv", on: false, entity: "quotes", solo: true },
  // Tratamientos activos: como presupuestos, pero entra VIVO (plan continuable +
  // factura + abonos). Va solo, con su propia revisión (dinero + plan clínico).
  { id: "tratamientosactivos", labelKey: "treatmentPlans", descKey: "treatmentPlansMeta", icon: "activity", badge: "adv", on: false, entity: "treatmentPlans", solo: true },
  // Odontograma: el estado por pieza/cara del odontograma vivo (odontogram_entries).
  { id: "odontograma", labelKey: "odontogram", descKey: "odontogramMeta", icon: "clipboard", badge: "adv", on: false, entity: "odontogram", solo: true },
  // Notas de evolución de tratamiento: como notas de evolución, pero se ligan a
  // la sesión del tratamiento activo importado cuando el folio casa con uno.
  { id: "notastratamiento", labelKey: "treatmentNotes", descKey: "treatmentNotesMeta", icon: "file", badge: "adv", on: false, entity: "treatmentNotes", solo: true },
];

// Límites de archivo del paso 4.
export const MAX_FILE_MB = 5;
export const ACCEPTED_EXT = [".xlsx", ".csv"];

export function isAcceptedFile(f: File): boolean {
  const name = f.name.toLowerCase();
  return ACCEPTED_EXT.some((ext) => name.endsWith(ext));
}

// ---------------------------------------------------------------------------
// "Subir varios archivos a la vez" (WS1-T12) — detección automática de QUÉ ES
// cada archivo/pestaña, POST /api/import/detect. Ver MultiImportWizard.
// ---------------------------------------------------------------------------
export const MAX_BATCH_FILES = 12;
export const MAX_BATCH_MB = 40;

export type Confidence = "alta" | "media" | "baja";

/** Una entidad candidata para un archivo/pestaña, con su puntaje (solo sirve para ordenar). */
export interface DetectGuess {
  entity: Entity;
  score: number;
  confianza: Confidence;
  requiredOk: boolean;
}

/** Un archivo, o UNA pestaña de un .xlsx con varias (cada una cuenta como un archivo aparte). */
export interface DetectedFileItem {
  fileIndex: number;
  fileName: string;
  sheetName: string | null;
  columns: string[];
  sample: string[][];
  rows: number;
  guesses: DetectGuess[];
  /** null = "sin identificar": el usuario debe elegir la entidad a mano antes de continuar. */
  suggestedEntity: Entity | null;
  suggestedConfidence: Confidence | null;
  /** Posición en el orden de importación por dependencia (pacientes primero…). */
  order: number;
}

/** Un archivo que ni siquiera se pudo leer (no aborta el lote: el resto sigue). */
export interface DetectFileError {
  fileIndex: number;
  fileName: string;
  error: string;
}

export interface DetectBatchResult {
  items: DetectedFileItem[];
  errors: DetectFileError[];
  /** El orden de dependencia completo (para explicarlo en la UI). */
  order: Entity[];
}

// ---------------------------------------------------------------------------
// Implementación SIMULADA. Cifras/filas idénticas al prototipo de diseño.
// ---------------------------------------------------------------------------
const TARGET_FIELDS: TargetField[] = [
  { value: "", label: "— Sin importar —" },
  { value: "nombre", label: "Nombre completo" },
  { value: "telefono", label: "Teléfono" },
  { value: "email", label: "Correo electrónico" },
  { value: "nacimiento", label: "Fecha de nacimiento" },
  { value: "saldo", label: "Saldo" },
  { value: "rfc", label: "RFC" },
  { value: "direccion", label: "Dirección" },
];

const SAMPLE_COLUMNS: DetectedColumn[] = [
  { source: "Nombre del paciente", sample: "María González R.", suggestion: "nombre" },
  { source: "Celular", sample: "55 1234 5678", suggestion: "telefono" },
  { source: "Correo", sample: "maria@correo.com", suggestion: "email" },
  { source: "F. Nacimiento", sample: "14/03/1988", suggestion: "nacimiento" },
  { source: "Saldo $", sample: "1,250.00", suggestion: "saldo" },
  { source: "Notas internas", sample: "Alérgica a penicilina", suggestion: "" },
];

const SAMPLE_ROWS: PreviewRow[] = [
  { row: 1, name: "María González Ramírez", phone: "55 1234 5678", balance: "$1,250", status: "ok" },
  { row: 2, name: "Jorge Hernández L.", phone: "55 8765 4321", balance: "$0", status: "ok" },
  { row: 3, name: "Ana Patricia Ruiz", phone: "—", balance: "$3,400", status: "error", reason: "Teléfono vacío" },
  { row: 4, name: "Luis Martínez", phone: "55 2222 1111", balance: "$890", status: "ok" },
  { row: 5, name: "María González Ramírez", phone: "55 1234 5678", balance: "$1,250", status: "duplicate", reason: "Ya existe (fila 1)" },
  { row: 6, name: "Carlos S.", phone: "abc-123", balance: "$0", status: "error", reason: "Teléfono inválido" },
  { row: 7, name: "Diana Flores", phone: "55 9090 8080", balance: "$2,100", status: "ok" },
  { row: 8, name: "Roberto Cruz", phone: "55 3344 5566", balance: "—", status: "duplicate", reason: "Ya existe (fila 4)" },
];

function delay<T>(value: T, ms = 450): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * Cliente simulado para desarrollo/QA del wizard. NO toca el backend.
 * TODO(T4): reemplazar por el cliente real (descarga de plantilla multi-pestaña,
 * preview/commit contra /api/import, reporte de errores real, ticket asistido).
 */
export class MockImportClient implements ImportClient {
  getOrigins(): Promise<Origin[]> {
    return delay(ORIGINS, 120);
  }

  preview(
    _entity: Entity,
    _file: File,
    _mapping?: ColumnMapping,
    _onProgress?: OnUploadProgress,
    _opts?: { origin?: string | null; valueMapping?: ValueMapping; sheet?: string | null },
  ): Promise<PreviewResult> {
    return delay({
      totalRows: 1265,
      columns: SAMPLE_COLUMNS,
      targetFields: TARGET_FIELDS,
      stats: { valid: 1240, errors: 18, duplicates: 7 },
      rows: SAMPLE_ROWS,
    });
  }

  commit(
    _entity: Entity,
    _file: File,
    _mapping: ColumnMapping,
    opts: { skipDuplicates: boolean; origin?: string | null; valueMapping?: ValueMapping; sheet?: string | null },
    _onProgress?: OnUploadProgress,
  ): Promise<CommitResult> {
    return delay({
      created: 1240,
      errors: 18,
      duplicates: opts.skipDuplicates ? 7 : 0,
      summary: { patients: 1240, balances: 312, appointments: 85 },
      // TODO(T4): URL real del reporte de errores generado en el commit.
      errorReportUrl: undefined,
    });
  }

  templateUrl(): string {
    // TODO(T4): plantilla multi-pestaña (Pacientes/Saldos/Citas). Por ahora
    // reusa el endpoint existente de plantilla de pacientes.
    return "/api/patients/import/template";
  }

  submitAssisted(_file: File, _note: string): Promise<AssistedResult> {
    return delay({ ok: true, ticketId: "DC-1042" }, 700);
  }
}
