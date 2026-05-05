/**
 * Sistema de permisos en dos capas:
 *
 * 1) ENTITY.ACTION (legacy, para endpoints) — la API existente con
 *    `hasPermission(role, "patient.read")`. Cubre 12 endpoints de
 *    compliance (Fase A, NOM-024). NO se toca para no romper el
 *    backend que ya está estable.
 *
 * 2) UI PERMISSIONS (nuevo, para sidebar + páginas) — sistema granular
 *    expuesto al SUPER_ADMIN para personalizar QUE ve cada miembro del
 *    equipo. Keys tipo "agenda.view", "billing.charge". Resolved con
 *    User.permissionsOverride (si vacío, default del role).
 *
 * Ambas capas conviven. Las dos overloads de `hasPermission` distinguen
 * por el tipo del primer argumento: string (Role) → entity.action,
 * objeto (User) → UI permission key.
 */

import type { Role } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════
// CAPA 1 — ENTITY.ACTION (legacy, no tocar)
// ════════════════════════════════════════════════════════════════════

export type Permission =
  | "patient.read" | "patient.create" | "patient.update" | "patient.delete" | "patient.*"
  | "medicalRecord.read" | "medicalRecord.create" | "medicalRecord.update" | "medicalRecord.delete" | "medicalRecord.*"
  | "prescription.read" | "prescription.create" | "prescription.delete" | "prescription.*"
  | "appointment.read" | "appointment.create" | "appointment.update" | "appointment.delete" | "appointment.*"
  | "invoice.read" | "invoice.create" | "invoice.update" | "invoice.delete" | "invoice.*"
  | "consent.read" | "consent.create" | "consent.update" | "consent.*"
  | "team.read" | "team.create" | "team.update" | "team.delete" | "team.*"
  | "settings.read" | "settings.update" | "settings.*"
  | "audit.read"
  | "arco.read" | "arco.update" | "arco.*"
  | "*";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: [
    "patient.*", "medicalRecord.*", "prescription.*", "appointment.*",
    "invoice.*", "consent.*", "team.*", "settings.*", "audit.read", "arco.*",
  ],
  DOCTOR: [
    "patient.read", "patient.create", "patient.update",
    "medicalRecord.*", "prescription.*",
    "appointment.read", "appointment.create", "appointment.update",
    "consent.create", "consent.read",
  ],
  RECEPTIONIST: [
    "patient.read", "patient.create", "patient.update",
    "appointment.*",
    "invoice.create", "invoice.read", "invoice.update",
    "consent.read",
  ],
  READONLY: ["patient.read", "appointment.read"],
};

function roleHasEntityAction(role: Role, permission: Permission): boolean {
  const grants = ROLE_PERMISSIONS[role] ?? [];
  if (grants.includes("*")) return true;
  if (grants.includes(permission)) return true;
  const dotIdx = permission.indexOf(".");
  if (dotIdx > 0) {
    const entityWildcard = `${permission.slice(0, dotIdx)}.*` as Permission;
    if (grants.includes(entityWildcard)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// CAPA 2 — UI PERMISSIONS (nuevo)
// ════════════════════════════════════════════════════════════════════

/**
 * Diccionario canónico de permisos UI. Cada key tiene una descripción
 * legible que se muestra en el modal de gestión de permisos del SUPER_ADMIN.
 * El orden importa visualmente — agrupado por área del producto.
 */
export const ALL_PERMISSIONS = {
  // Hoy
  "today.view":           "Ver pestaña Hoy",
  // Agenda
  "agenda.view":          "Ver agenda",
  "agenda.create":        "Crear citas",
  "agenda.edit":          "Editar/mover citas",
  "agenda.delete":        "Cancelar citas",
  // Pacientes
  "patients.view":        "Ver lista de pacientes",
  "patients.create":      "Crear pacientes",
  "patients.edit":        "Editar pacientes",
  "patients.delete":      "Archivar/eliminar pacientes",
  // Expediente clínico
  "medicalRecord.view":   "Ver expediente clínico",
  "medicalRecord.edit":   "Editar notas SOAP / firmar",
  // Recetas
  "prescription.view":    "Ver recetas",
  "prescription.create":  "Crear/firmar recetas",
  // Radiografías
  "xrays.view":           "Ver radiografías",
  "xrays.upload":         "Subir radiografías",
  "xrays.analyze":        "Analizar con IA",
  // Inbox / Mensajes
  "inbox.view":           "Ver inbox",
  "inbox.send":           "Enviar mensajes",
  "whatsapp.view":        "Ver WhatsApp",
  "whatsapp.send":        "Enviar WhatsApp",
  // Catálogo
  "treatments.view":      "Ver tratamientos",
  "treatments.edit":      "Editar tratamientos (admin)",
  "resources.view":       "Ver sillones / consultorios",
  "resources.edit":       "Editar sillones / consultorios",
  "inventory.view":       "Ver inventario",
  "inventory.edit":       "Editar inventario",
  // Administración
  "billing.view":         "Ver facturación",
  "billing.create":       "Crear facturas",
  "billing.charge":       "Cobrar pagos",
  "billing.refund":       "Reembolsar / cancelar",
  "analytics.view":       "Ver Analytics",
  "tvModes.view":         "Ver Pantallas TV",
  "tvModes.edit":         "Configurar Pantallas TV",
  "reports.view":         "Ver reportes",
  "team.view":            "Ver equipo",
  "team.edit":            "Editar equipo (solo SUPER_ADMIN)",
  "settings.view":        "Ver configuración",
  "settings.edit":        "Editar configuración",
  "landing.view":         "Ver página web pública",
  "landing.edit":         "Editar landing",
  "procedures.view":      "Ver procedimientos",
  "procedures.edit":      "Editar procedimientos",
  "clinicLayout.view":    "Ver Mi Clínica Visual",
  "clinicLayout.edit":    "Editar Mi Clínica Visual",
  // Marketplace — todos los roles ven por default (es el catálogo de módulos
  // de la clínica). Comprar es admin-only y se valida en server actions.
  "marketplace.view":     "Ver marketplace de módulos",
  // Especialidades — gating de páginas dedicadas de los módulos del
  // marketplace. La visibilidad real ADEMÁS exige el módulo activo en
  // ClinicModule (canAccessModule). Estas keys solo cubren la dimensión
  // de "tiene permiso UI"; el módulo se valida server-side.
  "specialties.pediatrics":   "Ver Odontopediatría",
  "specialties.endodontics":  "Ver Endodoncia",
  "specialties.periodontics": "Ver Periodoncia",
  "specialties.orthodontics": "Ver Ortodoncia",
  "specialties.implants":     "Ver Implantología",
} as const;

export type PermissionKey = keyof typeof ALL_PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(ALL_PERMISSIONS) as PermissionKey[];

/**
 * Agrupación visual para el modal del SUPER_ADMIN. Cada grupo se renderiza
 * como una sección con su título. Las keys aquí deben coincidir 1:1 con las
 * de ALL_PERMISSIONS (TypeScript lo verifica vía PermissionKey).
 */
export const PERMISSION_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  { title: "Hoy",            keys: ["today.view"] },
  { title: "Agenda",         keys: ["agenda.view", "agenda.create", "agenda.edit", "agenda.delete"] },
  { title: "Pacientes",      keys: ["patients.view", "patients.create", "patients.edit", "patients.delete"] },
  { title: "Expediente",     keys: ["medicalRecord.view", "medicalRecord.edit"] },
  { title: "Recetas",        keys: ["prescription.view", "prescription.create"] },
  { title: "Radiografías",   keys: ["xrays.view", "xrays.upload", "xrays.analyze"] },
  { title: "Comunicación",   keys: ["inbox.view", "inbox.send", "whatsapp.view", "whatsapp.send"] },
  { title: "Catálogo",       keys: ["treatments.view", "treatments.edit", "resources.view", "resources.edit", "inventory.view", "inventory.edit"] },
  { title: "Facturación",    keys: ["billing.view", "billing.create", "billing.charge", "billing.refund"] },
  { title: "Reportes y TV",  keys: ["analytics.view", "reports.view", "tvModes.view", "tvModes.edit"] },
  { title: "Equipo",         keys: ["team.view", "team.edit"] },
  { title: "Configuración",  keys: ["settings.view", "settings.edit", "landing.view", "landing.edit", "procedures.view", "procedures.edit", "clinicLayout.view", "clinicLayout.edit"] },
  { title: "Marketplace",    keys: ["marketplace.view"] },
  { title: "Especialidades", keys: ["specialties.pediatrics", "specialties.endodontics", "specialties.periodontics", "specialties.orthodontics", "specialties.implants"] },
];

/**
 * Defaults por rol. Estos son los permisos que aplican cuando
 * User.permissionsOverride está vacío.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, PermissionKey[]> = {
  SUPER_ADMIN: [...ALL_PERMISSION_KEYS], // todo
  ADMIN: ALL_PERMISSION_KEYS.filter((k) => k !== "team.edit"), // todo excepto editar equipo
  DOCTOR: [
    "today.view",
    "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
    "patients.view", "patients.create", "patients.edit",
    "medicalRecord.view", "medicalRecord.edit",
    "prescription.view", "prescription.create",
    "xrays.view", "xrays.upload", "xrays.analyze",
    "treatments.view",
    "inbox.view", "inbox.send",
    "marketplace.view",
    "specialties.pediatrics",
    "specialties.endodontics",
    "specialties.periodontics",
    "specialties.orthodontics",
    "specialties.implants",
  ],
  RECEPTIONIST: [
    "today.view",
    "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
    "patients.view", "patients.create", "patients.edit",
    "billing.view", "billing.create", "billing.charge",
    "inbox.view", "inbox.send",
    "whatsapp.view", "whatsapp.send",
    "treatments.view", "resources.view", "inventory.view",
    "marketplace.view",
    "specialties.pediatrics",
    "specialties.endodontics",
    "specialties.periodontics",
    "specialties.orthodontics",
    "specialties.implants",
  ],
  // READONLY: solo *.view excepto medical/prescription/xrays
  READONLY: ALL_PERMISSION_KEYS.filter((k) =>
    k.endsWith(".view") &&
    !k.startsWith("medicalRecord.") &&
    !k.startsWith("prescription.") &&
    !k.startsWith("xrays."),
  ),
};

/**
 * Resuelve los permisos efectivos del usuario.
 * - Si permissionsOverride está vacío → default del role.
 * - Si tiene keys → esas REEMPLAZAN al default (no se mergean).
 *
 * Filtramos keys inválidas que pueda haber quedado en DB tras un cambio
 * de catálogo (defensivo).
 */
export function getEffectivePermissions(user: { role: Role; permissionsOverride?: string[] | null }): PermissionKey[] {
  const override = user.permissionsOverride ?? [];
  if (override.length === 0) return ROLE_DEFAULT_PERMISSIONS[user.role] ?? [];
  return override.filter((k): k is PermissionKey => k in ALL_PERMISSIONS);
}

// ════════════════════════════════════════════════════════════════════
// hasPermission — overload que cubre ambas capas
// ════════════════════════════════════════════════════════════════════

/** Capa 1: chequea entity.action contra el role (legacy). */
export function hasPermission(role: Role, permission: Permission): boolean;
/** Capa 2: chequea UI key contra el user (default + override). */
export function hasPermission(user: { role: Role; permissionsOverride?: string[] | null }, key: PermissionKey): boolean;
export function hasPermission(arg1: Role | { role: Role; permissionsOverride?: string[] | null }, arg2: string): boolean {
  if (typeof arg1 === "string") {
    return roleHasEntityAction(arg1, arg2 as Permission);
  }
  return getEffectivePermissions(arg1).includes(arg2 as PermissionKey);
}

// ════════════════════════════════════════════════════════════════════
// Helpers de validación (para el endpoint PATCH /api/team/[id]/permissions)
// ════════════════════════════════════════════════════════════════════

/** Devuelve solo las keys válidas, descarta las inventadas. */
export function sanitizePermissionKeys(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<PermissionKey>();
  for (const k of input) {
    if (typeof k === "string" && k in ALL_PERMISSIONS) seen.add(k as PermissionKey);
  }
  return Array.from(seen);
}

// ════════════════════════════════════════════════════════════════════
// Marketplace modules — extensión pediatría (spec §4.B.4)
//
// Los módulos del marketplace viven en DB (tabla modules + clinic_modules).
// Aquí re-exportamos las helpers puras del módulo pediátrico para que el
// resto del producto pueda gating-ear sin tocar `lib/pediatrics/*`.
// ════════════════════════════════════════════════════════════════════

export {
  canSeePediatrics,
  hasPediatricsModule,
  PEDIATRICS_MODULE_KEY,
  DEFAULT_PEDIATRICS_CUTOFF_YEARS,
  type PediatricsContext,
} from "@/lib/pediatrics/permissions";
