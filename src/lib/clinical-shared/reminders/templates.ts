// Clinical-shared — plantillas WhatsApp para ClinicalReminder.
//
// Cada reminderType del enum SQL ClinicalReminderType (o cuando se usa
// `other` con payload.subtype) se mapea a un template con prefijo y un
// builder. El prefijo viaja en `WhatsAppReminder.message` para que el
// queue-worker lo resuelva al enviar.

export interface ClinicalReminderTemplateContext {
  /** Nombre del paciente (orto + cualquier módulo no-pediátrico). */
  patientName?: string;
  /** Nombre del niño (pediatrics). */
  childName?: string;
  /** Nombre del tutor (pediatrics). */
  guardianName?: string;
  /** Siempre disponible. */
  clinicName: string;
  monthInTreatment?: number;
  extraDate?: string;
}

export interface ClinicalReminderTemplate {
  key: string;
  /** Prefijo que el queue-worker usa para routear (eg. "PED_REMINDER_"). */
  prefix: string;
  label: string;
  build: (ctx: ClinicalReminderTemplateContext) => string;
}

export const CLINICAL_REMINDER_TEMPLATES = {
  // Pediatría ───────────────────────────────────────────────────────────
  ped_profilaxis_6m: {
    key: "ped_profilaxis_6m",
    prefix: "PED_REMINDER_",
    label: "Profilaxis cada 6 meses",
    build: (c) =>
      `Hola, ${c.guardianName}. Es momento de la limpieza dental semestral de ${c.childName}. ` +
      `Agenda la cita respondiendo este mensaje o llamando a ${c.clinicName}.`,
  },
  ped_control_erupcion_anual: {
    key: "ped_control_erupcion_anual",
    prefix: "PED_REMINDER_",
    label: "Control de erupción anual",
    build: (c) =>
      `Hola, ${c.guardianName}. Toca el control anual de erupción de ${c.childName}. ` +
      `Su pediatra dental quiere ver cómo van saliendo los dientes nuevos. Responde para agendar.`,
  },
  ped_cumpleanos_paciente: {
    key: "ped_cumpleanos_paciente",
    prefix: "PED_REMINDER_",
    label: "Cumpleaños del paciente",
    build: (c) =>
      `¡Felicidades, ${c.childName}! De todo el equipo de ${c.clinicName}, te deseamos ` +
      `un cumpleaños lleno de sonrisas sanas. Te hemos preparado una sorpresita: pasa pronto a recogerla.`,
  },

  // Ortodoncia ──────────────────────────────────────────────────────────
  ortho_control_30d: {
    key: "ortho_control_30d",
    prefix: "ORTHO_REMINDER_",
    label: "Cita mensual de control",
    build: (c) =>
      `Hola, ${c.patientName}. Toca tu control mensual de ortodoncia en ${c.clinicName}. ` +
      `Recuerda lavarte muy bien antes de venir y traer tus elásticos si los usas.`,
  },
  ortho_retention_check: {
    key: "ortho_retention_check",
    prefix: "ORTHO_REMINDER_",
    label: "Seguimiento de retención",
    build: (c) =>
      `Hola, ${c.patientName}. Tu control de retención está cerca en ${c.clinicName}. ` +
      `Sin retenedor, los dientes pueden moverse. Agenda hoy.`,
  },
  // ortho — sub-tipos vía payload.subtype
  ortho_aligner_change_2w: {
    key: "ortho_aligner_change_2w",
    prefix: "ORTHO_REMINDER_",
    label: "Cambio de alineador (2 semanas)",
    build: (c) =>
      `Hola, ${c.patientName}. Te toca cambiar al siguiente alineador en 2 semanas. ` +
      `Recuerda usarlo 22 horas al día y solo retirarlo para comer y cepillarte.`,
  },
  ortho_aligner_change_1w_urgent: {
    key: "ortho_aligner_change_1w_urgent",
    prefix: "ORTHO_REMINDER_",
    label: "Cambio de alineador 1 semana (urgente)",
    build: (c) =>
      `Hola, ${c.patientName}. Cambia tu siguiente alineador esta semana — el plan acelerado ` +
      `solo funciona si lo cambias a tiempo. Avísanos si tienes molestias.`,
  },
  ortho_appliance_removal_soon: {
    key: "ortho_appliance_removal_soon",
    prefix: "ORTHO_REMINDER_",
    label: "Retiro de aparato próximo",
    build: (c) =>
      `Hola, ${c.patientName}. ¡Falta poco! Tu retiro de brackets está programado en ` +
      `las próximas semanas en ${c.clinicName}. Prepárate para la siguiente etapa: la retención.`,
  },
} as const satisfies Record<string, ClinicalReminderTemplate>;

export type PediatricReminderType = keyof typeof CLINICAL_REMINDER_TEMPLATES;
export type OrthoReminderTemplateKey = keyof typeof CLINICAL_REMINDER_TEMPLATES;
