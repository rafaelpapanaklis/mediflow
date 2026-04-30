// Pediatrics — catálogo de acciones de audit log para mutaciones clínicas. Spec: §4.A.1

export const PEDIATRIC_AUDIT_ACTIONS = {
  RECORD_CREATED:    "pediatrics.record.created",
  RECORD_UPDATED:    "pediatrics.record.updated",

  GUARDIAN_ADDED:    "pediatrics.guardian.added",
  GUARDIAN_UPDATED:  "pediatrics.guardian.updated",
  GUARDIAN_DELETED:  "pediatrics.guardian.deleted",

  FRANKL_CAPTURED:   "pediatrics.frankl.captured",
  CAMBRA_CAPTURED:   "pediatrics.cambra.captured",

  HABIT_RECORDED:    "pediatrics.habit.recorded",
  HABIT_UPDATED:     "pediatrics.habit.updated",
  HABIT_RESOLVED:    "pediatrics.habit.resolved",
  HABIT_DELETED:     "pediatrics.habit.deleted",

  ERUPTION_RECORDED: "pediatrics.eruption.recorded",
  ERUPTION_DELETED:  "pediatrics.eruption.deleted",

  SEALANT_PLACED:    "pediatrics.sealant.placed",
  SEALANT_UPDATED:   "pediatrics.sealant.updated",
  SEALANT_REAPPLIED: "pediatrics.sealant.reapplied",

  FLUORIDE_APPLIED:  "pediatrics.fluoride.applied",

  MAINTAINER_PLACED: "pediatrics.maintainer.placed",
  MAINTAINER_UPDATED: "pediatrics.maintainer.updated",
  MAINTAINER_RETIRED: "pediatrics.maintainer.retired",

  ENDO_RECORDED:     "pediatrics.endodontic.recorded",

  CONSENT_GENERATED: "pediatrics.consent.generated",
  CONSENT_SIGNED:    "pediatrics.consent.signed",
  CONSENT_VOIDED:    "pediatrics.consent.voided",
} as const;

export type PediatricAuditAction =
  (typeof PEDIATRIC_AUDIT_ACTIONS)[keyof typeof PEDIATRIC_AUDIT_ACTIONS];

export const PEDIATRIC_AUDIT_ACTION_VALUES: readonly PediatricAuditAction[] =
  Object.values(PEDIATRIC_AUDIT_ACTIONS);
