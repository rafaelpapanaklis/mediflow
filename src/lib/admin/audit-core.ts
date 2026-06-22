/**
 * Lógica PURA del panel de auditoría (sin Prisma → testeable en aislamiento).
 * `audit.ts` reexporta todo esto y añade la consulta a BD (`queryAuditLogs`).
 *
 * Solo `import type` de @prisma/client (se borra en runtime, no instancia el
 * cliente), así este módulo corre bajo `tsx --test` sin tocar la base.
 */

import type { Prisma } from "@prisma/client";

// ───────────────────────── Tipos públicos ─────────────────────────

export interface AuditQueryFilters {
  clinicId?: string;
  userId?: string;
  role?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** ISO o `yyyy-mm-dd` (se interpreta como inicio del día). */
  dateFrom?: string;
  /** ISO o `yyyy-mm-dd` (se interpreta como fin del día, 23:59:59.999). */
  dateTo?: string;
  /** Búsqueda libre: match en entityId / ipAddress / userAgent. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogRow {
  id: string;
  clinicId: string;
  clinicName: string | null;
  userId: string;
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string; // ISO
}

export interface AuditQueryResult {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const AUDIT_PAGE_SIZE_DEFAULT = 50;
export const AUDIT_PAGE_SIZE_MAX = 200;

// ───────────────────────── Catálogos para filtros ─────────────────────────

/** Roles válidos (espejo del enum Role de Prisma). */
export const ROLE_OPTIONS = [
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "READONLY",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Dueño",
  ADMIN: "Admin",
  DOCTOR: "Doctor",
  RECEPTIONIST: "Recepción",
  READONLY: "Solo lectura",
};

/** Acciones conocidas (espejo de AuditAction en src/lib/audit.ts). */
export const AUDIT_ACTION_OPTIONS = [
  "create",
  "update",
  "delete",
  "void",
  "soft_delete",
  "archive",
  "view",
  "password_reset",
  "XRAY_NOTES_UPDATED",
  "FILE_NOTES_UPDATED",
] as const;

/** Entidades conocidas (espejo de AuditEntityType en src/lib/audit.ts). */
export const AUDIT_ENTITY_OPTIONS = [
  "patient",
  "appointment",
  "invoice",
  "record",
  "consent",
  "inventory",
  "treatment",
  "periodontal",
  "body-map",
  "xray-analysis",
  "patient-file",
  "prescription",
  "user",
  "clinic",
  "subscription",
  "quote",
  "pediatric-record",
] as const;

export type AuditTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

/** Etiqueta + color por acción. Las no listadas caen a neutral con su string. */
export const ACTION_META: Record<string, { label: string; tone: AuditTone }> = {
  create: { label: "Creación", tone: "success" },
  update: { label: "Edición", tone: "info" },
  delete: { label: "Borrado", tone: "danger" },
  void: { label: "Anulación", tone: "danger" },
  soft_delete: { label: "Borrado lógico", tone: "warning" },
  archive: { label: "Archivado", tone: "warning" },
  view: { label: "Lectura", tone: "neutral" },
  password_reset: { label: "Reset contraseña", tone: "warning" },
  XRAY_NOTES_UPDATED: { label: "Notas radiografía", tone: "info" },
  FILE_NOTES_UPDATED: { label: "Notas archivo", tone: "info" },
};

export function actionMeta(action: string): { label: string; tone: AuditTone } {
  return ACTION_META[action] ?? { label: action, tone: "neutral" };
}

const ENTITY_LABELS: Record<string, string> = {
  patient: "Paciente",
  appointment: "Cita",
  invoice: "Factura",
  record: "Expediente",
  consent: "Consentimiento",
  inventory: "Inventario",
  treatment: "Tratamiento",
  periodontal: "Periodoncia",
  "body-map": "Mapa corporal",
  "xray-analysis": "Análisis RX",
  "patient-file": "Archivo paciente",
  prescription: "Receta",
  user: "Usuario",
  clinic: "Clínica",
  subscription: "Suscripción",
  quote: "Presupuesto",
};

export function entityLabel(entityType: string): string {
  if (ENTITY_LABELS[entityType]) return ENTITY_LABELS[entityType];
  if (entityType.indexOf("ped-") === 0 || entityType.indexOf("pediatric") === 0) return "Pediatría";
  return entityType;
}

// ───────────────────────── Helpers puros ─────────────────────────

export function clampPage(page: number | undefined): number {
  const p = Math.floor(Number(page ?? 1));
  return Number.isFinite(p) && p > 0 ? p : 1;
}

export function clampPageSize(pageSize: number | undefined): number {
  const s = Math.floor(Number(pageSize ?? AUDIT_PAGE_SIZE_DEFAULT));
  if (!Number.isFinite(s) || s < 1) return AUDIT_PAGE_SIZE_DEFAULT;
  return Math.min(AUDIT_PAGE_SIZE_MAX, s);
}

/**
 * Convierte un valor de fecha (`yyyy-mm-dd` o ISO) a Date. Para `yyyy-mm-dd`
 * ancla al inicio o fin del día según `endOfDay`. Devuelve null si es inválida.
 */
export function parseAuditDate(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = isDateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Arma el filtro Prisma (PURO — no toca BD). Ignora silenciosamente filtros
 * vacíos o inválidos (p.ej. un `role` desconocido) para no romper la consulta.
 */
export function buildAuditWhere(filters: AuditQueryFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.clinicId) where.clinicId = filters.clinicId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;

  // Rol: filtra sobre la relación user. SOLO si es un rol válido — pasar un
  // enum inválido a Prisma lanzaría en runtime.
  if (filters.role && (ROLE_OPTIONS as readonly string[]).indexOf(filters.role) >= 0) {
    // `as any`: el valor ya está validado contra ROLE_OPTIONS; evita TS2352
    // (string → enum Role) sin perder el filtro real sobre la relación.
    where.user = { role: filters.role as any };
  }

  // Rango de fechas.
  const from = parseAuditDate(filters.dateFrom, false);
  const to = parseAuditDate(filters.dateTo, true);
  if (from || to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    where.createdAt = createdAt;
  }

  // Búsqueda libre.
  const q = (filters.q ?? "").trim();
  if (q) {
    where.OR = [
      { entityId: { contains: q, mode: "insensitive" } },
      { ipAddress: { contains: q, mode: "insensitive" } },
      { userAgent: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

// ───────────────────────── Normalización de `changes` ─────────────────────────

export type AuditChangeKind = "created" | "deleted" | "updated" | "empty";

export interface AuditChangeField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface NormalizedChanges {
  kind: AuditChangeKind;
  fields: AuditChangeField[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Interpreta el JSON `changes` escrito por logMutation:
 *   update      → { campo: { before, after }, ... }
 *   create      → { _created: { before: null, after: {...} } }
 *   delete/void → { _deleted: { before: {...}, after: {...} | null } }
 * Devuelve una lista plana de campos para render uniforme.
 */
export function normalizeChanges(changes: unknown): NormalizedChanges {
  if (!isPlainObject(changes)) return { kind: "empty", fields: [] };

  if ("_created" in changes && isPlainObject(changes._created)) {
    const after = changes._created.after;
    const obj = isPlainObject(after) ? after : {};
    return {
      kind: "created",
      fields: Object.keys(obj).map((field) => ({ field, before: null, after: obj[field] })),
    };
  }

  if ("_deleted" in changes && isPlainObject(changes._deleted)) {
    const before = changes._deleted.before;
    const after = changes._deleted.after;
    const beforeObj = isPlainObject(before) ? before : {};
    const afterObj = isPlainObject(after) ? after : {};
    const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
    return {
      kind: "deleted",
      fields: keys.map((field) => ({ field, before: beforeObj[field], after: afterObj[field] ?? null })),
    };
  }

  // Update genérico: cada valor debería ser { before, after }.
  const fields: AuditChangeField[] = Object.keys(changes).map((field) => {
    const v = changes[field];
    if (isPlainObject(v) && ("before" in v || "after" in v)) {
      return { field, before: (v as Record<string, unknown>).before, after: (v as Record<string, unknown>).after };
    }
    return { field, before: undefined, after: v };
  });
  return { kind: fields.length ? "updated" : "empty", fields };
}

/** Formatea un valor de `changes` a string legible. */
export function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? "(vacío)" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
