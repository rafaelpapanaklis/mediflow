/**
 * Helpers para programación de recordatorios clínicos (ClinicalReminder).
 * El cron diario (vercel.json) detecta los con dueDate <= today + ventana
 * y crea WhatsAppReminder con la plantilla correspondiente.
 */
import { z } from "zod";
import {
  IMPLANT_REMINDER_OFFSETS_DAYS,
  IMPLANT_REMINDER_RULE_KEYS,
  implantReminderRuleToReminderType,
  type ClinicalReminderType,
  type ImplantReminderRuleKey,
} from "./types";

export const reminderCreateSchema = z.object({
  patientId: z.string().min(1),
  module: z.enum([
    "pediatrics",
    "endodontics",
    "periodontics",
    "implants",
    "orthodontics",
  ]),
  reminderType: z.string().min(1),
  dueDate: z.coerce.date(),
  message: z.string().nullable().optional(),
  payload: z.record(z.unknown()).nullable().optional(),
});

export type ReminderCreateInput = z.infer<typeof reminderCreateSchema>;

export interface ImplantReminderRuleSpec {
  ruleKey: ImplantReminderRuleKey;
  reminderType: ClinicalReminderType;
  triggerOffsetDays: number;
  triggeredBy: "SURGERY_DATE" | "SECOND_STAGE_DATE" | "PROSTHESIS_DELIVERED_AT";
  defaultTitle: string;
}

export const IMPLANT_REMINDER_RULES: ReadonlyArray<ImplantReminderRuleSpec> = [
  {
    ruleKey: "control_cicatrizacion_7d",
    reminderType: "implant_cicatrizacion_7d",
    triggerOffsetDays: IMPLANT_REMINDER_OFFSETS_DAYS.control_cicatrizacion_7d,
    triggeredBy: "SURGERY_DATE",
    defaultTitle: "Control de cicatrización (7 días post-cirugía)",
  },
  {
    ruleKey: "retiro_sutura_10d",
    reminderType: "implant_retiro_sutura_10d",
    triggerOffsetDays: IMPLANT_REMINDER_OFFSETS_DAYS.retiro_sutura_10d,
    triggeredBy: "SURGERY_DATE",
    defaultTitle: "Retiro de sutura (10 días post-cirugía)",
  },
  {
    ruleKey: "control_oseointegracion_4m",
    reminderType: "implant_oseointegracion_4m",
    triggerOffsetDays: IMPLANT_REMINDER_OFFSETS_DAYS.control_oseointegracion_4m,
    triggeredBy: "SURGERY_DATE",
    defaultTitle: "Control de oseointegración (4 meses)",
  },
  {
    ruleKey: "control_anual_implante",
    reminderType: "implant_control_anual",
    triggerOffsetDays: IMPLANT_REMINDER_OFFSETS_DAYS.control_anual_implante,
    triggeredBy: "PROSTHESIS_DELIVERED_AT",
    defaultTitle: "Control anual del implante",
  },
  {
    ruleKey: "control_peri_implantitis_6m",
    reminderType: "implant_peri_implantitis_6m",
    triggerOffsetDays: IMPLANT_REMINDER_OFFSETS_DAYS.control_peri_implantitis_6m,
    triggeredBy: "PROSTHESIS_DELIVERED_AT",
    defaultTitle: "Control peri-implantario (6 meses)",
  },
];

export function getImplantReminderRuleSpec(
  key: ImplantReminderRuleKey,
): ImplantReminderRuleSpec {
  const r = IMPLANT_REMINDER_RULES.find((x) => x.ruleKey === key);
  if (!r) throw new Error(`Regla de recordatorio desconocida: ${key}`);
  return r;
}

export function isImplantReminderRuleKey(value: string): value is ImplantReminderRuleKey {
  return (IMPLANT_REMINDER_RULE_KEYS as readonly string[]).includes(value);
}

/**
 * Calcula `dueDate` sumando offsetDays a una fecha base. Hora 15Z (≈09:00
 * MX) para evitar mensajes de madrugada.
 */
export function computeDueDate(baseDate: Date, offsetDays: number): Date {
  const d = new Date(baseDate);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(15, 0, 0, 0);
  return d;
}

/**
 * Plan de reglas a programar para un implante.
 */
export function planImplantReminderRules(implant: {
  surgeryDate?: Date | null;
  secondStageDate?: Date | null;
  prosthesisDeliveredAt?: Date | null;
}): Array<{ rule: ImplantReminderRuleSpec; dueDate: Date }> {
  const out: Array<{ rule: ImplantReminderRuleSpec; dueDate: Date }> = [];
  for (const rule of IMPLANT_REMINDER_RULES) {
    let base: Date | null | undefined;
    switch (rule.triggeredBy) {
      case "SURGERY_DATE":
        base = implant.surgeryDate;
        break;
      case "SECOND_STAGE_DATE":
        base = implant.secondStageDate;
        break;
      case "PROSTHESIS_DELIVERED_AT":
        base = implant.prosthesisDeliveredAt;
        break;
    }
    if (!base) continue;
    out.push({ rule, dueDate: computeDueDate(base, rule.triggerOffsetDays) });
  }
  return out;
}

// ── Plantillas WhatsApp por ruleKey ─────────────────────────────────

export const IMPLANT_REMINDER_WHATSAPP_TEMPLATES: Record<
  ImplantReminderRuleKey,
  string
> = {
  control_cicatrizacion_7d:
    "Hola {{patientName}}, le recordamos su cita de control de cicatrización del implante en el diente {{toothFdi}} esta semana. Continúe con clorhexidina y dieta blanda. Si presenta dolor intenso, fiebre o sangrado abundante, contáctenos de inmediato.",
  retiro_sutura_10d:
    "Hola {{patientName}}, hoy o mañana corresponde el retiro de sutura del implante en el diente {{toothFdi}}. Por favor confirme su cita. Llegue con la zona limpia, sin enjuague justo antes.",
  control_oseointegracion_4m:
    "Hola {{patientName}}, han pasado 4 meses desde la cirugía del implante en el diente {{toothFdi}}. Es momento del control de oseointegración con radiografía para iniciar la fase protésica. Confirme su cita.",
  control_anual_implante:
    "Hola {{patientName}}, le recordamos su control anual del implante en el diente {{toothFdi}}. Realizaremos limpieza profesional periimplantar y radiografía para verificar estabilidad ósea.",
  control_peri_implantitis_6m:
    "Hola {{patientName}}, le recordamos el control semestral peri-implantario del implante en el diente {{toothFdi}}. Es importante para detección temprana de cualquier complicación.",
};

export function renderImplantReminderMessage(
  ruleKey: ImplantReminderRuleKey,
  payload: Record<string, string | number | undefined>,
): string {
  const tpl = IMPLANT_REMINDER_WHATSAPP_TEMPLATES[ruleKey];
  return tpl.replace(/\{\{(\w+)\}\}/g, (raw, key: string) => {
    const v = payload[key];
    return v == null ? raw : String(v);
  });
}

export { implantReminderRuleToReminderType };
