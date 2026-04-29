/**
 * Matriz de permisos role × entity × action — NOM-024 art. 6.3.4 (control
 * de acceso por rol). Define qué rol puede leer/editar qué entidad.
 *
 * Convención: "<entity>.<action>" donde action ∈ read|create|update|delete|*
 * El asterisco "*" significa todas las acciones.
 *
 * El SUPER_ADMIN tiene wildcard global "*" (cualquier acción sobre
 * cualquier entidad). Esto es a propósito — el SUPER_ADMIN del SaaS
 * MediFlow gestiona todas las clínicas (NOTA: aún así el scope clinicId
 * sigue aplicando — los endpoints filtran por ctx.clinicId, los permisos
 * son una capa adicional sobre eso).
 */

import type { Role } from "@prisma/client";

export type Permission =
  // Patient
  | "patient.read" | "patient.create" | "patient.update" | "patient.delete" | "patient.*"
  // Medical record / clinical notes (incluye notas privadas)
  | "medicalRecord.read" | "medicalRecord.create" | "medicalRecord.update" | "medicalRecord.delete" | "medicalRecord.*"
  // Prescription
  | "prescription.read" | "prescription.create" | "prescription.delete" | "prescription.*"
  // Appointment
  | "appointment.read" | "appointment.create" | "appointment.update" | "appointment.delete" | "appointment.*"
  // Invoice
  | "invoice.read" | "invoice.create" | "invoice.update" | "invoice.delete" | "invoice.*"
  // Consent
  | "consent.read" | "consent.create" | "consent.update" | "consent.*"
  // Team / users
  | "team.read" | "team.create" | "team.update" | "team.delete" | "team.*"
  // Settings / clinic config
  | "settings.read" | "settings.update" | "settings.*"
  // Audit log read
  | "audit.read"
  // ARCO requests (solo admin de la clínica)
  | "arco.read" | "arco.update" | "arco.*"
  // Wildcard global (SUPER_ADMIN)
  | "*";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: [
    "patient.*",
    "medicalRecord.*",
    "prescription.*",
    "appointment.*",
    "invoice.*",
    "consent.*",
    "team.*",
    "settings.*",
    "audit.read",
    "arco.*",
  ],
  DOCTOR: [
    "patient.read",
    "patient.create",
    "patient.update",
    "medicalRecord.*",
    "prescription.*",
    "appointment.read",
    "appointment.create",
    "appointment.update",
    "consent.create",
    "consent.read",
  ],
  RECEPTIONIST: [
    "patient.read",
    "patient.create",
    "patient.update",
    "appointment.*",
    "invoice.create",
    "invoice.read",
    "invoice.update",
    "consent.read",
    // RECEPTIONIST NO ve medicalRecord ni prescription — gap clínico explícito.
  ],
  READONLY: [
    "patient.read",
    "appointment.read",
  ],
};

/**
 * Verifica si un rol tiene permiso para una acción concreta.
 * Soporta wildcards: si el rol tiene "patient.*" cubre cualquier
 * "patient.<action>", y si tiene "*" cubre todo.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const grants = ROLE_PERMISSIONS[role] ?? [];
  if (grants.includes("*")) return true;
  if (grants.includes(permission)) return true;
  // Wildcard de entidad: "patient.*" cubre "patient.read", "patient.create", etc.
  const dotIdx = permission.indexOf(".");
  if (dotIdx > 0) {
    const entityWildcard = `${permission.slice(0, dotIdx)}.*` as Permission;
    if (grants.includes(entityWildcard)) return true;
  }
  return false;
}
