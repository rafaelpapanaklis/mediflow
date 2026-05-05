// Endodontics — plantillas WhatsApp en formato unificado del worker
// (key sin prefijo; el worker antepone "ENDO_" para detectar). Spec §10.7.
//
// El helper legacy `whatsappTemplatesEndo.ts` (camelCase) sigue válido
// para callers internos del módulo; este diccionario es el contrato
// público que consume el queue worker A2.

export const ENDO_WHATSAPP_TEMPLATES = {
  RESTORATION_7D: (patientName: string, toothFdi?: number) =>
    `${patientName}, han pasado 7 días de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. Recuerda agendar tu restauración definitiva (corona, onlay o resina) en las próximas 3 semanas para evitar fractura del diente.`.trim(),

  RESTORATION_21D: (patientName: string, toothFdi?: number) =>
    `${patientName}, ya van 21 días desde tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"} y aún no tienes la restauración definitiva. Tu diente está en riesgo de fractura. Agenda lo antes posible respondiendo este mensaje.`.trim(),

  FOLLOWUP_6M: (patientName: string, toothFdi?: number) =>
    `${patientName}, te recordamos que pronto cumples 6 meses de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. Aunque no tengas molestias, el control radiográfico es importante para confirmar el éxito del tratamiento. Agenda tu control respondiendo este mensaje.`.trim(),

  FOLLOWUP_12M: (patientName: string, toothFdi?: number) =>
    `${patientName}, ya cumpliste un año de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. Te invitamos a tu control anual para verificar la cicatrización.`.trim(),

  FOLLOWUP_24M: (patientName: string, toothFdi?: number) =>
    `${patientName}, han pasado 2 años de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. Este es el último control de seguimiento programado. Agenda para confirmar éxito final del tratamiento.`.trim(),

  PRE_TC_REMINDER: (patientName: string, dateTime?: string, doctorName?: string) =>
    `Hola ${patientName}, te recordamos tu cita endodóntica el ${dateTime ?? "[fecha]"}${doctorName ? ` con ${doctorName}` : ""}. Recomendaciones: come algo ligero 1 hora antes, trae tus radiografías recientes si las tienes. Cualquier duda, responde a este mensaje.`.trim(),

  POST_TC_IMMEDIATE: (patientName: string, toothFdi?: number) =>
    `${patientName}, tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"} se completó hoy. Es normal sentir sensibilidad por 24 a 72 horas. Toma tu medicamento como te indicamos. Si el dolor es intenso o persiste más de 3 días, llámanos.`.trim(),
} as const;

export type EndoWhatsAppTemplateKey = keyof typeof ENDO_WHATSAPP_TEMPLATES;
