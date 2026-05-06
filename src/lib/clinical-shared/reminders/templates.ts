// Clinical-shared — plantillas de WhatsApp para ClinicalReminder.
//
// Cada reminderType del enum ClinicalReminderType se mapea a un template
// con prefijo (para que el queue-worker lo routee) y un builder. El
// prefijo viaja en el campo `message` del WhatsAppReminder; el queue
// worker lo usa para sustituir argumentos antes de enviar.

export interface ClinicalReminderTemplate {
  key: string;
  /** Prefijo que el queue-worker usa para routear (eg. "PED_REMINDER_"). */
  prefix: string;
  label: string;
  /** Builder con contexto resuelto desde el reminder. */
  build: (ctx: {
    childName: string;
    guardianName: string;
    clinicName: string;
    extraDate?: string;
  }) => string;
}

export const CLINICAL_REMINDER_TEMPLATES = {
  // Pediatría
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
} as const satisfies Record<string, ClinicalReminderTemplate>;

export type PediatricReminderType = keyof typeof CLINICAL_REMINDER_TEMPLATES;
