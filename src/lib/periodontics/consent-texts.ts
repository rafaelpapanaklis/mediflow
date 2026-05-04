// Periodontics — textos textuales de los consentimientos informados.
// SPEC §10.3 (SRP) + §10.4 (cirugía periodontal). Llaves `{}` se sustituyen
// por el caller al renderizar el PDF.

import type { PeriodontalSurgeryType } from "@prisma/client";

/**
 * Texto del consentimiento informado de raspado y alisado radicular (SRP).
 * Llaves a sustituir: {patientName}, {patientAddress}, {doctorName},
 * {doctorLicense}, {scope}, {classification}.
 */
export const SRP_CONSENT_TEXT = `
CONSENTIMIENTO INFORMADO PARA RASPADO Y ALISADO RADICULAR (SRP)

Yo, {patientName}, con domicilio en {patientAddress}, en pleno uso de mis facultades, autorizo
al Dr./Dra. {doctorName} (cédula profesional {doctorLicense}) a realizarme el procedimiento
de raspado y alisado radicular en {scope}.

He sido informado(a) sobre:

1. EN QUÉ CONSISTE
   El raspado y alisado radicular es un procedimiento mediante el cual se elimina la placa
   bacteriana, el sarro y las toxinas adheridas a la superficie de las raíces de los dientes,
   por debajo de la línea de la encía. Se realiza con instrumentos manuales (curetas) y/o
   instrumentos ultrasónicos.

2. POR QUÉ SE ME REALIZA
   Tengo periodontitis (clasificación 2017: {classification}). Sin tratamiento, esta enfermedad
   puede llevar a la pérdida de los dientes. El raspado es la primera línea de tratamiento
   y reduce la inflamación, el sangrado y la profundidad de las bolsas periodontales.

3. RIESGOS Y MOLESTIAS
   - Sensibilidad dental al frío y al calor durante 1-4 semanas posteriores.
   - Recesión gingival adicional al desinflamarse las encías, lo que puede exponer raíces.
   - Aumento transitorio de la movilidad dental en casos avanzados.
   - Necesidad de cirugía periodontal en sitios donde el raspado no resuelva las bolsas profundas.
   - Sangrado y molestia leve durante 24-48 horas.

4. ALTERNATIVAS
   - No realizar tratamiento (riesgo de progresión y pérdida dental).
   - Higiene casera reforzada solamente (insuficiente para periodontitis confirmada).

5. CUIDADOS POSTERIORES
   - Tomar los medicamentos prescritos en los horarios indicados.
   - Usar el colutorio de clorhexidina por 14 días.
   - Acudir a la cita de reevaluación a las 6-8 semanas.
   - Mantener mantenimiento periodontal cada 3-6 meses según riesgo.

He tenido la oportunidad de hacer todas las preguntas que consideré necesarias y han sido
respondidas a mi satisfacción. Doy mi consentimiento libre y voluntariamente.

Firma del paciente: _____________________      Fecha: _____________________

Firma del doctor:   _____________________      Cédula: {doctorLicense}
`.trim();

/** Etiqueta humana del tipo de cirugía. */
export function labelSurgeryType(t: PeriodontalSurgeryType): string {
  const map: Record<PeriodontalSurgeryType, string> = {
    COLGAJO_ACCESO: "colgajo de acceso",
    GINGIVECTOMIA: "gingivectomía",
    RESECTIVA_OSEA: "cirugía resectiva ósea",
    RTG: "regeneración tisular guiada (RTG)",
    INJERTO_GINGIVAL_LIBRE: "injerto gingival libre",
    INJERTO_TEJIDO_CONECTIVO: "injerto de tejido conectivo subepitelial",
    TUNELIZACION: "técnica de tunelización",
    CORONALLY_ADVANCED_FLAP: "colgajo de avance coronal",
    OTRO: "cirugía periodontal específica",
  };
  return map[t];
}

/** Descripción corta del procedimiento, para sección 1 del consentimiento. */
export function getSurgeryDescription(t: PeriodontalSurgeryType): string {
  const map: Record<PeriodontalSurgeryType, string> = {
    COLGAJO_ACCESO:
      "Se realiza una incisión en la encía y se eleva un colgajo para acceder a la superficie radicular y al hueso bajo visión directa. Se elimina el tejido inflamado y se hace una limpieza profunda. Luego se reposiciona y sutura el colgajo.",
    GINGIVECTOMIA:
      "Se elimina tejido gingival sobrecrecido o agrandado para reducir la profundidad de las bolsas periodontales. La encía cicatriza por segunda intención.",
    RESECTIVA_OSEA:
      "Se eleva un colgajo y se remodela el hueso periodontal para crear contornos fisiológicos que faciliten la higiene y reduzcan las bolsas. Implica eliminar pequeñas porciones de hueso.",
    RTG:
      "Se eleva un colgajo y, sobre el defecto óseo, se coloca un sustituto óseo (injerto) y/o una membrana que aísla el defecto y permite que el ligamento periodontal y el hueso se regeneren sin invasión del epitelio.",
    INJERTO_GINGIVAL_LIBRE:
      "Se toma un injerto de tejido del paladar y se sutura sobre la zona con encía insuficiente, para aumentar el grosor y la cantidad de encía queratinizada.",
    INJERTO_TEJIDO_CONECTIVO:
      "Se toma tejido conectivo del paladar (preservando epitelio) y se coloca bajo el colgajo del sitio receptor para aumentar el grosor gingival y/o cubrir recesiones.",
    TUNELIZACION:
      "Se realizan incisiones mínimas y se crea un túnel subgingival sin separar las papilas, por donde se introduce el injerto. Es una técnica mínimamente invasiva.",
    CORONALLY_ADVANCED_FLAP:
      "Se eleva un colgajo y se desliza coronalmente para cubrir la superficie radicular expuesta por la recesión, con o sin injerto de tejido conectivo.",
    OTRO:
      "Procedimiento específico que será descrito verbalmente y consignado en la historia clínica.",
  };
  return map[t];
}

const SURGERY_SPECIFIC_RISKS: Record<PeriodontalSurgeryType, string[]> = {
  COLGAJO_ACCESO: [
    "Recesión gingival post-quirúrgica (esperable, parte de la cicatrización).",
    "Sensibilidad radicular prolongada.",
    "Reabsorción ósea periférica.",
  ],
  GINGIVECTOMIA: [
    "Cicatrización por segunda intención (más lenta).",
    "Pérdida de papila interdental.",
  ],
  RESECTIVA_OSEA: [
    "Recesión gingival significativa.",
    "Sensibilidad radicular.",
    "Pérdida de altura ósea adicional intencional para crear contornos fisiológicos.",
  ],
  RTG: [
    "Posible exposición de la membrana antes de la cicatrización completa.",
    "Fracaso del injerto óseo en 5-15% de los casos.",
    "Necesidad de retirar la membrana en una segunda cirugía si es no reabsorbible.",
    "Reacción a biomateriales (rara).",
  ],
  INJERTO_GINGIVAL_LIBRE: [
    "Necrosis del injerto en 3-8% de los casos.",
    "Cicatriz visible en zona donante (paladar).",
    "Aspecto estético del injerto puede diferir del tejido circundante.",
  ],
  INJERTO_TEJIDO_CONECTIVO: [
    "Necrosis del injerto en 3-10% de los casos.",
    "Molestia en zona donante (paladar) por 1-2 semanas.",
  ],
  TUNELIZACION: [
    "Perforación involuntaria del colgajo.",
    "Necrosis parcial del colgajo en 2-5% de los casos.",
  ],
  CORONALLY_ADVANCED_FLAP: [
    "Recidiva de la recesión en 15-25% de los casos a 5 años.",
    "Tensión del colgajo puede causar molestia inicial.",
  ],
  OTRO: [
    "Riesgos específicos del procedimiento serán explicados verbalmente y consignados en nota clínica.",
  ],
};

/**
 * Texto del consentimiento informado de cirugía periodontal.
 * Llaves a sustituir: {patientName}, {doctorName}, {doctorLicense},
 * {treatedSites}.
 */
export function SURGERY_CONSENT_TEXT(surgeryType: PeriodontalSurgeryType): string {
  return `
CONSENTIMIENTO INFORMADO PARA CIRUGÍA PERIODONTAL

Yo, {patientName}, autorizo al Dr./Dra. {doctorName} (cédula {doctorLicense}) a realizarme
una cirugía periodontal del tipo: ${labelSurgeryType(surgeryType)}.

Se intervendrán los siguientes dientes/sitios: {treatedSites}.

He sido informado(a) sobre:

1. EN QUÉ CONSISTE
   ${getSurgeryDescription(surgeryType)}

2. RIESGOS ESPECÍFICOS DE ESTE PROCEDIMIENTO
${SURGERY_SPECIFIC_RISKS[surgeryType].map((r) => `   - ${r}`).join("\n")}

3. RIESGOS GENERALES DE TODA CIRUGÍA ORAL
   - Inflamación, hematoma y dolor moderado durante 3-7 días.
   - Sangrado postoperatorio leve.
   - Infección post-quirúrgica (poco frecuente con antibiótico profiláctico).
   - Reacción a la anestesia local (rara).
   - Dehiscencia de sutura.

4. ALTERNATIVAS
   - No realizar cirugía (riesgo de progresión periodontal y pérdida dental en sitios afectados).
   - Continuar solo con tratamiento no quirúrgico (insuficiente cuando hay sitios residuales ≥5mm con BoP+).

5. CUIDADOS POSTERIORES (ESTRICTOS)
   - Antibiótico completo aunque me sienta bien.
   - NO escupir, fumar ni usar pajillas durante 7 días.
   - Compresas frías 24h.
   - Dieta blanda y fría 3 días.
   - Reposo relativo 48h.
   - Cita de retiro de suturas a los 7-14 días.
   - Control postoperatorio a los 6 y 12 meses.

He tenido la oportunidad de hacer todas las preguntas y han sido respondidas. Doy mi
consentimiento libre y voluntariamente.

Firma del paciente: _____________________      Fecha: _____________________

Firma del doctor:   _____________________      Cédula: {doctorLicense}
`.trim();
}
