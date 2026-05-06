// WhatsApp — plantillas dirigidas al tutor del paciente pediátrico.
//
// Estas 4 plantillas viven en este archivo cross-módulo (no en
// pediatrics/whatsapp-templates.ts) porque la spec del Sprint Cierre
// las pide aquí para que el modal "Enviar mensaje al tutor" las
// importe sin acoplarse al folder pediatrics. Las plantillas más
// antiguas (PED_PRECITA, PED_POSTFLUOR, PED_SELANTE_REVISION,
// PED_CUMPLE) siguen viviendo en pediatrics/whatsapp-templates.ts y
// se conservan para compatibilidad con módulos preexistentes.

export type TutorTemplateKey =
  | "ped_pre_cita"
  | "ped_post_cita_buen_comportamiento"
  | "ped_post_cita_recomendaciones"
  | "ped_aniversario_primera_visita";

export interface TutorTemplateContext {
  childName: string;
  guardianName: string;
  clinicName: string;
  doctorName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  /** Recomendaciones adicionales libres (lista a bullets). */
  recommendations?: string[];
  /** Para aniversario primera visita. */
  yearsSinceFirstVisit?: number;
}

export interface TutorTemplateDef {
  key: TutorTemplateKey;
  /** Prefijo para que el queue worker pueda hidratar el mensaje on-send. */
  prefix: "PED_TUTOR_";
  label: string;
  description: string;
  build: (ctx: TutorTemplateContext) => string;
}

export const PED_TUTOR_TEMPLATES: Record<TutorTemplateKey, TutorTemplateDef> = {
  ped_pre_cita: {
    key: "ped_pre_cita",
    prefix: "PED_TUTOR_",
    label: "Recordatorio pre-cita (tutor)",
    description: "24 horas antes de la consulta. Dirigido al tutor del menor.",
    build: (c) =>
      [
        `Hola, ${c.guardianName}.`,
        c.appointmentDate
          ? `Te recordamos que ${c.childName} tiene cita el ${c.appointmentDate}${c.appointmentTime ? ` a las ${c.appointmentTime}` : ""}`
          : `Te recordamos que ${c.childName} tiene cita mañana`,
        c.doctorName ? `con ${c.doctorName}` : `en ${c.clinicName}`,
        ".\n\nPor favor llega 10 minutos antes y trae cualquier estudio reciente.",
        "Si necesitas reagendar, responde a este mensaje. Te esperamos.",
      ].join(" "),
  },

  ped_post_cita_buen_comportamiento: {
    key: "ped_post_cita_buen_comportamiento",
    prefix: "PED_TUTOR_",
    label: "Felicitación por buen comportamiento (post-cita)",
    description:
      "Después de una visita con conducta cooperativa (Frankl 3-4). Refuerzo positivo al menor a través del tutor.",
    build: (c) =>
      [
        `${c.guardianName}, queremos felicitar a ${c.childName} por su excelente comportamiento durante la consulta de hoy.`,
        `Su cooperación nos permitió completar todo el plan sin contratiempos.`,
        `\n\nReconocer su esfuerzo en casa ayuda mucho a que las próximas visitas sean igual de positivas.`,
        `\n\nGracias por tu confianza,\n${c.clinicName}.`,
      ].join(" "),
  },

  ped_post_cita_recomendaciones: {
    key: "ped_post_cita_recomendaciones",
    prefix: "PED_TUTOR_",
    label: "Recomendaciones post-cita",
    description:
      "Inmediatamente después de la consulta — incluye lista personalizable de cuidados.",
    build: (c) => {
      const recs = (c.recommendations ?? []).filter(Boolean);
      const recBlock =
        recs.length > 0
          ? `\n\nIndicaciones para casa:\n${recs.map((r) => `• ${r}`).join("\n")}`
          : "";
      return [
        `Hola, ${c.guardianName}. Acabamos de atender a ${c.childName}.`,
        recBlock,
        `\n\nSi notas dolor persistente, sangrado o cualquier reacción inesperada, llámanos a ${c.clinicName}.`,
        c.doctorName ? `Atentamente, ${c.doctorName}.` : `Atentamente, ${c.clinicName}.`,
      ]
        .filter(Boolean)
        .join(" ");
    },
  },

  ped_aniversario_primera_visita: {
    key: "ped_aniversario_primera_visita",
    prefix: "PED_TUTOR_",
    label: "Aniversario de primera visita",
    description:
      "Al cumplirse N años de la primera visita pediátrica. Refuerza retención y agradecimiento.",
    build: (c) => {
      const years = c.yearsSinceFirstVisit ?? 1;
      const yearsLabel = years === 1 ? "el primer año" : `${years} años`;
      return [
        `${c.guardianName}, hoy se cumple${years === 1 ? "" : "n"} ${yearsLabel} desde que ${c.childName} llegó a ${c.clinicName} por primera vez.`,
        `\n\nGracias por confiar en nosotros para cuidar su sonrisa todo este tiempo.`,
        `Si quieres aprovechar para agendar su próxima revisión, responde este mensaje y te buscamos un horario.`,
      ].join(" ");
    },
  },
};

/** Lista ordenada para iteración en UI. */
export const PED_TUTOR_TEMPLATE_LIST: readonly TutorTemplateDef[] = Object.values(
  PED_TUTOR_TEMPLATES,
);

export function buildTutorMessage(
  key: TutorTemplateKey,
  ctx: TutorTemplateContext,
): string {
  const def = PED_TUTOR_TEMPLATES[key];
  if (!def) throw new Error(`Plantilla tutor desconocida: ${key}`);
  return def.build(ctx);
}
