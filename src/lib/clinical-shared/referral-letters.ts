/**
 * Helpers para hojas de referencia clínicas (ReferralLetter).
 * El schema tiene `summary` y `reason` libres — aquí proveemos plantillas
 * pre-cargadas por kind de envío con placeholders {{var}}.
 */
import { z } from "zod";
import { renderTemplateString } from "./evolution-templates";
import {
  IMPLANT_REFERRAL_KINDS,
  type ImplantReferralKind,
} from "./types";

export const referralLetterCreateSchema = z.object({
  patientId: z.string().min(1),
  module: z.enum([
    "pediatrics",
    "endodontics",
    "periodontics",
    "implants",
    "orthodontics",
  ]),
  contactId: z.string().nullable().optional(),
  reason: z.string().min(1).max(500),
  summary: z.string().min(1).max(5000),
  /** kind libre — para implantes usar ImplantReferralKind. */
  referralKind: z.string().min(1).max(80).optional(),
});

export type ReferralLetterCreateInput = z.infer<
  typeof referralLetterCreateSchema
>;

// ── Plantillas para implantes ───────────────────────────────────────

export interface ImplantReferralTemplate {
  kind: ImplantReferralKind;
  toSpecialty: string;
  defaultSubject: string;
  /** Plantilla con placeholders `{{var}}`. */
  reasonTemplate: string;
  summaryTemplate: string;
  treatmentPlanTemplate: string;
}

export const IMPLANT_REFERRAL_TEMPLATES: ReadonlyArray<ImplantReferralTemplate> =
  [
    {
      kind: "envio_cirujano_oral",
      toSpecialty: "Cirugía oral y maxilofacial",
      defaultSubject: "Envío para colocación de implante {{toothFdi}}",
      reasonTemplate:
        "Solicito su valoración y, en su caso, colocación quirúrgica del implante en {{toothFdi}}. Se anexa CBCT y plan protésico preliminar.",
      summaryTemplate:
        "Paciente {{patientName}} ({{patientAge}} años, sexo {{patientSex}}). Plan implantológico aprobado para sustituir {{toothFdi}}. Implante seleccionado: {{implantBrand}} {{implantDiameter}}×{{implantLength}} mm, conexión {{connectionType}}. Fase actual: {{currentPhase}}. Antecedentes médicos relevantes: {{medicalHistory}}. Hábitos: {{habits}}. ASA {{asa}}.",
      treatmentPlanTemplate:
        "1) Cirugía con guía estereotáxica.\n2) Protocolo {{protocol}}.\n3) Pilar de cicatrización: registrar lote y dimensiones en expediente.\n4) Sutura {{sutureMaterial}}; retiro a 10 días.\n5) Evaluación a 4 meses para fase protésica.",
    },
    {
      kind: "envio_prostodoncista",
      toSpecialty: "Prostodoncia",
      defaultSubject: "Envío para fase protésica de implante {{toothFdi}}",
      reasonTemplate:
        "Solicito su valoración para fase protésica: pilar definitivo y corona implanto-soportada sobre el implante en {{toothFdi}}.",
      summaryTemplate:
        "Paciente {{patientName}} con implante {{implantBrand}} {{implantDiameter}}×{{implantLength}} mm en {{toothFdi}}, colocado el {{placedAt}}. ISQ último control: {{isqLatest}}. Oseointegrado clínica y radiográficamente. Pilar de cicatrización lote {{healingAbutmentLot}}. Fase actual: {{currentPhase}}.",
      treatmentPlanTemplate:
        "1) Pilar definitivo {{abutmentTypePreferred}}.\n2) Corona {{prosthesisTypePreferred}} material {{prosthesisMaterialPreferred}}.\n3) Color {{shade}}.\n4) Esquema oclusal: {{occlusionScheme}}.\n5) Entrega y carnet del implante.",
    },
    {
      kind: "envio_periodoncista",
      toSpecialty: "Periodoncia",
      defaultSubject: "Envío por sospecha de peri-implantitis en {{toothFdi}}",
      reasonTemplate:
        "Solicito su valoración por sospecha de peri-implantitis en el implante {{toothFdi}}.",
      summaryTemplate:
        "Paciente {{patientName}} con implante {{implantBrand}} en {{toothFdi}}, colocado el {{placedAt}}. Hallazgos: BoP {{bop}}, PD máxima {{pdMax}} mm, supuración {{suppuration}}, pérdida ósea radiográfica {{boneLoss}} mm. Higiene oral: {{hygiene}}. Hábitos relevantes: {{habits}}.",
      treatmentPlanTemplate:
        "1) Tratamiento periimplantar conservador (desbridamiento mecánico, quimioterapia local) o quirúrgico según valoración.\n2) Reevaluación en 3 meses.\n3) Mantenimiento periimplantar trimestral.",
    },
    {
      kind: "envio_endodoncista",
      toSpecialty: "Endodoncia",
      defaultSubject: "Envío para tratamiento endodóntico previo a implante",
      reasonTemplate:
        "Solicito tratamiento endodóntico de {{toothFdi}} previo a colocación del implante en {{implantToothFdi}}.",
      summaryTemplate:
        "Paciente {{patientName}} con plan implantológico que requiere preservación de {{toothFdi}} adyacente al sitio del implante en {{implantToothFdi}}.",
      treatmentPlanTemplate:
        "1) Tratamiento endodóntico de {{toothFdi}}.\n2) Restauración coronaria.\n3) Reevaluación pre-implante en 1 mes.",
    },
  ];

export function getImplantReferralTemplate(
  kind: ImplantReferralKind,
): ImplantReferralTemplate {
  const t = IMPLANT_REFERRAL_TEMPLATES.find((x) => x.kind === kind);
  if (!t) throw new Error(`Plantilla de referencia desconocida: ${kind}`);
  return t;
}

export function isImplantReferralKind(value: string): value is ImplantReferralKind {
  return (IMPLANT_REFERRAL_KINDS as readonly string[]).includes(value);
}

export function referralKindLabel(kind: string): string {
  switch (kind) {
    case "envio_cirujano_oral":
      return "Envío a cirujano oral";
    case "envio_prostodoncista":
      return "Envío a prostodoncista";
    case "envio_periodoncista":
      return "Envío a periodoncista";
    case "envio_endodoncista":
      return "Envío a endodoncista";
    default:
      return kind;
  }
}

/**
 * Hidrata una plantilla con contexto y devuelve {reason, summary, plan}.
 */
export function renderImplantReferralTemplate(
  kind: ImplantReferralKind,
  context: Record<string, string | number | null | undefined>,
): { reason: string; summary: string; treatmentPlan: string; subject: string } {
  const tpl = getImplantReferralTemplate(kind);
  return {
    reason: renderTemplateString(tpl.reasonTemplate, context),
    summary: renderTemplateString(tpl.summaryTemplate, context),
    treatmentPlan: renderTemplateString(tpl.treatmentPlanTemplate, context),
    subject: renderTemplateString(tpl.defaultSubject, context),
  };
}
