// Endodontics — plantillas WhatsApp para recordatorios pre-TC, pos-TC,
// restauración, controles 6m/12m/24m. Spec §10.7

export type EndoWhatsAppKey =
  | "preTcReminder"
  | "postTcImmediate"
  | "restorationReminder7d"
  | "restorationReminder21d"
  | "followUp6m"
  | "followUp12m"
  | "followUp24m"
  | "followUpResultPositive";

export interface EndoWaTemplateContext {
  patientName: string;
  toothFdi?: number;
  dateTime?: string;
  doctorName?: string;
  nextDate?: string;
}

/**
 * Plantillas oficiales del módulo. Spec §10.7. Todas en es-MX neutro.
 * Se encolan en el job runner de WhatsApp existente; este helper solo
 * construye el cuerpo del mensaje.
 */
export const ENDO_WA_TEMPLATES: Record<EndoWhatsAppKey, (c: EndoWaTemplateContext) => string> = {
  preTcReminder: ({ patientName, dateTime, doctorName }) =>
    `Hola ${patientName}, te recordamos tu cita endodóntica el ${dateTime ?? "[fecha]"}` +
    `${doctorName ? ` con ${doctorName}` : ""}. ` +
    `Recomendaciones: come algo ligero 1 hora antes, trae tus radiografías recientes si las tienes. ` +
    `Cualquier duda, responde a este mensaje.`,

  postTcImmediate: ({ patientName, toothFdi }) =>
    `${patientName}, tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"} se completó hoy. ` +
    `Es normal sentir sensibilidad por 24 a 72 horas. Toma tu medicamento como te indicamos. ` +
    `Si el dolor es intenso o persiste más de 3 días, llámanos.`,

  restorationReminder7d: ({ patientName, toothFdi }) =>
    `${patientName}, han pasado 7 días de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. ` +
    `Recuerda agendar tu restauración definitiva (corona, onlay o resina) en las próximas 3 semanas para evitar fractura del diente.`,

  restorationReminder21d: ({ patientName, toothFdi }) =>
    `${patientName}, ya van 21 días desde tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"} y aún no tienes la restauración definitiva. ` +
    `Tu diente está en riesgo de fractura. Agenda lo antes posible respondiendo este mensaje.`,

  followUp6m: ({ patientName, toothFdi }) =>
    `${patientName}, te recordamos que pronto cumples 6 meses de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. ` +
    `Aunque no tengas molestias, el control radiográfico es importante para confirmar el éxito del tratamiento. Agenda tu control respondiendo este mensaje.`,

  followUp12m: ({ patientName, toothFdi }) =>
    `${patientName}, ya cumpliste un año de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. ` +
    `Te invitamos a tu control anual para verificar la cicatrización.`,

  followUp24m: ({ patientName, toothFdi }) =>
    `${patientName}, han pasado 2 años de tu tratamiento de conductos en el diente ${toothFdi ?? "[diente]"}. ` +
    `Este es el último control de seguimiento programado. Agenda para confirmar éxito final del tratamiento.`,

  followUpResultPositive: ({ patientName, toothFdi, nextDate }) =>
    `${patientName}, tu control endodóntico en el diente ${toothFdi ?? "[diente]"} fue exitoso. ` +
    `Todo evoluciona bien.${nextDate ? ` Tu siguiente control está programado para ${nextDate}.` : ""}`,
};

/**
 * Construye el mensaje de una plantilla.
 */
export function buildEndoWhatsAppMessage(
  key: EndoWhatsAppKey,
  context: EndoWaTemplateContext,
): string {
  return ENDO_WA_TEMPLATES[key](context);
}
