/**
 * Plantillas de receta cross-modulo. Centraliza los presets clínicos por
 * especialidad para poder pre-cargar el modal genérico de receta.
 *
 * Específicamente para Implantes 4/5:
 *   - implant_post_surgery       (cirugía de colocación, profilaxis)
 *   - implant_post_second_stage  (descubrimiento — analgesia + antiséptico)
 *   - implant_peri_implantitis   (infección peri-implantar)
 *
 * Cada plantilla devuelve `items[]` (medicamentos con dosaje) +
 * `indications` (texto libre que el sistema NOM-024 incluye).
 */

export type PrescriptionTemplateKey =
  | "implant_post_surgery"
  | "implant_post_second_stage"
  | "implant_peri_implantitis";

export interface PrescriptionItem {
  /** Nombre comercial / DCI legible. */
  drugName: string;
  /** Presentación (eg. "tab 875/125 mg"). */
  presentation: string;
  /** Posología (eg. "1 tableta cada 12 horas"). */
  dosage: string;
  /** Duración (eg. "5 días"). */
  duration: string;
  /** Vía (oral, tópica, etc.). */
  route: string;
  /** Notas adicionales (eg. "tomar con alimentos"). */
  notes?: string;
}

export interface PrescriptionTemplate {
  key: PrescriptionTemplateKey;
  /** Etiqueta humana para el picker. */
  label: string;
  /** Descripción corta. */
  description: string;
  /** Especialidad del módulo. */
  specialty: "implants";
  /** Items a pre-cargar en el modal de receta. */
  items: PrescriptionItem[];
  /** Indicaciones generales que se concatenan al final. */
  indications: string;
}

/**
 * Implantes — post-cirugía de colocación.
 * Combinación estándar:
 *  - Amoxicilina + ácido clavulánico (antibiótico)
 *  - Ibuprofeno (analgesia/antiinflamatorio)
 *  - Clorhexidina al 0.12% (enjuague)
 *  - Colchicina si profilaxis de pericoronaritis aguda en sitio crítico
 */
export const IMPLANT_POST_SURGERY_TEMPLATE: PrescriptionTemplate = {
  key: "implant_post_surgery",
  label: "Post-cirugía de implante",
  description:
    "Antibiótico + analgesia + antiséptico tras colocación de implante.",
  specialty: "implants",
  items: [
    {
      drugName: "Amoxicilina con ácido clavulánico",
      presentation: "Tableta 875/125 mg",
      dosage: "1 tableta cada 12 horas",
      duration: "7 días",
      route: "Vía oral",
      notes: "Iniciar 24 h antes de la cirugía. Tomar con alimentos.",
    },
    {
      drugName: "Ibuprofeno",
      presentation: "Tableta 400 mg",
      dosage: "1 tableta cada 8 horas en caso de dolor",
      duration: "Máximo 5 días",
      route: "Vía oral",
      notes:
        "No exceder 1200 mg/día. Suspender si dolor cede. Evitar en úlcera péptica activa.",
    },
    {
      drugName: "Clorhexidina al 0.12%",
      presentation: "Enjuague bucal 240 ml",
      dosage: "15 ml en buches por 30 segundos cada 12 horas",
      duration: "10 días",
      route: "Tópica oral",
      notes:
        "Esperar al menos 30 min después del cepillado. No comer ni beber 30 min después.",
    },
    {
      drugName: "Colchicina",
      presentation: "Tableta 1 mg",
      dosage: "1 tableta cada 24 horas",
      duration: "3 días (solo si profilaxis indicada por riesgo elevado)",
      route: "Vía oral",
      notes:
        "Solo en pacientes con antecedente de pericoronaritis aguda o sitio crítico. Suspender ante diarrea.",
    },
  ],
  indications:
    "Aplicar hielo intermitente las primeras 24 h. Dieta blanda y fría 48 h. Evitar enjuagues vigorosos las primeras 24 h. No fumar mínimo 7 días. Cepillar con cuidado, evitando la zona de sutura. Acudir a retiro de sutura a los 10 días. Acudir de inmediato si presenta dolor intenso, fiebre persistente, sangrado abundante o supuración.",
};

/**
 * Implantes — post-segunda fase (descubrimiento).
 * Procedimiento menor; no se pauta antibiótico de rutina:
 *  - Ibuprofeno (analgesia)
 *  - Clorhexidina al 0.12% (enjuague)
 */
export const IMPLANT_POST_SECOND_STAGE_TEMPLATE: PrescriptionTemplate = {
  key: "implant_post_second_stage",
  label: "Post-segunda fase del implante",
  description:
    "Analgesia + antiséptico tras descubrimiento del implante. Sin antibiótico de rutina.",
  specialty: "implants",
  items: [
    {
      drugName: "Ibuprofeno",
      presentation: "Tableta 400 mg",
      dosage: "1 tableta cada 8 horas en caso de dolor",
      duration: "Máximo 3 días",
      route: "Vía oral",
      notes: "No exceder 1200 mg/día. Suspender si dolor cede.",
    },
    {
      drugName: "Clorhexidina al 0.12%",
      presentation: "Enjuague bucal 240 ml",
      dosage: "15 ml en buches por 30 segundos cada 12 horas",
      duration: "7 días",
      route: "Tópica oral",
      notes:
        "Esperar al menos 30 min después del cepillado. No comer ni beber 30 min después.",
    },
  ],
  indications:
    "Dieta blanda 24 h. Evitar enjuagues vigorosos las primeras 24 h. No fumar mínimo 5 días. Cita en 4 semanas para inicio de fase protésica. Acudir de inmediato si presenta dolor intenso, sangrado abundante o supuración.",
};

/**
 * Implantes — peri-implantitis.
 * Tratamiento antibiótico + analgésico + antiséptico tópico:
 *  - Amoxicilina con ácido clavulánico
 *  - Ibuprofeno
 *  - Clorhexidina al 0.12%
 */
export const IMPLANT_PERI_IMPLANTITIS_TEMPLATE: PrescriptionTemplate = {
  key: "implant_peri_implantitis",
  label: "Peri-implantitis",
  description:
    "Antibiótico + analgesia + antiséptico tópico para peri-implantitis.",
  specialty: "implants",
  items: [
    {
      drugName: "Amoxicilina con ácido clavulánico",
      presentation: "Tableta 875/125 mg",
      dosage: "1 tableta cada 12 horas",
      duration: "7 a 10 días según evolución",
      route: "Vía oral",
      notes: "Tomar con alimentos. Completar el esquema completo.",
    },
    {
      drugName: "Ibuprofeno",
      presentation: "Tableta 400 mg",
      dosage: "1 tableta cada 8 horas en caso de dolor",
      duration: "Máximo 5 días",
      route: "Vía oral",
      notes: "No exceder 1200 mg/día. Suspender si dolor cede.",
    },
    {
      drugName: "Clorhexidina al 0.12%",
      presentation: "Enjuague bucal 240 ml",
      dosage: "15 ml en buches por 30 segundos cada 12 horas",
      duration: "14 días",
      route: "Tópica oral",
      notes:
        "Esperar al menos 30 min después del cepillado. Considerar gel para aplicación local en surco peri-implantar.",
    },
  ],
  indications:
    "Reforzar técnica de higiene oral con cepillo interproximal y/o de cerdas suaves. Evitar tabaquismo. Cita de revaloración en 7 días. Si no hay mejoría clínica (BoP, supuración, dolor) en ese periodo, valorar tratamiento quirúrgico. Acudir de inmediato ante fiebre o aumento del dolor.",
};

export const PRESCRIPTION_TEMPLATES: ReadonlyArray<PrescriptionTemplate> = [
  IMPLANT_POST_SURGERY_TEMPLATE,
  IMPLANT_POST_SECOND_STAGE_TEMPLATE,
  IMPLANT_PERI_IMPLANTITIS_TEMPLATE,
];

export function getPrescriptionTemplate(
  key: PrescriptionTemplateKey,
): PrescriptionTemplate {
  const t = PRESCRIPTION_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Plantilla de receta desconocida: ${key}`);
  return t;
}

export function listPrescriptionTemplatesBySpecialty(
  specialty: "implants",
): PrescriptionTemplate[] {
  return PRESCRIPTION_TEMPLATES.filter((t) => t.specialty === specialty);
}

/**
 * Renderiza una plantilla como bloque legible (texto plano con bullets)
 * — útil para el preview en el picker.
 */
export function renderPrescriptionTextPreview(
  tpl: PrescriptionTemplate,
): string {
  const lines: string[] = [];
  for (const it of tpl.items) {
    lines.push(`• ${it.drugName} ${it.presentation}`);
    lines.push(`  ${it.dosage} · ${it.route} · ${it.duration}`);
    if (it.notes) lines.push(`  Notas: ${it.notes}`);
  }
  lines.push("");
  lines.push("Indicaciones generales:");
  lines.push(tpl.indications);
  return lines.join("\n");
}
