/**
 * Tipos cross-cutting compartidos entre módulos clínicos. Re-exporta
 * enums del cliente Prisma + agrega constantes útiles para implantes.
 *
 * El schema base lo aporta `feat(clinical-shared): schema base modelos
 * cross-cutting`. Aquí solo helpers TypeScript.
 */

import type {
  ClinicalModule as PrismaClinicalModule,
  ClinicalPhotoStage as PrismaClinicalPhotoStage,
  ClinicalPhotoType as PrismaClinicalPhotoType,
  LabOrderStatus as PrismaLabOrderStatus,
  LabOrderType as PrismaLabOrderType,
  ReferralLetterStatus as PrismaReferralLetterStatus,
  ReferralLetterChannel as PrismaReferralLetterChannel,
  ClinicalReminderStatus as PrismaClinicalReminderStatus,
  ClinicalReminderType as PrismaClinicalReminderType,
} from "@prisma/client";

export type ClinicalModule = PrismaClinicalModule;
export type ClinicalPhotoStage = PrismaClinicalPhotoStage;
export type ClinicalPhotoType = PrismaClinicalPhotoType;
export type LabOrderStatus = PrismaLabOrderStatus;
export type LabOrderType = PrismaLabOrderType;
export type ReferralLetterStatus = PrismaReferralLetterStatus;
export type ReferralLetterChannel = PrismaReferralLetterChannel;
export type ClinicalReminderStatus = PrismaClinicalReminderStatus;
export type ClinicalReminderType = PrismaClinicalReminderType;

export const CLINICAL_MODULES: ClinicalModule[] = [
  "pediatrics",
  "endodontics",
  "periodontics",
  "implants",
  "orthodontics",
];

/**
 * Tipos de foto específicos para el módulo de implantes (set v2 granular).
 * Se complementan con `implant_site_pre`, `implant_placement`,
 * `implant_healing` y `implant_prosthetic` (set v1) que ya existen en el
 * enum base.
 */
export const IMPLANT_PHOTO_TYPES = [
  "pre_surgical",
  "surgical_phase",
  "implant_healing",
  "second_stage",
  "prosthetic_placement",
  "follow_up_radiograph",
  "peri_implant_check",
] as const satisfies readonly ClinicalPhotoType[];

export type ImplantPhotoType = (typeof IMPLANT_PHOTO_TYPES)[number];

export function isImplantPhotoType(value: string): value is ImplantPhotoType {
  return (IMPLANT_PHOTO_TYPES as readonly string[]).includes(value);
}

/**
 * Mapa de fases clínicas implantológicas (orden cronológico). Usado en
 * timeline y agrupación de fotos por fase.
 */
export const IMPLANT_PHASE_KEYS = [
  "planning",
  "surgical",
  "healing",
  "second_stage",
  "prosthetic",
  "follow_up",
] as const;

export type ImplantPhaseKey = (typeof IMPLANT_PHASE_KEYS)[number];

export function isImplantPhaseKey(value: string): value is ImplantPhaseKey {
  return (IMPLANT_PHASE_KEYS as readonly string[]).includes(value);
}

/**
 * Mapeo de tipo de foto → fase clínica.
 */
export function implantPhotoTypeToPhase(type: ImplantPhotoType): ImplantPhaseKey {
  switch (type) {
    case "pre_surgical":
      return "planning";
    case "surgical_phase":
      return "surgical";
    case "implant_healing":
      return "healing";
    case "second_stage":
      return "second_stage";
    case "prosthetic_placement":
      return "prosthetic";
    case "follow_up_radiograph":
    case "peri_implant_check":
      return "follow_up";
    default:
      return "follow_up";
  }
}

// ── Implantes — lab order types ─────────────────────────────────────

/**
 * Tipos de orden de laboratorio para implantes. El enum `LabOrderType`
 * del schema cubre `custom_abutment`, `crown` y `surgical_guide`. Para
 * los demás (atornillada, cementada, modelo digital) usamos los mismos
 * con discriminador en `spec.implantOrderSubtype`.
 */
export const IMPLANT_LAB_ORDER_SUBTYPES = [
  "pilar_personalizado",
  "protesis_atornillada",
  "protesis_cementada",
  "guia_quirurgica",
  "modelo_estudio_digital",
] as const;

export type ImplantLabOrderSubtype = (typeof IMPLANT_LAB_ORDER_SUBTYPES)[number];

export function isImplantLabOrderSubtype(value: string): value is ImplantLabOrderSubtype {
  return (IMPLANT_LAB_ORDER_SUBTYPES as readonly string[]).includes(value);
}

/**
 * Mapa subtipo implantes → LabOrderType del schema.
 */
export function implantSubtypeToLabOrderType(
  subtype: ImplantLabOrderSubtype,
): LabOrderType {
  switch (subtype) {
    case "pilar_personalizado":
      return "custom_abutment";
    case "protesis_atornillada":
    case "protesis_cementada":
      return "crown";
    case "guia_quirurgica":
      return "surgical_guide";
    case "modelo_estudio_digital":
      return "other";
    default:
      return "other";
  }
}

// ── Implantes — referral letter kinds ───────────────────────────────

export const IMPLANT_REFERRAL_KINDS = [
  "envio_cirujano_oral",
  "envio_prostodoncista",
  "envio_periodoncista",
  "envio_endodoncista",
] as const;

export type ImplantReferralKind = (typeof IMPLANT_REFERRAL_KINDS)[number];

// ── Implantes — clinical reminder rule keys ─────────────────────────

/**
 * Reglas de recordatorio implantes. Las claves coinciden con valores
 * del enum `ClinicalReminderType` cuando es posible:
 *  - `implant_followup_1m`, `implant_followup_6m`, `implant_followup_1y`
 * y se suman aliases legibles para los específicos de implantes.
 */
export const IMPLANT_REMINDER_RULE_KEYS = [
  "control_cicatrizacion_7d",
  "retiro_sutura_10d",
  "control_oseointegracion_4m",
  "control_anual_implante",
  "control_peri_implantitis_6m",
] as const;

export type ImplantReminderRuleKey = (typeof IMPLANT_REMINDER_RULE_KEYS)[number];

export const IMPLANT_REMINDER_OFFSETS_DAYS: Record<ImplantReminderRuleKey, number> = {
  control_cicatrizacion_7d: 7,
  retiro_sutura_10d: 10,
  control_oseointegracion_4m: 120,
  control_anual_implante: 365,
  control_peri_implantitis_6m: 180,
};

/**
 * Mapeo a tipos granulares del enum ClinicalReminderType (set v2).
 */
export function implantReminderRuleToReminderType(
  key: ImplantReminderRuleKey,
): ClinicalReminderType {
  switch (key) {
    case "control_cicatrizacion_7d":
      return "implant_cicatrizacion_7d";
    case "retiro_sutura_10d":
      return "implant_retiro_sutura_10d";
    case "control_oseointegracion_4m":
      return "implant_oseointegracion_4m";
    case "control_anual_implante":
      return "implant_control_anual";
    case "control_peri_implantitis_6m":
      return "implant_peri_implantitis_6m";
    default:
      return "other";
  }
}

// ── Implantes — export kinds (texto libre) ─────────────────────────

export const IMPLANT_EXPORT_KINDS = [
  "IMPLANT_FULL_REPORT",
  "IMPLANT_PASSPORT",
  "IMPLANT_LAB_ORDER",
  "IMPLANT_REFERRAL",
] as const;

export type ImplantExportKind = (typeof IMPLANT_EXPORT_KINDS)[number];
