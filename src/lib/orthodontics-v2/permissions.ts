// Permisos por rol — SPEC §5 verbatim · 35 acciones × 3 roles = 105 reglas.
// Default cuando una acción no está en la tabla: doctor ✓ / asistente RO /
// recepción ✗ (decisión documentada en docs/ortho-redesign-v2/_decisions.md).

import type { OrthoRole } from "./types";

export type PermissionLevel = "allow" | "readonly" | "deny";

// Catálogo de acciones (key estable para usar en server actions y UI).
export type OrthoActionKey =
  | "view_record"
  | "edit_diagnosis"
  | "edit_plan"
  | "load_save_template"
  | "new_appliance_type"
  | "manage_arch"
  | "advance_arch"
  | "edit_ipr"
  | "upload_photoset"
  | "annotate_measure_photo"
  | "delete_photo"
  | "toggle_favorite_photo"
  | "compare_photos"
  | "create_treatment_card"
  | "edit_soap"
  | "sign_treatment_card"
  | "print_indications"
  | "edit_financial_plan"
  | "activate_scenario_signathome"
  | "collect_installment"
  | "view_cfdi_detail"
  | "edit_retention_regimen"
  | "schedule_retention_checkpoint"
  | "mark_checkpoint_done"
  | "generate_before_after_pdf"
  | "generate_referral_card"
  | "generate_consent"
  | "send_referral_letter"
  | "create_edit_lab_order"
  | "change_lab_order_status"
  | "view_whatsapp_log"
  | "send_whatsapp"
  | "mark_debonding"
  | "complete_archive_case"
  | "ask_ai_with_context";

// ─────────────────────────────────────────────────────────────────────────────
// Tabla de permisos · SPEC §5 verbatim
// ─────────────────────────────────────────────────────────────────────────────

const MATRIX: Record<OrthoActionKey, Record<OrthoRole, PermissionLevel>> = {
  view_record:                  { doctor: "allow",   assistant: "allow",    reception: "readonly" },
  edit_diagnosis:               { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  edit_plan:                    { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  load_save_template:           { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  new_appliance_type:           { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  manage_arch:                  { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  advance_arch:                 { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  edit_ipr:                     { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  upload_photoset:              { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  annotate_measure_photo:       { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  delete_photo:                 { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  toggle_favorite_photo:        { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  compare_photos:               { doctor: "allow",   assistant: "allow",    reception: "readonly" },
  create_treatment_card:        { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  edit_soap:                    { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  sign_treatment_card:          { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  print_indications:            { doctor: "allow",   assistant: "allow",    reception: "allow"    },
  edit_financial_plan:          { doctor: "allow",   assistant: "deny",     reception: "allow"    },
  activate_scenario_signathome: { doctor: "allow",   assistant: "deny",     reception: "allow"    },
  collect_installment:          { doctor: "allow",   assistant: "deny",     reception: "allow"    },
  view_cfdi_detail:             { doctor: "allow",   assistant: "readonly", reception: "allow"    },
  edit_retention_regimen:       { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  schedule_retention_checkpoint:{ doctor: "allow",   assistant: "allow",    reception: "allow"    },
  mark_checkpoint_done:         { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  generate_before_after_pdf:    { doctor: "allow",   assistant: "deny",     reception: "allow"    },
  generate_referral_card:       { doctor: "allow",   assistant: "allow",    reception: "allow"    },
  generate_consent:             { doctor: "allow",   assistant: "allow",    reception: "allow"    },
  send_referral_letter:         { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  create_edit_lab_order:        { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  change_lab_order_status:      { doctor: "allow",   assistant: "allow",    reception: "deny"     },
  view_whatsapp_log:            { doctor: "allow",   assistant: "allow",    reception: "allow"    },
  send_whatsapp:                { doctor: "allow",   assistant: "allow",    reception: "allow"    },
  mark_debonding:               { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  complete_archive_case:        { doctor: "allow",   assistant: "deny",     reception: "deny"     },
  ask_ai_with_context:          { doctor: "allow",   assistant: "allow",    reception: "deny"     },
};

// ─────────────────────────────────────────────────────────────────────────────
// API público
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina si un rol puede ejecutar una acción.
 * Para acciones no listadas, aplica default: doctor ✓ / assistant RO / reception ✗.
 */
export function getPermission(role: OrthoRole, action: OrthoActionKey): PermissionLevel {
  const entry = MATRIX[action];
  if (!entry) {
    return role === "doctor" ? "allow" : role === "assistant" ? "readonly" : "deny";
  }
  return entry[role];
}

export function canExecute(role: OrthoRole, action: OrthoActionKey): boolean {
  return getPermission(role, action) === "allow";
}

export function isReadOnly(role: OrthoRole, action: OrthoActionKey): boolean {
  return getPermission(role, action) === "readonly";
}

export function isDenied(role: OrthoRole, action: OrthoActionKey): boolean {
  return getPermission(role, action) === "deny";
}

/**
 * Mapeo del Role de Prisma User al OrthoRole — necesario porque el schema
 * actual usa roles más generales (DOCTOR/ASSISTANT/RECEPTION/ADMIN).
 * ADMIN y SUPER_ADMIN se mapean a "doctor" (acceso pleno).
 */
export function mapRole(role: string): OrthoRole {
  const r = role.toLowerCase();
  if (r === "doctor" || r === "admin" || r === "super_admin" || r === "owner") return "doctor";
  if (r === "assistant" || r === "nurse" || r === "hygienist") return "assistant";
  return "reception";
}
