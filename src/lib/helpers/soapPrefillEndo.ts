// Endodontics — pre-fill del SOAP cuando se abre nota de cita endodóntica. Spec §10.2

import type {
  EndodonticDiagnosisRow,
  EndodonticTreatmentFull,
  EndodonticFollowUpRow,
  VitalityTestRow,
  SoapPrefill,
} from "@/lib/types/endodontics";
import { labelCanalCanonicalName } from "./canalAnatomy";

const PULPAL_LABEL: Record<string, string> = {
  PULPA_NORMAL: "pulpa normal",
  PULPITIS_REVERSIBLE: "pulpitis reversible",
  PULPITIS_IRREVERSIBLE_SINTOMATICA: "pulpitis irreversible sintomática",
  PULPITIS_IRREVERSIBLE_ASINTOMATICA: "pulpitis irreversible asintomática",
  NECROSIS_PULPAR: "necrosis pulpar",
  PREVIAMENTE_TRATADO: "previamente tratado",
  PREVIAMENTE_INICIADO: "previamente iniciado",
};

const PERIAPICAL_LABEL: Record<string, string> = {
  TEJIDOS_PERIAPICALES_NORMALES: "tejidos periapicales normales",
  PERIODONTITIS_APICAL_SINTOMATICA: "periodontitis apical sintomática",
  PERIODONTITIS_APICAL_ASINTOMATICA: "periodontitis apical asintomática",
  ABSCESO_APICAL_AGUDO: "absceso apical agudo",
  ABSCESO_APICAL_CRONICO: "absceso apical crónico",
  OSTEITIS_CONDENSANTE: "osteitis condensante",
};

const TEST_LABEL: Record<string, string> = {
  FRIO: "Frío",
  CALOR: "Calor",
  EPT: "EPT",
  PERCUSION_VERTICAL: "Percusión vertical",
  PERCUSION_HORIZONTAL: "Percusión horizontal",
  PALPACION_APICAL: "Palpación apical",
  MORDIDA_TOOTHSLOOTH: "Mordida (Tooth Slooth)",
};

const RESULT_LABEL: Record<string, string> = {
  POSITIVO: "respuesta positiva",
  NEGATIVO: "respuesta negativa",
  EXAGERADO: "respuesta exagerada y persistente",
  DIFERIDO: "respuesta diferida",
  SIN_RESPUESTA: "sin respuesta",
};

export interface PrefillInput {
  toothFdi: number;
  diagnosis: EndodonticDiagnosisRow | null;
  recentVitality: VitalityTestRow[];
  activeTreatment: EndodonticTreatmentFull | null;
  lastFollowUp: EndodonticFollowUpRow | null;
}

/**
 * Genera el bloque inicial S/O/A/P para una cita endodóntica.
 * El doctor puede borrar/editar libremente; este helper solo asiste.
 */
export function prefillSoapForEndo(input: PrefillInput): SoapPrefill {
  return {
    subjective: composeSubjective(input),
    objective: composeObjective(input),
    assessment: composeAssessment(input),
    plan: composePlan(input),
  };
}

function composeSubjective(input: PrefillInput): string {
  const { toothFdi, activeTreatment, diagnosis } = input;
  const lines: string[] = [`[Endodoncia · diente ${toothFdi}]`];
  if (activeTreatment?.outcomeStatus === "EN_CURSO") {
    lines.push(
      `Continúa tratamiento ${labelTreatmentType(activeTreatment.treatmentType)} iniciado el ${formatDate(activeTreatment.startedAt)}.`,
    );
  } else if (diagnosis) {
    lines.push(
      `Refiere síntomas compatibles con ${PULPAL_LABEL[diagnosis.pulpalDiagnosis] ?? diagnosis.pulpalDiagnosis}.`,
    );
  } else {
    lines.push("Refiere motivo de consulta endodóntica (completar al evaluar).");
  }
  return lines.join("\n");
}

function composeObjective(input: PrefillInput): string {
  const { recentVitality, lastFollowUp } = input;
  const lines: string[] = [];
  if (recentVitality.length > 0) {
    lines.push("Pruebas de vitalidad recientes:");
    for (const v of recentVitality.slice(0, 4)) {
      const intensity = v.intensity != null ? ` (intensidad ${v.intensity}/10)` : "";
      lines.push(
        `- ${TEST_LABEL[v.testType] ?? v.testType} en ${v.toothFdi}: ${RESULT_LABEL[v.result] ?? v.result}${intensity}.`,
      );
    }
  }
  if (lastFollowUp?.paiScore) {
    lines.push(
      `Último control: PAI ${lastFollowUp.paiScore}/5${lastFollowUp.symptomsPresent ? " con síntomas" : " sin síntomas"}.`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "[Completar al examinar]";
}

function composeAssessment(input: PrefillInput): string {
  const { diagnosis } = input;
  if (!diagnosis) return "[Diagnóstico AAE pulpar y periapical pendiente]";
  return `${capitalize(PULPAL_LABEL[diagnosis.pulpalDiagnosis] ?? diagnosis.pulpalDiagnosis)} + ${PERIAPICAL_LABEL[diagnosis.periapicalDiagnosis] ?? diagnosis.periapicalDiagnosis}.`;
}

function composePlan(input: PrefillInput): string {
  const { toothFdi, activeTreatment } = input;
  if (!activeTreatment) {
    return `Plan: definir abordaje endodóntico para diente ${toothFdi} según evolución de síntomas.`;
  }
  const lines: string[] = [];
  const stepLabel = ["acceso e instrumentación", "instrumentación canalicular", "irrigación y medicación", "obturación y restauración"][activeTreatment.currentStep - 1];
  lines.push(
    `${labelTreatmentType(activeTreatment.treatmentType)} en ${toothFdi}, ${activeTreatment.isMultiSession ? "multi-sesión" : "una sesión"}.`,
  );
  if (activeTreatment.outcomeStatus === "EN_CURSO" && stepLabel) {
    lines.push(`Sesión actual: paso ${activeTreatment.currentStep} (${stepLabel}).`);
  }
  if (activeTreatment.requiresPost && activeTreatment.restorationUrgencyDays) {
    lines.push(
      `Restauración definitiva pos-TC en ${activeTreatment.restorationUrgencyDays} días (${labelRestorationPlan(activeTreatment.postOpRestorationPlan)}).`,
    );
  }
  return lines.join("\n");
}

function labelTreatmentType(t: string): string {
  const map: Record<string, string> = {
    TC_PRIMARIO: "TC primario",
    RETRATAMIENTO: "Retratamiento",
    APICECTOMIA: "Apicectomía",
    PULPOTOMIA_EMERGENCIA: "Pulpotomía de emergencia",
    TERAPIA_REGENERATIVA: "Terapia regenerativa",
  };
  return map[t] ?? t;
}

function labelRestorationPlan(p: string | null | undefined): string {
  if (!p) return "tipo a definir";
  const map: Record<string, string> = {
    CORONA_PORCELANA_METAL: "corona porcelana-metal",
    CORONA_ZIRCONIA: "corona de zirconia",
    CORONA_DISILICATO_LITIO: "corona disilicato de litio",
    ONLAY: "onlay",
    RESTAURACION_DIRECTA_RESINA: "resina directa",
    POSTE_FIBRA_CORONA: "poste fibra + corona",
    POSTE_METALICO_CORONA: "poste metálico + corona",
  };
  return map[p] ?? p;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// Re-export para uso externo (DiagnosisDrawer, SOAP editor).
export { labelCanalCanonicalName };
