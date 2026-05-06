/**
 * Plantillas de receta cross-modulo. Centraliza los presets clínicos por
 * especialidad para poder pre-cargar el modal genérico de receta.
 *
 * Implantes 4/5:
 *   - implant_post_surgery       (cirugía de colocación, profilaxis)
 *   - implant_post_second_stage  (descubrimiento — analgesia + antiséptico)
 *   - implant_peri_implantitis   (infección peri-implantar)
 *
 * Endodoncia (cierre):
 *   - endo_post_tc_basic         (post-TC sin infección, ibuprofeno)
 *   - endo_post_tc_absceso       (post-TC con absceso, amoxi+clavu + ibu)
 *   - endo_post_cirugia_apical   (post-cirugía apical, amoxi+clavu + ibu + clorhexidina)
 *
 * Cada plantilla devuelve `items[]` (medicamentos con dosaje) +
 * `indications` (texto libre que el sistema NOM-024 incluye).
 */

export type PrescriptionTemplateKey =
  | "implant_post_surgery"
  | "implant_post_second_stage"
  | "implant_peri_implantitis"
  | "endo_post_tc_basic"
  | "endo_post_tc_absceso"
  | "endo_post_cirugia_apical";

export type PrescriptionSpecialty = "implants" | "endodontics";

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
  specialty: PrescriptionSpecialty;
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

/**
 * Endodoncia — post-TC básica (sin infección).
 * Manejo del dolor post-operatorio inmediato sin signos de infección
 * activa. Útil tras pulpitis irreversible obturada en una sola cita
 * (caso típico Roberto Salinas TC en 36).
 */
export const ENDO_POST_TC_BASIC_TEMPLATE: PrescriptionTemplate = {
  key: "endo_post_tc_basic",
  label: "Post-TC básica (sin infección)",
  description:
    "Analgesia post-operatoria tras tratamiento de conductos sin signos de infección activa.",
  specialty: "endodontics",
  items: [
    {
      drugName: "Ibuprofeno",
      presentation: "Tableta 600 mg",
      dosage: "1 tableta cada 8 horas",
      duration: "3 días",
      route: "Vía oral",
      notes:
        "Tomar con alimentos. Suspender si aparece molestia gástrica o reacción alérgica.",
    },
  ],
  indications:
    "Dieta blanda 24 horas y evitar masticar del lado tratado por 7 días. Si el dolor es intenso o aumenta después de 72 horas, comunicarse a la clínica. Acudir a la cita de restauración definitiva en las próximas 3 semanas.",
};

/**
 * Endodoncia — post-TC con absceso periapical.
 * Necrosis pulpar con absceso apical agudo o crónico. Combina
 * antibiótico de primera línea con analgésico/antiinflamatorio.
 */
export const ENDO_POST_TC_ABSCESO_TEMPLATE: PrescriptionTemplate = {
  key: "endo_post_tc_absceso",
  label: "Post-TC con absceso periapical",
  description:
    "Antibiótico + analgesia tras tratamiento de conductos con absceso apical.",
  specialty: "endodontics",
  items: [
    {
      drugName: "Amoxicilina con ácido clavulánico",
      presentation: "Tableta 500/125 mg",
      dosage: "1 tableta cada 8 horas",
      duration: "7 días",
      route: "Vía oral",
      notes:
        "Tomar al inicio de los alimentos para reducir molestias gastrointestinales. Verificar alergia a penicilinas.",
    },
    {
      drugName: "Ibuprofeno",
      presentation: "Tableta 600 mg",
      dosage: "1 tableta cada 8 horas",
      duration: "3 días",
      route: "Vía oral",
      notes: "Tomar con alimentos.",
    },
  ],
  indications:
    "Tomar el antibiótico cada 8 horas SIN saltar dosis hasta completar el esquema. Si aparece edema progresivo, fiebre > 38 °C, trismus o dificultad para tragar, acudir a urgencias inmediatamente. Reforzar higiene oral; evitar enjuagues vigorosos durante las primeras 24 horas. Cita de seguimiento endodóntico en 5-7 días.",
};

/**
 * Endodoncia — post-cirugía apical.
 * Cobertura para apicectomía y retroobturación. Combina antibiótico +
 * analgésico/antiinflamatorio + clorhexidina para higiene local.
 */
export const ENDO_POST_CIRUGIA_APICAL_TEMPLATE: PrescriptionTemplate = {
  key: "endo_post_cirugia_apical",
  label: "Post-cirugía apical",
  description:
    "Antibiótico + analgesia + antiséptico tras apicectomía y retroobturación.",
  specialty: "endodontics",
  items: [
    {
      drugName: "Amoxicilina con ácido clavulánico",
      presentation: "Tableta 500/125 mg",
      dosage: "1 tableta cada 8 horas",
      duration: "7 días",
      route: "Vía oral",
      notes: "Verificar alergia a penicilinas. Tomar con alimentos.",
    },
    {
      drugName: "Ibuprofeno",
      presentation: "Tableta 600 mg",
      dosage: "1 tableta cada 8 horas",
      duration: "5 días",
      route: "Vía oral",
      notes:
        "Tomar con alimentos. Alternar con paracetamol 500 mg si el dolor es intenso.",
    },
    {
      drugName: "Clorhexidina al 0.12%",
      presentation: "Enjuague bucal 250 ml",
      dosage: "15 ml en buches por 30 segundos cada 12 horas",
      duration: "10 días",
      route: "Tópica oral",
      notes:
        "Iniciar a las 24 horas de la cirugía. Tinción dental reversible al suspender el uso.",
    },
  ],
  indications:
    "Aplicar hielo intermitente sobre la mejilla las primeras 4 horas (10 min sí / 10 min no). No enjuagar ni escupir vigorosamente las primeras 24 horas. Dieta blanda y fría durante 48 horas. Evitar tabaco y alcohol por 7 días. Retiro de puntos en 7-10 días. Control radiográfico a los 3 y 6 meses.",
};

export const PRESCRIPTION_TEMPLATES: ReadonlyArray<PrescriptionTemplate> = [
  IMPLANT_POST_SURGERY_TEMPLATE,
  IMPLANT_POST_SECOND_STAGE_TEMPLATE,
  IMPLANT_PERI_IMPLANTITIS_TEMPLATE,
  ENDO_POST_TC_BASIC_TEMPLATE,
  ENDO_POST_TC_ABSCESO_TEMPLATE,
  ENDO_POST_CIRUGIA_APICAL_TEMPLATE,
];

export function getPrescriptionTemplate(
  key: PrescriptionTemplateKey,
): PrescriptionTemplate {
  const t = PRESCRIPTION_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Plantilla de receta desconocida: ${key}`);
  return t;
}

export function listPrescriptionTemplatesBySpecialty(
  specialty: PrescriptionSpecialty,
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
