// WhatsApp — plantillas dirigidas al paciente endodóntico para el modal
// "Enviar mensaje al paciente" del tab Endodoncia. Convive con
// templates.ts (que contiene las plantillas pediátricas dirigidas al
// tutor); ambas tienen prefix distinto para que el queue worker A2 las
// hidrate sin colisionar.

export type EndoTemplateKey =
  | "endo_precita_tc"
  | "endo_post_tc_inmediato"
  | "endo_recordatorio_restauracion"
  | "endo_control_seguimiento";

export interface EndoTemplateContext {
  patientName?: string;
  toothFdi?: number;
  dateTime?: string;
  doctorName?: string;
}

export interface EndoTemplateDef {
  key: EndoTemplateKey;
  /** Prefijo que el queue worker A2 reconoce (ENDO_*). */
  prefix: "ENDO_";
  label: string;
  description: string;
  build: (ctx: EndoTemplateContext) => string;
}

const fallbackPatient = (name?: string) => name?.trim() || "[paciente]";
const fallbackTooth = (n?: number) =>
  typeof n === "number" && n >= 11 && n <= 85 ? n.toString() : "[diente]";

export const ENDO_WA_TEMPLATES: Record<EndoTemplateKey, EndoTemplateDef> = {
  endo_precita_tc: {
    key: "endo_precita_tc",
    prefix: "ENDO_",
    label: "Pre-cita endodóntica",
    description:
      "Recordatorio el día previo a la cita de tratamiento de conductos. Incluye recomendaciones generales de preparación.",
    build: (c) =>
      [
        `Hola ${fallbackPatient(c.patientName)}, te recordamos tu cita de tratamiento de conductos para el ${c.dateTime ?? "[fecha]"}${
          c.doctorName ? ` con el Dr./Dra. ${c.doctorName}` : ""
        }.`,
        "",
        "Recomendaciones:",
        "• Come algo ligero 1 hora antes de la cita.",
        "• Si tomas algún medicamento habitual, continúa con el horario regular.",
        "• Trae las radiografías recientes que tengas, aunque hayan sido de otra clínica.",
        "",
        "Si necesitas reagendar, responde este mensaje.",
      ].join("\n"),
  },

  endo_post_tc_inmediato: {
    key: "endo_post_tc_inmediato",
    prefix: "ENDO_",
    label: "Post-TC inmediato",
    description:
      "Indicaciones del mismo día en que se completó el tratamiento de conductos.",
    build: (c) =>
      [
        `${fallbackPatient(c.patientName)}, tu tratamiento de conductos en la pieza ${fallbackTooth(c.toothFdi)} se completó hoy.`,
        "",
        "Es normal sentir sensibilidad ligera entre 24 y 72 horas. Por favor:",
        "• Toma el medicamento que te indicamos en el horario señalado.",
        "• Evita masticar del lado tratado por 24 horas.",
        "• Si el dolor se intensifica o aparece edema, llámanos.",
        "",
        "Cualquier duda, responde este mensaje.",
      ].join("\n"),
  },

  endo_recordatorio_restauracion: {
    key: "endo_recordatorio_restauracion",
    prefix: "ENDO_",
    label: "Recordatorio de restauración",
    description:
      "Aviso para agendar la restauración definitiva (corona, onlay) tras el TC. Caso típico: 7 a 21 días después de la obturación.",
    build: (c) =>
      [
        `${fallbackPatient(c.patientName)}, ya pasaron varios días desde tu tratamiento de conductos en la pieza ${fallbackTooth(c.toothFdi)}.`,
        "",
        "Recuerda agendar tu restauración definitiva (corona, onlay o resina) en las próximas 3 semanas para evitar fracturas en el diente tratado.",
        "",
        "Responde este mensaje y te ayudamos a agendar.",
      ].join("\n"),
  },

  endo_control_seguimiento: {
    key: "endo_control_seguimiento",
    prefix: "ENDO_",
    label: "Control de seguimiento",
    description:
      "Recordatorio de control radiográfico (6 / 12 / 24 meses). El doctor edita la marca temporal que corresponda.",
    build: (c) =>
      [
        `${fallbackPatient(c.patientName)}, te recordamos que se acerca el control de tu tratamiento de conductos en la pieza ${fallbackTooth(c.toothFdi)}.`,
        "",
        "Aunque no tengas molestias, el control radiográfico nos permite confirmar el éxito del tratamiento y detectar cualquier cambio temprano.",
        "",
        "Agenda tu cita respondiendo a este mensaje.",
      ].join("\n"),
  },
};

export const ENDO_WA_TEMPLATE_LIST: readonly EndoTemplateDef[] = Object.values(
  ENDO_WA_TEMPLATES,
);

export function buildEndoWhatsAppMessage(
  key: EndoTemplateKey,
  ctx: EndoTemplateContext,
): string {
  const def = ENDO_WA_TEMPLATES[key];
  if (!def) throw new Error(`Plantilla endo desconocida: ${key}`);
  return def.build(ctx);
}
