// Endodontics — texto legal del consentimiento informado endodóntico. Spec §12.3, §12.4

import { categorizeTooth } from "@/lib/helpers/canalAnatomy";

export type EndoConsentInputs = {
  toothFdi: number;
  treatmentType: string;
  patientFullName: string;
  guardianFullName?: string | null;
  doctorFullName: string;
  doctorMedicalLicense: string;
  clinicName: string;
  clinicCity: string;
};

const TREATMENT_LABEL: Record<string, string> = {
  TC_PRIMARIO: "Tratamiento de conductos primario",
  RETRATAMIENTO: "Retratamiento endodóntico",
  APICECTOMIA: "Cirugía apical (apicectomía)",
  PULPOTOMIA_EMERGENCIA: "Pulpotomía de emergencia",
  TERAPIA_REGENERATIVA: "Terapia regenerativa",
};

/**
 * Texto del consentimiento informado para TC / retratamiento (no
 * quirúrgico). Spec §12.3. Contenido obligatorio NOM-024 + LFPDPPP.
 */
export function getEndoConsentText(input: EndoConsentInputs): string {
  const treatmentLabel = TREATMENT_LABEL[input.treatmentType] ?? input.treatmentType;
  const category = categorizeTooth(input.toothFdi);
  const isAnterior = category === "incisor" || category === "canine";
  const isMolar = category.includes("molar");
  const isRetreatment = input.treatmentType === "RETRATAMIENTO";

  const guardianClause = input.guardianFullName
    ? `, representado(a) por mi tutor(a) ${input.guardianFullName}`
    : "";

  const sections: string[] = [
    "CONSENTIMIENTO INFORMADO PARA TRATAMIENTO DE ENDODONCIA",
    "",
    `Yo, ${input.patientFullName}, mayor de edad${guardianClause},`,
    "en pleno uso de mis facultades mentales, declaro:",
    "",
    "1. PROCEDIMIENTO. Autorizo al Dr(a). " +
      `${input.doctorFullName}, con cédula profesional ${input.doctorMedicalLicense},`,
    `   a realizar el siguiente procedimiento en el diente ${input.toothFdi}:`,
    `   ${treatmentLabel}.`,
    "",
    "   Este procedimiento consiste en eliminar el tejido pulpar (nervio) y los",
    "   microorganismos del interior del diente, limpiar y dar forma a los conductos",
    "   radiculares, irrigar con sustancias antimicrobianas y rellenarlos con un",
    "   material biocompatible.",
    "",
    "2. ALTERNATIVAS. He sido informado(a) de las siguientes alternativas:",
    "   a) Extracción del diente.",
    "   b) No realizar tratamiento alguno.",
    "   Comprendo que ambas alternativas tienen consecuencias propias.",
    "",
    "3. RIESGOS Y POSIBLES COMPLICACIONES. Comprendo y acepto los siguientes riesgos:",
    "   - Fractura de instrumental dentro del conducto.",
    "   - Perforación radicular o coronal.",
    "   - Sobreobturación o subobturación del conducto.",
    "   - Persistencia o reaparición de los síntomas.",
    "   - Necesidad de retratamiento o de cirugía apical complementaria.",
    "   - Posible extracción del diente si el tratamiento fracasa.",
  ];

  if (isRetreatment) {
    sections.push("   - Probabilidad de éxito menor que en un tratamiento primario.");
  }
  if (isAnterior) {
    sections.push("   - Posible cambio de color de la corona del diente con el tiempo.");
  }
  if (isMolar) {
    sections.push(
      "   - Riesgo de fractura coronal si el diente no recibe restauración definitiva (corona) en menos de 30 días.",
    );
  }

  sections.push(
    "",
    "4. RESTAURACIÓN POS-TRATAMIENTO. Reconozco que el éxito del tratamiento depende",
    "   de la colocación de una restauración definitiva (corona, onlay o restauración",
    "   directa) dentro de los 30 días siguientes. Si no acudo a esa restauración, el",
    "   tratamiento puede fracasar y el diente perderse, sin responsabilidad del",
    "   profesional tratante.",
    "",
    "5. RADIOGRAFÍAS. Autorizo la toma y conservación de las radiografías necesarias",
    "   para el diagnóstico, tratamiento y seguimiento. Las radiografías formarán",
    "   parte de mi expediente clínico conforme a NOM-024-SSA3-2012 por un mínimo de",
    "   5 años.",
    "",
    `6. AVISO DE PRIVACIDAD. Manifiesto haber leído el Aviso de Privacidad de ${input.clinicName}`,
    "   y conozco mis derechos ARCO bajo la LFPDPPP.",
    "",
    `Lugar y fecha: ${input.clinicCity}, ${formatDate(new Date())}`,
    "",
    "Firma del paciente / tutor:                 Firma del profesional:",
    "[FIRMA_PACIENTE]                            [FIRMA_DOCTOR]",
  );

  return sections.join("\n");
}

/**
 * Texto del consentimiento de cirugía apical (apicectomía). Spec §12.4.
 * Documento más extenso por mayor riesgo (parestesia, hemorragia, etc.).
 */
export function getApicalSurgeryConsentText(input: EndoConsentInputs): string {
  const isLowerMolar = input.toothFdi >= 36 && input.toothFdi <= 38 ||
                       input.toothFdi >= 46 && input.toothFdi <= 48;

  const sections: string[] = [
    "CONSENTIMIENTO INFORMADO PARA CIRUGÍA APICAL (APICECTOMÍA)",
    "",
    `Yo, ${input.patientFullName}, mayor de edad${input.guardianFullName ? `, representado(a) por mi tutor(a) ${input.guardianFullName}` : ""},`,
    "en pleno uso de mis facultades mentales, declaro:",
    "",
    "1. NATURALEZA DEL PROCEDIMIENTO. Autorizo al Dr(a). " +
      `${input.doctorFullName}, con cédula profesional ${input.doctorMedicalLicense},`,
    `   a realizar una CIRUGÍA APICAL en el diente ${input.toothFdi}.`,
    "",
    "   Este procedimiento es de naturaleza quirúrgica y consiste en acceder al ápice",
    "   de la raíz del diente a través de una incisión en la encía, eliminar el tejido",
    "   inflamatorio o infectado periapical, resecar el extremo de la raíz y sellarlo",
    "   con un material biocompatible.",
    "",
    "2. ANESTESIA. Recibiré anestesia local con vasoconstrictor. Conozco los riesgos",
    "   propios de la anestesia local, incluyendo reacción alérgica o vasovagal.",
    "",
    "3. RIESGOS Y POSIBLES COMPLICACIONES. Comprendo y acepto los siguientes riesgos:",
    "   - Hemorragia intra y postoperatoria.",
    "   - Infección postoperatoria.",
    "   - Dehiscencia de sutura y retraso en la cicatrización.",
    "   - Hematoma y edema facial transitorio.",
    "   - Posible fracaso quirúrgico y necesidad de extracción posterior del diente.",
  ];

  if (isLowerMolar) {
    sections.push(
      "   - PARESTESIA del nervio dentario inferior y/o nervio mentoniano por la",
      "     proximidad anatómica al diente intervenido. La parestesia puede ser",
      "     transitoria o, en casos infrecuentes, permanente.",
    );
  }

  sections.push(
    "",
    "4. INDICACIONES POS-QUIRÚRGICAS. Me comprometo a:",
    "   - Mantener compresión en la zona durante 30 minutos posteriores al alta.",
    "   - Aplicar frío local intermitente las primeras 6 horas.",
    "   - Dieta blanda y fría las primeras 24 horas.",
    "   - No escupir, no enjuagar vigorosamente y no fumar las primeras 24 horas.",
    "   - Tomar la medicación prescrita en tiempo y forma.",
    "   - Acudir al control postoperatorio en la fecha indicada.",
    "",
    "5. RADIOGRAFÍAS. Autorizo la toma de radiografías intraoperatorias y de control",
    "   conforme a NOM-024-SSA3-2012, las cuales se conservarán por un mínimo de 5 años.",
    "",
    `6. AVISO DE PRIVACIDAD. Manifiesto haber leído el Aviso de Privacidad de ${input.clinicName}`,
    "   y conozco mis derechos ARCO bajo la LFPDPPP.",
    "",
    `Lugar y fecha: ${input.clinicCity}, ${formatDate(new Date())}`,
    "",
    "Firma del paciente / tutor:                 Firma del profesional:",
    "[FIRMA_PACIENTE]                            [FIRMA_DOCTOR]",
  );

  return sections.join("\n");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}
