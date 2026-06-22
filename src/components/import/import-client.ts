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

export type Entity = "patients" | "balances" | "appointments";

/** Mapa columna-del-archivo → campo de DaleControl (valor "" = sin importar). */
export type ColumnMapping = Record<string, string>;

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
  status: "ok" | "error" | "duplicate";
  /** Motivo del error/duplicado (se muestra en tooltip). */
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
  stats: { valid: number; errors: number; duplicates: number };
  /** Muestra de filas validadas para la tabla del paso 6. */
  rows: PreviewRow[];
}

export interface CommitResult {
  created: number;
  errors: number;
  duplicates: number;
  /** Resumen para las "pills" de la pantalla de resultado. */
  summary: { patients: number; balances: string; appointments: number };
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
  ): Promise<PreviewResult>;
  commit(
    entity: Entity,
    file: File,
    mapping: ColumnMapping,
    opts: { skipDuplicates: boolean },
    onProgress?: OnUploadProgress,
  ): Promise<CommitResult>;
  templateUrl(): string;
  submitAssisted(file: File, note: string): Promise<AssistedResult>;
}

// ---------------------------------------------------------------------------
// Catálogo de orígenes (paso 1). Los 9 con perfil + Excel/Otro manuales.
// ---------------------------------------------------------------------------
export const ORIGINS: Origin[] = [
  { id: "dentalink", name: "Dentalink", color: "#0ea5e9", hasProfile: true },
  { id: "medilink", name: "Medilink", color: "#14b8a6", hasProfile: true },
  { id: "identalsoft", name: "iDentalSoft", color: "#f97316", hasProfile: true },
  { id: "opendental", name: "Open Dental", color: "#16a34a", hasProfile: true },
  { id: "dentrix", name: "Dentrix", color: "#2563eb", hasProfile: true },
  { id: "eaglesoft", name: "Eaglesoft", color: "#7c3aed", hasProfile: true },
  { id: "gesden", name: "Gesden", color: "#dc2626", hasProfile: true },
  { id: "dentidesk", name: "Dentidesk", color: "#0891b2", hasProfile: true },
  { id: "dentalcore", name: "DentalCore", color: "#db2777", hasProfile: true },
  { id: "excel", name: "Mi Excel", color: "#15803d", hasProfile: false, glyph: "XLS" },
  { id: "otro", name: "Otro", color: "#6b7280", hasProfile: false, glyph: "?" },
];

/** Inicial/glyph del logo de un origen. */
export function originGlyph(o: Origin): string {
  return o.glyph ?? o.name.charAt(0);
}

// ---------------------------------------------------------------------------
// Tipos de dato a importar (paso 3). `entity` mapea al contrato Entity cuando
// aplica; los avanzados (tratamientos/historial) no tienen Entity propio aún.
// ---------------------------------------------------------------------------
export interface DataType {
  id: string;
  /** Clave i18n del nombre, bajo shell.importClinic.what.*. */
  labelKey: string;
  descKey: string;
  icon: "users" | "money" | "calendar" | "stack" | "file";
  badge: "rec" | "easy" | "adv";
  /** Seleccionado por defecto. */
  on: boolean;
  entity?: Entity;
}

export const DATA_TYPES: DataType[] = [
  { id: "pacientes", labelKey: "patients", descKey: "patientsMeta", icon: "users", badge: "rec", on: true, entity: "patients" },
  { id: "saldos", labelKey: "balances", descKey: "balancesMeta", icon: "money", badge: "easy", on: true, entity: "balances" },
  { id: "citas", labelKey: "appointments", descKey: "appointmentsMeta", icon: "calendar", badge: "easy", on: true, entity: "appointments" },
  { id: "tratamientos", labelKey: "treatments", descKey: "treatmentsMeta", icon: "stack", badge: "adv", on: false },
  { id: "historial", labelKey: "history", descKey: "historyMeta", icon: "file", badge: "adv", on: false },
];

// Límites de archivo del paso 4.
export const MAX_FILE_MB = 5;
export const ACCEPTED_EXT = [".xlsx", ".csv"];

export function isAcceptedFile(f: File): boolean {
  const name = f.name.toLowerCase();
  return ACCEPTED_EXT.some((ext) => name.endsWith(ext));
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
    opts: { skipDuplicates: boolean },
    _onProgress?: OnUploadProgress,
  ): Promise<CommitResult> {
    return delay({
      created: 1240,
      errors: 18,
      duplicates: opts.skipDuplicates ? 7 : 0,
      summary: { patients: 1240, balances: "$340,000", appointments: 85 },
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
