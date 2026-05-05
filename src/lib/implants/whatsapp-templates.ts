// Implants — plantillas WhatsApp con prefijo IMPL_*. Spec §8.7.
//
// Encolar con type='IMPLANT' (paralelo a Endo type='ENDO', Perio
// type='PERIO'). El worker que procesa type='IMPLANT' es pendiente
// futuro — no bloquea MVP.
//
// Patrón de pediatrics/whatsapp-templates.ts: cada template tiene
// `build(ctx)` que recibe el contexto y retorna el cuerpo final.

export type ImplantTemplateKey =
  | "IMPL_PRE_QUIRURGICO"
  | "IMPL_POST_QUIRURGICO"
  | "IMPL_RETIRO_SUTURAS"
  | "IMPL_OSTEOINTEGRACION"
  | "IMPL_INICIO_PROTESIS"
  | "IMPL_CONTROL_VENCIDO"
  | "IMPL_CONTROL_ANUAL";

export type ImplantTemplateContext = {
  patientName: string;
  clinicName: string;
  appointmentDate?: string;
  appointmentTime?: string;
  /** Semanas restantes de osteointegración. Se usa en IMPL_OSTEOINTEGRACION. */
  weeksRemaining?: number;
  /** Hito de control (e.g. "12 meses"). Se usa en IMPL_CONTROL_VENCIDO / ANUAL. */
  milestoneLabel?: string;
  /** Meses atrasados — IMPL_CONTROL_VENCIDO. */
  monthsOverdue?: number;
  /** Slots ofrecidos por la clínica al recall — IMPL_CONTROL_VENCIDO. */
  proposedSlots?: string;
};

interface TemplateDef {
  key: ImplantTemplateKey;
  label: string;
  description: string;
  build: (ctx: ImplantTemplateContext) => string;
}

export const IMPLANT_WHATSAPP_TEMPLATES: TemplateDef[] = [
  {
    key: "IMPL_PRE_QUIRURGICO",
    label: "Recordatorio pre-quirúrgico (24h antes)",
    description: "Profilaxis antibiótica + ayunas + acompañante.",
    build: (c) =>
      [
        `Hola, ${c.patientName}. Te recordamos tu cirugía de implante`,
        c.appointmentDate ? `el ${c.appointmentDate}` : "mañana",
        c.appointmentTime ? `a las ${c.appointmentTime}` : "",
        `en ${c.clinicName}.`,
        "",
        "Recuerda:",
        "• Toma tu antibiótico (amoxicilina 2 g) 1 h antes.",
        "• NO comer ni beber 2 h previas.",
        "• Cepilla y enjuaga con clorhexidina antes de salir.",
        "• Trae acompañante adulto.",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    key: "IMPL_POST_QUIRURGICO",
    label: "Cuidados post-cirugía (día 0)",
    description: "Inmediatamente al cierre de la cirugía.",
    build: (c) =>
      [
        `${c.patientName}, tu cirugía terminó. Cuidados de las próximas 48 h:`,
        "",
        "• Frío local 15 min cada hora primeras 24 h.",
        "• Antibiótico cada 12 h por 7 días (sin saltar dosis).",
        "• Antiinflamatorio cada 8 h por 3 días.",
        "• Inicia mañana clorhexidina cada 12 h por 14 días.",
        "• NO escupir, NO fumar, NO pajillas durante 7 días.",
        "• Dieta blanda y fría hoy y mañana.",
        "",
        `Si dolor intenso, sangrado abundante o fiebre: contáctanos en ${c.clinicName}.`,
      ].join(" "),
  },
  {
    key: "IMPL_RETIRO_SUTURAS",
    label: "Retiro de suturas (día 7)",
    description: "Recordatorio de cita para retiro.",
    build: (c) =>
      [
        `${c.patientName}, recordatorio: retiro de suturas`,
        c.appointmentDate ? `el ${c.appointmentDate}` : "mañana",
        c.appointmentTime ? `a las ${c.appointmentTime}` : "",
        ".",
        "",
        "Continúa clorhexidina hasta completar 14 días. Higiene cuidadosa sin tocar suturas. Evita alimentos duros.",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    key: "IMPL_OSTEOINTEGRACION",
    label: "Mitad de osteointegración (3, 4 o 6 meses según densidad)",
    description: "Check-in durante la cicatrización.",
    build: (c) =>
      [
        `Hola, ${c.patientName}. ¿Cómo va tu cicatrización?`,
        "Tu implante está en osteointegración.",
        c.weeksRemaining !== undefined
          ? `Faltan aproximadamente ${c.weeksRemaining} semanas para iniciar tu prótesis.`
          : "",
        "Mantén excelente higiene. Si notas movilidad, dolor o aspecto extraño en la encía, avísanos.",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    key: "IMPL_INICIO_PROTESIS",
    label: "Inicio de fase protésica",
    description: "Cuando se confirma la osteointegración.",
    build: (c) =>
      [
        `${c.patientName}, tu implante ya cicatrizó correctamente.`,
        "Es momento de iniciar la corona definitiva.",
        `Te agendaremos la toma de impresión desde ${c.clinicName}.`,
      ].join(" "),
  },
  {
    key: "IMPL_CONTROL_VENCIDO",
    label: "Control post-carga atrasado",
    description: "Recall obligatorio cuando el paciente no se presenta.",
    build: (c) =>
      [
        `${c.patientName}, tu control de ${c.milestoneLabel ?? "mantenimiento"}`,
        c.monthsOverdue ? `está atrasado por ${c.monthsOverdue} mes(es).` : "está pendiente.",
        "",
        "Aunque no sientas molestias, este control es OBLIGATORIO para verificar la salud de tu implante (revisión clínica + radiografía).",
        "",
        c.proposedSlots ? `Te ofrezco estos horarios: ${c.proposedSlots}` : `Llámanos a ${c.clinicName} para agendar.`,
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    key: "IMPL_CONTROL_ANUAL",
    label: "Control anual programado",
    description: "Recordatorio del aniversario del implante.",
    build: (c) =>
      [
        `${c.patientName}, ya pasó ${c.milestoneLabel ?? "1 año"} desde tu implante. ¡Felicidades!`,
        "Te recordamos tu control anual: revisión clínica + radiografía periapical.",
        c.appointmentDate
          ? `Cita programada: ${c.appointmentDate}${c.appointmentTime ? ` a las ${c.appointmentTime}` : ""}.`
          : `Agenda con nosotros desde ${c.clinicName}.`,
      ].join(" "),
  },
];

/**
 * Mapping legacy para integraciones que aún usan los nombres viejos.
 * Próxima sesión podemos eliminar esto cuando todos los call-sites
 * usen el prefijo IMPL_* directo.
 */
export const LEGACY_KEY_MAP: Record<string, ImplantTemplateKey> = {
  PRE_SURGERY_24H: "IMPL_PRE_QUIRURGICO",
  POST_SURGERY_DAY_0: "IMPL_POST_QUIRURGICO",
  POST_SURGERY_DAY_7: "IMPL_RETIRO_SUTURAS",
  MID_OSSEOINTEGRATION: "IMPL_OSTEOINTEGRACION",
  PROSTHETIC_PHASE_START: "IMPL_INICIO_PROTESIS",
  POST_LOAD_FOLLOWUP_OVERDUE: "IMPL_CONTROL_VENCIDO",
};

export function getTemplate(
  key: ImplantTemplateKey,
): TemplateDef | undefined {
  return IMPLANT_WHATSAPP_TEMPLATES.find((t) => t.key === key);
}

export function renderImplantTemplate(
  key: ImplantTemplateKey,
  ctx: ImplantTemplateContext,
): string {
  const t = getTemplate(key);
  if (!t) throw new Error(`Plantilla WhatsApp implant desconocida: ${key}`);
  return t.build(ctx);
}
