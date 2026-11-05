// Vista previa del mensaje de recordatorio en /dashboard/whatsapp (vista de
// siempre y rediseño). Pasa por renderReminderTemplate, la MISMA función que
// usa el envío (manual y automático): lo que se ve aquí es lo que recibe el
// paciente, con el link añadido al final incluido.

import {
  findUnknownReminderVars,
  getConfirmUrl,
  renderReminderTemplate,
} from "./config";

/** Variables que se enseñan en pantalla, con la clave i18n que las explica. */
export const REMINDER_VARS_HELP: { vars: string[]; labelKey: string }[] = [
  { vars: ["{paciente}", "{nombre}"], labelKey: "inbox.whatsapp.varPaciente" },
  { vars: ["{clinica}", "{clinicName}"], labelKey: "inbox.whatsapp.varClinica" },
  { vars: ["{fecha}"], labelKey: "inbox.whatsapp.varFecha" },
  { vars: ["{hora}"], labelKey: "inbox.whatsapp.varHora" },
  { vars: ["{doctor}", "{doctorName}"], labelKey: "inbox.whatsapp.varDoctor" },
  { vars: ["{link}"], labelKey: "inbox.whatsapp.varLink" },
];

/**
 * `previewSinDoctor` (ws1-t10): el mismo mensaje para una cita «Sin doctor» —
 * sin la línea del doctor, o con «nuestro equipo» si va dentro de una frase.
 * Es lo que recibe el paciente cuando la cita todavía no tiene doctor.
 */
export function previewReminderMessage(
  template: string,
  sample: { clinica: string; fecha: string },
): { preview: string; previewSinDoctor: string; unknown: string[] } {
  const vars = {
    paciente: "María",
    clinica: sample.clinica,
    fecha: sample.fecha,
    hora: "10:00",
    doctor: "Dr/a. García",
    link: getConfirmUrl("ejemplo"),
  };
  return {
    preview: renderReminderTemplate(template, vars),
    previewSinDoctor: renderReminderTemplate(template, { ...vars, doctor: null }),
    unknown: findUnknownReminderVars(template),
  };
}
