// Periodontics — pre-fill de SOAP para visitas periodontales. SPEC §10.

import type { PerioMetrics } from "./periodontogram-math";

export type SoapPrefillInput = {
  patientName: string;
  visitType: "INITIAL" | "POST_SRP" | "REEVALUATION" | "MAINTENANCE";
  classification?: { stage: string; grade?: string | null; extension?: string | null } | null;
  metrics?: PerioMetrics | null;
  riskCategory?: "BAJO" | "MODERADO" | "ALTO" | null;
  recallMonths?: 3 | 4 | 6 | null;
};

export type SoapPrefillOutput = {
  S: string;
  O: string;
  A: string;
  P: string;
};

/**
 * Genera secciones SOAP estandarizadas para anotar en el expediente
 * después de una visita periodontal. El doctor edita libremente; el
 * pre-fill solo acelera la captura.
 */
export function buildPerioSoapPrefill(input: SoapPrefillInput): SoapPrefillOutput {
  const m = input.metrics;
  const c = input.classification;

  const S = subjectiveByVisit(input.visitType);
  const O = m
    ? `Examen periodontal: BoP ${m.bopPct}%, índice de placa ${m.plaquePct}%. ` +
      `Distribución de bolsas: ${m.sites1to3} sitios sanos (1-3 mm), ${m.sites4to5} moderados (4-5 mm), ` +
      `${m.sites6plus} profundos (≥6 mm). PD promedio ${m.avgPd} mm. ` +
      `${m.teethWithPockets5plus} dientes presentan al menos un sitio con bolsa ≥5 mm.`
    : "Examen periodontal pendiente de registrar.";

  const A = c
    ? `Clasificación 2017 AAP/EFP: ${c.stage}${c.grade ? `, ${c.grade}` : ""}${
        c.extension ? `, extensión ${c.extension}` : ""
      }.${input.riskCategory ? ` Riesgo de progresión Berna: ${input.riskCategory}.` : ""}`
    : "Sin clasificación registrada.";

  const P = planByVisit(input.visitType, input.recallMonths);

  return { S, O, A, P };
}

function subjectiveByVisit(v: SoapPrefillInput["visitType"]): string {
  switch (v) {
    case "INITIAL":
      return "Paciente acude para evaluación periodontal. Refiere [completar — sangrado al cepillado, mal aliento, movilidad dental, otros].";
    case "POST_SRP":
      return "Paciente acude a control post-raspado. Refiere [completar — molestias, sensibilidad, mejora subjetiva].";
    case "REEVALUATION":
      return "Paciente acude a reevaluación post-tratamiento. Refiere [completar — mejoría, persistencia de signos].";
    case "MAINTENANCE":
      return "Paciente acude a mantenimiento periodontal programado. Refiere [completar — molestias, sangrado, etc.].";
    default:
      return "Paciente acude a visita de periodoncia.";
  }
}

function planByVisit(
  v: SoapPrefillInput["visitType"],
  recallMonths: 3 | 4 | 6 | null | undefined,
): string {
  switch (v) {
    case "INITIAL":
      return "1) Discutir hallazgos con el paciente. 2) Iniciar Fase 1 (instrucción de higiene + control de placa). 3) Indicar SRP por cuadrantes. 4) Reevaluación en 6-8 semanas.";
    case "POST_SRP":
      return "Continuar plan: completar cuadrantes restantes; mantener clorhexidina 14 días; cita de reevaluación en 6 semanas.";
    case "REEVALUATION":
      return "Identificar sitios residuales (PD ≥5 mm + BoP). Considerar derivación a cirugía periodontal en sitios persistentes; programar mantenimiento.";
    case "MAINTENANCE":
      return `Limpieza profesional + raspado supragingival + raspado subgingival en sitios indicados. Próximo recall en ${recallMonths ?? 4} meses.`;
    default:
      return "Plan a definir según hallazgos.";
  }
}
