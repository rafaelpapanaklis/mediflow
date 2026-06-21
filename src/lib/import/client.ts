// ============================================================================
// "Importar mi clínica" — CLIENTE REAL (adaptador) · WS2-T4.
//
// Implementa el contrato del wizard `ImportClient`
// (src/components/import/import-client.ts) hablando con las APIs reales del motor
// de importación. Es un ADAPTADOR, NO un passthrough: el backend
// (src/lib/import/types.ts + entities.ts) y la UI (import-client.ts) usan shapes
// DISTINTOS a propósito; aquí se TRADUCE entre ambos sin tocar ninguno.
//
// Claves de la traducción:
//  · Mapeo de columnas → la UI produce { header → CAMPO CANÓNICO } y eso es justo
//    lo que el backend espera (columnMapping). Por eso `targetFields` usa los
//    campos canónicos REALES de cada entidad (firstName/lastName/phone/amount/
//    doctor/date…), no las etiquetas del mock (nombre/telefono/saldo).
//  · PreviewResult/CommitResult del backend → al shape que consume el wizard.
//
// Multi-tenant: el backend resuelve clinicId desde la sesión (cookie); este
// cliente solo hace fetch same-origin (la cookie viaja sola).
// ============================================================================

import {
  type ImportClient,
  type Entity,
  type Origin,
  type ColumnMapping,
  type PreviewResult,
  type CommitResult,
  type AssistedResult,
  type DetectedColumn,
  type TargetField,
  type PreviewRow,
  ORIGINS,
} from "@/components/import/import-client";
import type {
  PreviewResult as BackendPreviewResult,
  CommitResult as BackendCommitResult,
  PreviewRow as BackendPreviewRow,
} from "@/lib/import/types";

// Forma pública de GET /api/import/origins (superset del contrato; el wizard solo
// necesita id/name/hasProfile, y le añadimos color/glyph desde el catálogo local).
interface BackendOrigin {
  id: string;
  name: string;
  hasProfile: boolean;
  verified?: boolean;
  instructions?: unknown;
  mapping?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Campos canónicos REALES por entidad (espejo de los validadores en
// src/lib/import/entities.ts · headerVariants). Se declaran aquí —y no se importa
// entities.ts— porque ese módulo arrastra Prisma (server-only) y este cliente
// vive en el bundle del navegador. El comentario de types.ts documenta el mismo
// contrato, así que es estable.
//   patients:     firstName | lastName | email | phone | dob | gender | bloodType | address | notes
//   balances:     name | phone | email | amount
//   appointments: name | phone | email | doctor | date | time | type | duration | notes
// ---------------------------------------------------------------------------
// Las etiquetas llevan `labelKey` (shell.importClinic.fields.*) para que el paso 5
// (Mapear) se muestre en el idioma activo; `label` queda como fallback en español.
const NO_IMPORT: TargetField = { value: "", label: "— Sin importar —", labelKey: "shell.importClinic.fields.noImport" };

const CANONICAL_FIELDS: Record<Entity, TargetField[]> = {
  patients: [
    NO_IMPORT,
    { value: "firstName", label: "Nombre", labelKey: "shell.importClinic.fields.firstName" },
    { value: "lastName", label: "Apellido", labelKey: "shell.importClinic.fields.lastName" },
    { value: "phone", label: "Teléfono", labelKey: "shell.importClinic.fields.phone" },
    { value: "email", label: "Correo electrónico", labelKey: "shell.importClinic.fields.email" },
    { value: "dob", label: "Fecha de nacimiento", labelKey: "shell.importClinic.fields.dob" },
    { value: "gender", label: "Género", labelKey: "shell.importClinic.fields.gender" },
    { value: "bloodType", label: "Tipo de sangre", labelKey: "shell.importClinic.fields.bloodType" },
    { value: "address", label: "Dirección", labelKey: "shell.importClinic.fields.address" },
    { value: "notes", label: "Notas", labelKey: "shell.importClinic.fields.notes" },
  ],
  balances: [
    NO_IMPORT,
    { value: "name", label: "Nombre del paciente", labelKey: "shell.importClinic.fields.name" },
    { value: "phone", label: "Teléfono", labelKey: "shell.importClinic.fields.phone" },
    { value: "email", label: "Correo electrónico", labelKey: "shell.importClinic.fields.email" },
    { value: "amount", label: "Saldo / Monto", labelKey: "shell.importClinic.fields.amount" },
  ],
  appointments: [
    NO_IMPORT,
    { value: "name", label: "Nombre del paciente", labelKey: "shell.importClinic.fields.name" },
    { value: "phone", label: "Teléfono", labelKey: "shell.importClinic.fields.phone" },
    { value: "email", label: "Correo electrónico", labelKey: "shell.importClinic.fields.email" },
    { value: "doctor", label: "Doctor / Profesional", labelKey: "shell.importClinic.fields.doctor" },
    { value: "date", label: "Fecha", labelKey: "shell.importClinic.fields.date" },
    { value: "time", label: "Hora", labelKey: "shell.importClinic.fields.time" },
    { value: "type", label: "Tipo / Motivo", labelKey: "shell.importClinic.fields.type" },
    { value: "duration", label: "Duración (min)", labelKey: "shell.importClinic.fields.duration" },
    { value: "notes", label: "Notas", labelKey: "shell.importClinic.fields.notes" },
  ],
};

const ENDPOINTS: Record<Entity, string> = {
  patients: "/api/patients/import",
  balances: "/api/import/balances",
  appointments: "/api/import/appointments",
};

const PREVIEW_TIMEOUT_MS = 60_000;
const ORIGINS_TIMEOUT_MS = 15_000;
const MAX_PREVIEW_ROWS = 100; // muestra para la tabla del paso 6 (backend ya capa a 200)

// ---------------------------------------------------------------------------
// Helpers de formato (Spanish-friendly).
// ---------------------------------------------------------------------------

/** Formatea un monto a moneda MXN. Tolerante: si falla, antepone "$". */
function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  try {
    return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
  } catch {
    return `$${n.toLocaleString()}`;
  }
}

/**
 * Texto de muestra para una columna. Tras pasar por JSON, las fechas llegan como
 * ISO (Date ya no existe); se re-formatean a dd/mm/aaaa para que se lean bien.
 */
function sampleText(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s;
}

/** Nombre legible de una fila de preview a partir de su `data` (cualquier entidad). */
function rowName(data: Record<string, any>): string {
  const full = [data.firstName, data.lastName].filter(Boolean).join(" ").trim();
  const name = data.name || full || data.patientName || data.fullName;
  return name ? String(name) : "—";
}

/** Motivo (tooltip) de una fila: error primero, si no, advertencia. */
function rowReason(row: BackendPreviewRow): string | undefined {
  if (row.errors && row.errors.length) return row.errors.join(" · ");
  if (row.warnings && row.warnings.length) return row.warnings.join(" · ");
  return undefined;
}

// ---------------------------------------------------------------------------
// Cliente real.
// ---------------------------------------------------------------------------

export class RealImportClient implements ImportClient {
  // -- Catálogo de orígenes ----------------------------------------------------
  // GET /api/import/origins (id/name/hasProfile) + catálogo local (color/glyph).
  // Si el endpoint falla, cae al catálogo local para que el wizard nunca quede sin
  // orígenes que mostrar.
  async getOrigins(): Promise<Origin[]> {
    try {
      const res = await fetchWithTimeout(
        "/api/import/origins",
        { method: "GET", headers: { Accept: "application/json" } },
        ORIGINS_TIMEOUT_MS,
      );
      if (!res.ok) return ORIGINS;
      const backend = (await res.json()) as BackendOrigin[];
      if (!Array.isArray(backend) || backend.length === 0) return ORIGINS;

      const local = new Map(ORIGINS.map((o) => [o.id, o]));
      return backend.map((b) => {
        const l = local.get(b.id);
        return {
          id: b.id,
          name: b.name,
          color: l?.color ?? "#6b7280",
          hasProfile: !!b.hasProfile,
          glyph: l?.glyph,
        };
      });
    } catch {
      return ORIGINS;
    }
  }

  // -- Vista previa (dry-run) ---------------------------------------------------
  async preview(entity: Entity, file: File, mapping?: ColumnMapping): Promise<PreviewResult> {
    const backend = (await this.post(entity, file, {
      dryRun: true,
      mapping,
    })) as BackendPreviewResult;
    return adaptPreview(entity, backend);
  }

  // -- Importación real (commit) ------------------------------------------------
  async commit(
    entity: Entity,
    file: File,
    mapping: ColumnMapping,
    opts: { skipDuplicates: boolean },
  ): Promise<CommitResult> {
    const backend = (await this.post(entity, file, {
      dryRun: false,
      mapping,
      skipDuplicates: opts.skipDuplicates,
    })) as BackendCommitResult;
    return adaptCommit(entity, backend);
  }

  // -- Plantilla (3 hojas: Pacientes/Saldos/Citas — la dejó T2) ------------------
  templateUrl(): string {
    return "/api/patients/import/template";
  }

  // -- Migración asistida (sube el archivo + abre ticket de soporte) ------------
  async submitAssisted(file: File, note: string): Promise<AssistedResult> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("note", note ?? "");
    let res: Response;
    try {
      res = await fetchWithTimeout("/api/import/assisted", { method: "POST", body: fd }, PREVIEW_TIMEOUT_MS);
    } catch (e) {
      throw asSpanishError(e);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(backendError(json, res.status, "No se pudo enviar la solicitud de migración asistida"));
    return { ok: !!(json && json.ok), ticketId: json?.ticketId };
  }

  // -- POST genérico a un endpoint de entidad (FormData del contrato) -----------
  private async post(
    entity: Entity,
    file: File,
    opts: { dryRun: boolean; mapping?: ColumnMapping; skipDuplicates?: boolean },
  ): Promise<unknown> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dryRun", opts.dryRun ? "true" : "false");
    if (opts.skipDuplicates !== undefined) {
      fd.append("skipDuplicates", opts.skipDuplicates ? "true" : "false");
    }
    // columnMapping solo si trae al menos un campo mapeado; si va vacío, el backend
    // autodetecta (clave para saldos/citas, que no se mapean en esta UI).
    if (opts.mapping) {
      const cleaned: ColumnMapping = {};
      for (const [header, field] of Object.entries(opts.mapping)) {
        if (field) cleaned[header] = field;
      }
      if (Object.keys(cleaned).length > 0) fd.append("columnMapping", JSON.stringify(cleaned));
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(ENDPOINTS[entity], { method: "POST", body: fd }, PREVIEW_TIMEOUT_MS);
    } catch (e) {
      throw asSpanishError(e);
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(backendError(json, res.status, "No se pudo procesar el archivo"));
    if (!json || typeof json !== "object") throw new Error("Respuesta inesperada del servidor");
    return json;
  }
}

// ---------------------------------------------------------------------------
// Adaptadores backend → UI.
// ---------------------------------------------------------------------------

/**
 * PreviewResult del backend → del wizard.
 * - columns: cada header del archivo + su sugerencia (campo canónico) + una muestra
 *   tomada de la primera fila con valor para ese campo. (El backend solo devuelve
 *   `data` por campo CANÓNICO, no la fila cruda; por eso las columnas no mapeadas
 *   no traen muestra.)
 * - targetFields: campos canónicos REALES de la entidad (no los del mock).
 * - rows: name/phone/balance derivados de `data` + estado + motivo.
 */
function adaptPreview(entity: Entity, b: BackendPreviewResult): PreviewResult {
  const columns: DetectedColumn[] = b.columns.map((header) => {
    const suggestion = b.suggestedMapping?.[header] ?? "";
    let sample = "";
    if (suggestion) {
      for (const r of b.preview) {
        const v = r.data?.[suggestion];
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          sample = sampleText(v);
          break;
        }
      }
    }
    return { source: header, sample, suggestion: suggestion || undefined };
  });

  const rows: PreviewRow[] = b.preview.slice(0, MAX_PREVIEW_ROWS).map((r) => {
    const data = r.data ?? {};
    const amount = typeof data.amount === "number" ? data.amount : null;
    return {
      row: r.row,
      name: rowName(data),
      phone: data.phone ? String(data.phone) : "—",
      balance: amount !== null ? formatMoney(amount) : "—",
      status: r.status,
      reason: rowReason(r),
    };
  });

  return {
    totalRows: b.total,
    columns,
    targetFields: CANONICAL_FIELDS[entity] ?? CANONICAL_FIELDS.patients,
    stats: { valid: b.validos, errors: b.invalidos, duplicates: b.duplicados },
    rows,
  };
}

/**
 * CommitResult del backend → del wizard. El backend devuelve CONTEOS (no la suma
 * monetaria); el resumen por entidad lo arma el wizard al acumular varias
 * entidades. Aquí se llena el slot de la entidad importada.
 */
function adaptCommit(entity: Entity, b: BackendCommitResult): CommitResult {
  const summary = { patients: 0, balances: "—", appointments: 0 } as CommitResult["summary"];
  if (entity === "patients") summary.patients = b.created;
  else if (entity === "balances") summary.balances = b.created.toLocaleString();
  else if (entity === "appointments") summary.appointments = b.created;

  return {
    created: b.created,
    errors: Array.isArray(b.errors) ? b.errors.length : 0,
    duplicates: b.duplicates,
    summary,
    // El backend no genera (todavía) un reporte de errores descargable; los
    // errores se muestran en la tabla de revisión. Ver ORQUESTA (followup).
    errorReportUrl: undefined,
  };
}

// ---------------------------------------------------------------------------
// fetch con timeout + errores en español.
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id: ReturnType<typeof setTimeout> = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

/** Normaliza un error de red/timeout a un mensaje claro en español. */
function asSpanishError(e: unknown): Error {
  if (e instanceof DOMException && e.name === "AbortError") {
    return new Error("La operación tardó demasiado. Inténtalo de nuevo o usa la migración asistida.");
  }
  return new Error("No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
}

/** Extrae el mensaje de error del backend ({error, detalle?}) o uno por defecto. */
function backendError(json: any, status: number, fallback: string): string {
  if (json && typeof json === "object" && typeof json.error === "string") {
    return json.detalle ? `${json.error}: ${json.detalle}` : json.error;
  }
  return `${fallback} (error ${status})`;
}
