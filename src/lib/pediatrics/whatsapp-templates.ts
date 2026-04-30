// Pediatrics — plantillas WhatsApp dirigidas al tutor del menor. Spec: §4.B.7

export type PediatricTemplateKey =
  | "PED_PRECITA"
  | "PED_POSTFLUOR"
  | "PED_SELANTE_REVISION"
  | "PED_CUMPLE";

export type PediatricTemplateContext = {
  childName: string;
  guardianName: string;
  clinicName: string;
  appointmentDate?: string;
  appointmentTime?: string;
  doctorName?: string;
};

interface TemplateDef {
  key: PediatricTemplateKey;
  label: string;
  description: string;
  build: (ctx: PediatricTemplateContext) => string;
}

export const PEDIATRIC_WHATSAPP_TEMPLATES: TemplateDef[] = [
  {
    key: "PED_PRECITA",
    label: "Recordatorio pre-cita",
    description: "24h antes de la consulta, dirigido al tutor.",
    build: (c) =>
      [
        `Hola, ${c.guardianName}. Te recordamos que ${c.childName} tiene cita`,
        c.appointmentDate ? `el ${c.appointmentDate}` : "mañana",
        c.appointmentTime ? `a las ${c.appointmentTime}` : "",
        c.doctorName ? `con ${c.doctorName}` : `en ${c.clinicName}`,
        "\n\nSi necesitas reagendar, responde a este mensaje. Te esperamos.",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    key: "PED_POSTFLUOR",
    label: "Indicaciones post-fluorización",
    description: "Inmediatamente después de aplicar barniz/gel de flúor.",
    build: (c) =>
      [
        `${c.guardianName}, ${c.childName} acaba de recibir su aplicación de flúor.`,
        `Por favor evita que coma o beba durante los próximos 30 minutos`,
        `y no te cepilles los dientes hasta mañana en la mañana.`,
        `\nSi tienes dudas, llámanos a ${c.clinicName}.`,
      ].join(" "),
  },
  {
    key: "PED_SELANTE_REVISION",
    label: "Recordatorio revisión de sellantes",
    description: "Cada 6 meses tras colocación.",
    build: (c) =>
      [
        `Hola, ${c.guardianName}. Es hora de revisar los sellantes de ${c.childName}`,
        `para verificar que sigan protegiendo sus molares.`,
        `\n\nAgenda la revisión respondiendo a este mensaje o llamando a ${c.clinicName}.`,
      ].join(" "),
  },
  {
    key: "PED_CUMPLE",
    label: "Felicitación de cumpleaños",
    description: "Mensaje de cumpleaños del menor.",
    build: (c) =>
      [
        `¡Felicidades, ${c.childName}! 🎂`,
        `\nDe parte de todo el equipo de ${c.clinicName} te deseamos un día muy feliz`,
        `y mucha salud bucal en este nuevo año.`,
      ].join(" "),
  },
];

const TEMPLATE_BY_KEY: ReadonlyMap<PediatricTemplateKey, TemplateDef> = new Map(
  PEDIATRIC_WHATSAPP_TEMPLATES.map((t) => [t.key, t]),
);

export function buildPediatricWhatsappMessage(
  key: PediatricTemplateKey,
  ctx: PediatricTemplateContext,
): string {
  const def = TEMPLATE_BY_KEY.get(key);
  if (!def) throw new Error(`Plantilla pediátrica desconocida: ${key}`);
  return def.build(ctx);
}

/**
 * Resuelve a qué teléfono se envía un mensaje pediátrico:
 *   - Si `guardianPhone` existe, va al tutor (recomendado para menores).
 *   - Si no, cae al `patientPhone` (paciente directo).
 *   - Si ninguno existe, lanza error explicativo.
 */
export function resolvePediatricRecipient(args: {
  guardianPhone?: string | null;
  patientPhone?: string | null;
}): { phone: string; recipient: "guardian" | "patient" } {
  if (args.guardianPhone && args.guardianPhone.trim().length > 0) {
    return { phone: args.guardianPhone, recipient: "guardian" };
  }
  if (args.patientPhone && args.patientPhone.trim().length > 0) {
    return { phone: args.patientPhone, recipient: "patient" };
  }
  throw new Error("El paciente pediátrico no tiene teléfono ni tutor con teléfono");
}
