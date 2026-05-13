/**
 * Sugerencia contextual para el empty state del Resumen del paciente.
 *
 * El texto se deriva de campos del paciente y de los módulos activos en la
 * clínica — no es hardcoded por paciente. Permite que el doctor vea una
 * próxima acción razonable incluso cuando el expediente está vacío.
 */

export type DentitionStage = "temporal" | "mixta" | "permanente";

export interface SuggestionInput {
  ageYears: number | null;
  isChild: boolean;
  /** Etapa de dentición conocida (cuando hay pediatricsData). Si no se
   *  pasa, se infiere a partir de la edad. */
  dentition?: DentitionStage;
  hasPerioModule: boolean;
  hasOrthoModule: boolean;
  hasEndoModule: boolean;
  hasImplantsModule: boolean;
  /** Especialidad de la clínica (clinic.specialty) — fallback cuando
   *  ningún módulo dental aplica. */
  clinicSpecialty: string;
}

export interface EmptySuggestion {
  /** Línea breve que contextualiza al paciente. */
  headline: string;
  /** Acción sugerida. */
  hint: string;
}

function inferDentitionFromAge(ageYears: number | null): DentitionStage | undefined {
  if (ageYears == null) return undefined;
  if (ageYears < 6)  return "temporal";
  if (ageYears < 12) return "mixta";
  return "permanente";
}

export function buildEmptySuggestion(input: SuggestionInput): EmptySuggestion {
  const { ageYears, isChild, hasPerioModule, hasOrthoModule, clinicSpecialty } = input;
  const stage = input.dentition ?? inferDentitionFromAge(ageYears);
  const ageLabel = ageYears != null ? `${ageYears} años` : "edad sin registrar";

  if (isChild || (ageYears !== null && ageYears < 18)) {
    if (stage === "mixta") {
      return {
        headline: `Paciente pediátrico de ${ageLabel}, dentición mixta.`,
        hint: "Sugerencia: agendar revisión de ortodoncia interceptiva y aplicación tópica de flúor.",
      };
    }
    if (stage === "temporal") {
      return {
        headline: `Paciente pediátrico de ${ageLabel}, dentición temporal.`,
        hint: "Sugerencia: evaluación CAMBRA + selladores en molares temporales.",
      };
    }
    return {
      headline: `Paciente pediátrico de ${ageLabel}, dentición permanente.`,
      hint: "Sugerencia: revisión de erupción de terceros molares y evaluación de ortodoncia.",
    };
  }

  if (hasPerioModule && ageYears !== null && ageYears >= 35) {
    return {
      headline: `Paciente adulto de ${ageLabel}. Clínica con periodoncia activa.`,
      hint: "Sugerencia: registrar periodontograma basal de 6 sitios por diente.",
    };
  }

  if (hasOrthoModule && (ageYears === null || ageYears < 40)) {
    return {
      headline: "Paciente sin historial. Clínica con ortodoncia activa.",
      hint: "Sugerencia: registros iniciales (8 fotos AAO + radiografías panorámica y lateral).",
    };
  }

  if (clinicSpecialty.toLowerCase().includes("dental")) {
    return {
      headline: "Paciente nuevo sin historial clínico.",
      hint: "Sugerencia: consulta de valoración inicial + odontograma + radiografía panorámica.",
    };
  }

  return {
    headline: "Paciente nuevo sin historial clínico.",
    hint: "Sugerencia: registrar antecedentes y motivo de consulta en una primera nota SOAP.",
  };
}
