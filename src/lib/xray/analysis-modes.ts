// X-ray analysis — definiciones por modo. A2 cross-módulos.
//
// Cada modo expone:
//   - systemPrompt: el rol que actúa Claude para ese modo.
//   - tool: definición JSONSchema que Claude debe usar (tool_use).
//   - measurementsKey: identificador del bloque de mediciones que el
//     route handler persiste en xrayAnalyses.measurements.

import type { XrayAnalysisMode } from "@prisma/client";

const COMMON_INSTRUCTION = `
Responde SIEMPRE en español clínico. Las severidades aceptan: "critical" | "high" | "medium" | "low" | "informational". Las confianzas son decimales 0.0–1.0 (sé confiado cuando el hallazgo es visualmente claro). NO eres diagnóstico final — el doctor revisa.`.trim();

// ─── GENERAL (modo histórico, free-form) ─────────────────────────────
const GENERAL_PROMPT = `Actúas como un asistente de análisis radiográfico dental general. Tu rol es identificar hallazgos visibles en la imagen y reportarlos con confianza calibrada a lo que realmente se ve. ${COMMON_INSTRUCTION}

INSTRUCCIONES:
- Analiza la imagen dental proporcionada
- Identifica hallazgos clínicamente relevantes: caries, lesiones periapicales, pérdida ósea, restauraciones existentes, fracturas, dientes impactados, cálculo, reabsorción radicular, etc.
- Para cada hallazgo indica: diente/zona afectada (notación FDI), descripción, severidad, nivel de confianza
- Máximo 6 hallazgos, priorizando los más relevantes`;

const GENERAL_TOOL = {
  name: "report_radiograph_analysis",
  description: "Reporta el análisis estructurado de una radiografía dental.",
  input_schema: {
    type: "object",
    required: ["summary", "severity", "confidence", "findings", "recommendations"],
    properties: {
      summary: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title", "description", "severity", "confidence"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            tooth: { type: ["string", "null"] },
            severity: { type: "string", enum: ["low", "medium", "high", "critical", "informational"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            confidenceRationale: { type: ["string", "null"] },
          },
        },
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

// ─── PERIODONTAL_BONE_LOSS ────────────────────────────────────────────
const PERIO_PROMPT = `Actúas como periodoncista revisando una radiografía para evaluar pérdida ósea periodontal. ${COMMON_INSTRUCTION}

ENFOQUE:
- Identifica pérdida ósea horizontal (paralela a línea cervical) vs vertical/angular (oblicua, indica defecto infraóseo).
- Para cada sitio afectado mide la pérdida en mm desde la unión cemento-esmalte (CEJ) hasta la cresta ósea.
- Pérdida ≤ 2 mm: leve. 2–4 mm: moderada. > 4 mm: severa.
- Reporta defectos de furca (Grado I/II/III) si son visibles en molares.
- Marca presencia de cálculo subgingival visible (sombras radiopacas adheridas a la raíz).

CADA SITIO debe incluir: toothFdi (FDI numérico), position ("mesial" | "distal"), lossMm, type ("horizontal" | "vertical"), furcationInvolvement (null o "I" | "II" | "III"), notes opcional.`;

const PERIO_TOOL = {
  name: "report_periodontal_bone_loss",
  description: "Reporta mediciones de pérdida ósea periodontal por sitio.",
  input_schema: {
    type: "object",
    required: ["summary", "severity", "confidence", "sites", "findings", "recommendations"],
    properties: {
      summary: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      sites: {
        type: "array",
        description: "Mediciones por sitio (CEJ → cresta ósea).",
        items: {
          type: "object",
          required: ["toothFdi", "position", "lossMm", "type"],
          properties: {
            toothFdi: { type: "number", minimum: 11, maximum: 48 },
            position: { type: "string", enum: ["mesial", "distal"] },
            lossMm: { type: "number", minimum: 0, maximum: 20 },
            type: { type: "string", enum: ["horizontal", "vertical"] },
            furcationInvolvement: {
              type: ["string", "null"],
              enum: ["I", "II", "III", null],
            },
            calculusVisible: { type: ["boolean", "null"] },
            notes: { type: ["string", "null"] },
          },
        },
      },
      findings: {
        type: "array",
        description: "Hallazgos relevantes adicionales (no medidos por sitio).",
        items: {
          type: "object",
          required: ["id", "title", "description", "severity", "confidence"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            tooth: { type: ["string", "null"] },
            severity: { type: "string", enum: ["low", "medium", "high", "critical", "informational"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

// ─── PERIIMPLANT_BONE_LOSS ────────────────────────────────────────────
const PERIIMPLANT_PROMPT = `Actúas como implantólogo revisando una radiografía periapical o panorámica para evaluar pérdida ósea periimplantar. ${COMMON_INSTRUCTION}

ENFOQUE:
- Identifica el implante en la imagen (cilindro/cónico radiopaco).
- Mide la distancia entre el hombro/plataforma del implante y el primer contacto óseo radiográfico, MESIAL y DISTAL, en mm.
- Pérdida ≤ 1.5 mm el primer año o ≤ 0.2 mm/año posterior: dentro de lo esperado.
- Pérdida > 2 mm con BoP/supuración: periimplantitis (severo).
- Si hay radiografía baseline para comparar, indícalo.

REPORTA: implantFdi (FDI del sitio), mesialMm, distalMm, asymmetryDelta (|mesial - distal|), severity, notas.`;

const PERIIMPLANT_TOOL = {
  name: "report_periimplant_bone_loss",
  description: "Reporta mediciones de pérdida ósea periimplantar.",
  input_schema: {
    type: "object",
    required: ["summary", "severity", "confidence", "measurement", "findings", "recommendations"],
    properties: {
      summary: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      measurement: {
        type: "object",
        required: ["implantFdi", "mesialMm", "distalMm"],
        properties: {
          implantFdi: { type: "number", minimum: 11, maximum: 48 },
          mesialMm: { type: "number", minimum: 0, maximum: 15 },
          distalMm: { type: "number", minimum: 0, maximum: 15 },
          asymmetryDelta: { type: ["number", "null"] },
          baselineDate: { type: ["string", "null"], description: "ISO date si hay baseline." },
          comparisonNote: { type: ["string", "null"] },
        },
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title", "description", "severity", "confidence"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            tooth: { type: ["string", "null"] },
            severity: { type: "string", enum: ["low", "medium", "high", "critical", "informational"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      recommendations: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

// ─── Selector ─────────────────────────────────────────────────────────

export interface ModeConfig {
  systemPrompt: string;
  tool: typeof GENERAL_TOOL | typeof PERIO_TOOL | typeof PERIIMPLANT_TOOL;
  /** Clave en el `input` del tool donde viven las mediciones (null si free-form). */
  measurementsKey: "sites" | "measurement" | null;
}

const MODES: Record<XrayAnalysisMode, ModeConfig> = {
  GENERAL: {
    systemPrompt: GENERAL_PROMPT,
    tool: GENERAL_TOOL,
    measurementsKey: null,
  },
  PERIODONTAL_BONE_LOSS: {
    systemPrompt: PERIO_PROMPT,
    tool: PERIO_TOOL,
    measurementsKey: "sites",
  },
  PERIIMPLANT_BONE_LOSS: {
    systemPrompt: PERIIMPLANT_PROMPT,
    tool: PERIIMPLANT_TOOL,
    measurementsKey: "measurement",
  },
};

export function getModeConfig(mode: XrayAnalysisMode): ModeConfig {
  return MODES[mode];
}

export function isValidMode(value: string): value is XrayAnalysisMode {
  return value === "GENERAL" ||
    value === "PERIODONTAL_BONE_LOSS" ||
    value === "PERIIMPLANT_BONE_LOSS";
}

export const MODE_LABELS: Record<XrayAnalysisMode, string> = {
  GENERAL: "Análisis general",
  PERIODONTAL_BONE_LOSS: "Pérdida ósea periodontal",
  PERIIMPLANT_BONE_LOSS: "Pérdida ósea periimplantar",
};
