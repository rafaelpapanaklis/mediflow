// Implantology — plantillas WhatsApp del módulo 4/5 (stub anticipado).
// El módulo de Implantología aún no está implementado; este diccionario
// existe para que el queue worker A2 ya tenga el contrato cuando los
// callers empiecen a encolar mensajes IMPLANT_<KEY>.

export const IMPLANT_WHATSAPP_TEMPLATES = {
  POST_PLACEMENT_DAY_0: (patientName: string) =>
    `Hola ${patientName}. Tu cirugía de implante terminó. Recuerda:
• Aplica frío sobre la mejilla 15 min cada hora durante 24 h.
• Toma tu medicamento como indicamos.
• NO escupas, NO fumes, NO uses pajillas durante 7 días.
• Reposo relativo hoy y mañana.

Si presentas dolor intenso, sangrado abundante o fiebre: contáctanos de inmediato.

— {clinicName}`.trim(),

  POST_PLACEMENT_DAY_7: (patientName: string, time: string) =>
    `Hola ${patientName}, te recordamos tu cita de retiro de suturas mañana a las ${time}. Por favor, mantén la higiene cuidadosa hasta la cita.`.trim(),

  OSSEOINTEGRATION_CHECK_3M: (patientName: string) =>
    `${patientName}, han pasado 3 meses de la colocación de tu implante. Es momento del control de oseointegración para confirmar que el hueso ha integrado correctamente y planear la corona definitiva.`.trim(),

  PROSTHETIC_LOADING_REMINDER: (patientName: string) =>
    `Hola ${patientName}, tu implante está listo para la fase protésica (toma de impresión y colocación de la corona). Agenda tu cita respondiendo este mensaje.`.trim(),

  PERI_IMPLANT_MAINTENANCE: (patientName: string, months: number) =>
    `Hola ${patientName}, han pasado ${months} meses de tu última evaluación periimplantar. Para mantener la salud de tu implante a largo plazo es importante una revisión cada 6 meses. ¿Te agendamos?`.trim(),
} as const;

export type ImplantWhatsAppTemplateKey = keyof typeof IMPLANT_WHATSAPP_TEMPLATES;
