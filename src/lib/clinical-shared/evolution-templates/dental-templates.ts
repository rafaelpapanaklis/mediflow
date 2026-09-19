// Clinical-shared — las 8 plantillas de nota de odontología general.
//
// Archivo PURO (sin Prisma): lo importan el seed (`seed-dental.ts`), la ficha
// dental del cliente y las pruebas.
//
// Los huecos van entre [corchetes] para que se vea qué falta rellenar. Una
// plantilla NO trae datos clínicos: ni piezas, ni dosis, ni hallazgos. Todo lo
// que depende del paciente es un hueco; lo demás es la redacción que se repite
// en cada nota de ese tipo.
//
// El mapeo a la ficha dental (DentalForm):
//   S → Motivo de consulta / HEA        O → Exploración clínica
//   A → Observaciones / Diagnóstico     P → Plan (lo realizado hoy + lo que sigue)

import type { ClinicalModule, SoapTemplateBody } from "./types";

/**
 * El módulo de estas plantillas. Pasa por `string` a propósito: en el servidor
 * de trabajo `node_modules` es UN enlace que comparten todos los worktrees, y
 * el `prisma generate` de cualquier otra rama (sin `dental` en su schema)
 * regenera el cliente a mitad de tu build — medido el 19-sep-2026, tres builds
 * seguidos tumbados así con «"dental" is not assignable to ClinicalModule».
 * Con el literal desnudo, el build depende de quién generó el último.
 */
export const DENTAL_MODULE = ("dental" as string) as ClinicalModule;

export interface DentalSeedTemplate {
  name: string;
  isDefault: boolean;
  soap: SoapTemplateBody;
  procedures: string[];
  materials: string[];
}

export const DENTAL_DEFAULT_TEMPLATES: readonly DentalSeedTemplate[] = [
  {
    name: "Revisión / control",
    isDefault: true,
    soap: {
      S: "Acude a revisión de control. Última visita: [fecha]. Refiere [sin molestias / molestia en …]. Cambios en su salud o medicación desde la última visita: [ninguno / cuáles].",
      O: "Tejidos blandos: [sin alteraciones / hallazgo]. Encías: [sanas / inflamación en …]. Higiene: [buena / regular / deficiente], placa en [zonas]. Restauraciones previas: [en buen estado / filtración o fractura en pieza …]. Caries: [sin lesiones nuevas / lesión en pieza … cara …]. Oclusión: [sin cambios / …].",
      A: "[Paciente sin hallazgos nuevos / Diagnóstico: … en pieza …]. Riesgo de caries: [bajo / moderado / alto].",
      P: "Hoy: [revisión / radiografías tomadas: …]. Tratamiento pendiente: [ninguno / …, en orden de prioridad]. Indicaciones: refuerzo de técnica de cepillado y [hilo dental / cepillo interdental]. Próxima cita: [motivo] en [plazo].",
    },
    procedures: ["revision_control"],
    materials: [],
  },
  {
    name: "Primera vez",
    isDefault: false,
    soap: {
      S: "Paciente de primera vez. Motivo de consulta: [en palabras del paciente]. Inicio y evolución: [desde cuándo, cómo ha cambiado]. Antecedentes médicos: [enfermedades, o «negados»]. Medicación actual: [fármacos, o «ninguna»]. Alergias: [cuáles, o «negadas»]. Última visita al dentista: [fecha aproximada]. Experiencias previas con anestesia dental: [sin problemas / …].",
      O: "Extraoral: [simetría facial, ganglios, ATM]. Tejidos blandos: [sin alteraciones / hallazgo]. Encías: [estado]. Higiene: [buena / regular / deficiente]. Piezas ausentes: [cuáles]. Caries: [piezas y caras]. Restauraciones presentes: [piezas y estado]. Oclusión: [clase, mordida]. Radiografías: [tomadas y hallazgos / no se tomaron].",
      A: "Diagnóstico: [lista de diagnósticos por pieza o zona]. Riesgo de caries: [bajo / moderado / alto]. Estado periodontal: [sano / gingivitis / sospecha de periodontitis].",
      P: "Se explica al paciente el diagnóstico y las opciones. Plan de tratamiento propuesto, por prioridad: 1) [urgente] 2) [siguiente] 3) [siguiente]. Presupuesto: [entregado / pendiente]. Consentimiento informado: [firmado / pendiente]. Próxima cita: [procedimiento] en [plazo].",
    },
    procedures: ["consulta_primera_vez"],
    materials: [],
  },
  {
    name: "Profilaxis",
    isDefault: false,
    soap: {
      S: "Acude a limpieza dental. Última profilaxis: [fecha aproximada]. Refiere [sin molestias / sangrado al cepillado / sensibilidad en …]. Frecuencia de cepillado: [veces al día]. Uso de hilo dental: [sí / no / ocasional].",
      O: "Placa: [leve / moderada / abundante] en [zonas]. Cálculo: [supragingival / subgingival] en [zonas]. Encías: [sanas / eritema y edema en …]. Sangrado al sondaje: [sí, en … / no]. Pigmentaciones: [sí, en … / no].",
      A: "[Gingivitis asociada a placa / Salud gingival con depósitos de cálculo]. [Se sospecha periodontitis en … — valorar sondaje completo].",
      P: "Hoy: detartraje con [ultrasonido / curetas], pulido con [pasta profiláctica], [aplicación de flúor: sí, tipo … / no]. Se enseña técnica de cepillado [técnica] y uso de [hilo / cepillo interdental]. Indicaciones: no ingerir alimentos ni líquidos por [tiempo] si se aplicó flúor. Próxima profilaxis en [plazo].",
    },
    procedures: ["profilaxis"],
    materials: ["pasta_profilactica", "fluor_topico"],
  },
  {
    name: "Restauración con resina",
    isDefault: false,
    soap: {
      S: "Acude a restauración de pieza [pieza]. Refiere [asintomático / sensibilidad a frío o dulce / retención de alimento]. Dolor espontáneo: [no / sí, características].",
      O: "Pieza [pieza]: caries en cara(s) [caras], profundidad [esmalte / dentina superficial / dentina profunda]. Pruebas de vitalidad: [frío: respuesta normal / aumentada / sin respuesta]. Percusión: [negativa / positiva]. Radiografía: [hallazgos / no se tomó].",
      A: "Caries [clase y extensión] en pieza [pieza], cara(s) [caras]. Pulpa: [vital sin datos de pulpitis irreversible / …].",
      P: "Hoy: anestesia [anestésico y técnica, número de cartuchos / sin anestesia]. Aislamiento [absoluto / relativo]. Remoción de caries, [protección pulpar: material / sin protección]. Grabado, adhesivo [sistema] y resina [marca y color] en cara(s) [caras]. Ajuste de oclusión y pulido. Indicaciones: evitar morder hasta que pase la anestesia; puede haber sensibilidad unos días; avisar si hay dolor espontáneo o que aumenta. Próxima cita: [procedimiento] en [plazo].",
    },
    procedures: ["restauracion_resina"],
    materials: ["anestesico_local", "acido_grabador", "adhesivo", "resina_compuesta"],
  },
  {
    name: "Endodoncia",
    isDefault: false,
    soap: {
      S: "Acude a tratamiento de conductos de pieza [pieza], sesión [número] de [total previsto]. Dolor: [espontáneo / provocado por frío, calor o masticación / ausente], intensidad [0–10], desde [cuándo]. Analgésicos o antibióticos tomados: [cuáles, o «ninguno»].",
      O: "Pieza [pieza]: [caries profunda / restauración extensa / fractura / cambio de color]. Frío: [sin respuesta / respuesta prolongada / normal]. Percusión: [positiva / negativa]. Palpación apical: [dolorosa / sin dolor]. Movilidad: [grado]. Fístula o aumento de volumen: [sí, en … / no]. Radiografía: [ensanchamiento del ligamento / lesión periapical / sin cambios], conductos [número y forma].",
      A: "Diagnóstico pulpar: [pulpitis irreversible / necrosis pulpar / pieza previamente tratada]. Diagnóstico periapical: [tejidos sanos / periodontitis apical sintomática o asintomática / absceso apical]. Pieza [restaurable / no restaurable].",
      P: "Hoy: anestesia [anestésico y técnica, número de cartuchos]. Aislamiento absoluto. Acceso y localización de [número] conducto(s): [nombres]. Longitud de trabajo: [conducto: mm, referencia]. Instrumentación con [sistema] hasta [lima apical]. Irrigación con [solución y concentración]. Cierre de la sesión: [medicación intraconducto: cuál / obturación: técnica y cemento]. Restauración provisional con [material]. Radiografía final: [hallazgos]. Indicaciones: [analgésico indicado, dosis y duración]; no masticar con esa pieza hasta la restauración definitiva. Próxima cita: [siguiente sesión / restauración definitiva: tipo] en [plazo].",
    },
    procedures: ["endodoncia"],
    materials: ["anestesico_local", "dique_de_hule", "limas_endodonticas", "hipoclorito_de_sodio", "gutapercha", "cemento_sellador"],
  },
  {
    name: "Extracción simple",
    isDefault: false,
    soap: {
      S: "Acude a extracción de pieza [pieza]. Motivo: [caries no restaurable / fractura / movilidad / indicación ortodóntica / …]. Dolor: [sí, características / no]. Antecedentes relevantes para cirugía: anticoagulantes [sí, cuál / no], bifosfonatos [sí / no], diabetes o hipertensión [controlada / no controlada / negadas]. Alergias: [cuáles, o «negadas»].",
      O: "Pieza [pieza]: [destrucción coronal / resto radicular / movilidad grado …]. Tejidos vecinos: [sin alteraciones / inflamación / fístula]. Radiografía: raíces [número y forma], relación con [seno maxilar / conducto dentario: sin riesgo / cercana]. Signos vitales previos: TA [valor], FC [valor].",
      A: "Pieza [pieza] no conservable por [causa]. Extracción simple indicada. Riesgo quirúrgico: [bajo / a considerar por …].",
      P: "Consentimiento informado firmado. Hoy: anestesia [anestésico y técnica, número de cartuchos]. Sindesmotomía, luxación y extracción con [elevador / fórceps]. Pieza extraída [completa / con fractura de …]. Curetaje e irrigación del alvéolo: [sí / no]. Hemostasia con [gasa / sutura: material y puntos / hemostático]. Indicaciones por escrito: morder gasa [tiempo], no enjuagarse ni escupir 24 h, dieta blanda y fría, no fumar, hielo local. Medicación: [analgésico, dosis y duración]; [antibiótico, dosis y duración / sin antibiótico]. Control [y retiro de puntos] en [plazo]. Rehabilitación del espacio: [opción comentada con el paciente].",
    },
    procedures: ["extraccion_simple"],
    materials: ["anestesico_local", "gasa_esteril", "sutura"],
  },
  {
    name: "Corona",
    isDefault: false,
    soap: {
      S: "Acude a [preparación / prueba / cementado] de corona en pieza [pieza]. Refiere [asintomático / sensibilidad / molestia con el provisional].",
      O: "Pieza [pieza]: [vital / con endodoncia], remanente dentario [suficiente / requiere poste o reconstrucción]. Encía marginal: [sana / inflamada]. Provisional: [en su sitio / desalojado / fracturado]. Radiografía: [hallazgos / no se tomó]. [En prueba o cementado: ajuste marginal, puntos de contacto, oclusión y color: …].",
      A: "Pieza [pieza] con indicación de corona por [restauración extensa / endodoncia / fractura / estética]. Etapa de hoy: [preparación / prueba / cementado definitivo].",
      P: "Hoy: anestesia [anestésico y técnica, número de cartuchos / sin anestesia]. Si fue preparación: línea de terminación [tipo], retracción gingival con [material], [impresión con material … / escaneo digital], color [color], provisional de [material] cementado con [cemento temporal]. Si fue cementado: corona de [material] cementada con [cemento], retiro de excedentes y ajuste de oclusión. Laboratorio: [nombre], fecha de entrega [fecha]. Indicaciones: evitar alimentos duros o pegajosos con el provisional; acudir si se desaloja. Próxima cita: [prueba / cementado / control] en [plazo].",
    },
    procedures: ["corona"],
    materials: ["anestesico_local", "material_de_impresion", "provisional", "cemento"],
  },
  {
    name: "Urgencia por dolor",
    isDefault: false,
    soap: {
      S: "Acude de urgencia por dolor en [zona o pieza señalada]. Inicio: [cuándo]. Tipo: [espontáneo / provocado por frío, calor, dulce o masticación], [pulsátil / sordo / punzante], intensidad [0–10]. Lo despierta por la noche: [sí / no]. Irradiación: [a dónde / no]. Inflamación o fiebre: [sí / no]. Medicación tomada: [fármaco, dosis y hora de la última toma / ninguna]. Alergias: [cuáles, o «negadas»].",
      O: "Extraoral: [sin aumento de volumen / aumento de volumen en …], apertura bucal [normal / limitada]. Pieza(s) sospechosa(s): [piezas]. Hallazgos: [caries profunda / fractura / restauración filtrada / bolsa periodontal / pericoronitis]. Frío: [respuesta]. Percusión: [vertical / horizontal: respuesta]. Palpación: [respuesta]. Movilidad: [grado]. Fístula: [sí / no]. Radiografía: [hallazgos]. Temperatura: [valor].",
      A: "Origen del dolor: pieza [pieza]. Diagnóstico: [pulpitis irreversible / necrosis con periodontitis apical / absceso / fractura / pericoronitis / origen no dental a descartar].",
      P: "Tratamiento de urgencia hoy: anestesia [anestésico y técnica, número de cartuchos]; [apertura cameral y medicación / drenaje / ajuste oclusal / restauración provisional / irrigación]. Medicación: [analgésico, dosis y duración]; [antibiótico, dosis y duración / sin antibiótico, por qué]. Signos de alarma explicados: aumento de volumen, fiebre, dificultad para tragar o abrir la boca → acudir de inmediato. Tratamiento definitivo pendiente: [cuál]. Próxima cita en [plazo].",
    },
    procedures: ["urgencia_dolor"],
    materials: ["anestesico_local"],
  },
];

/** ¿Queda algún hueco [entre corchetes] sin rellenar en el texto? */
export function hasUnfilledPlaceholders(text: string): boolean {
  return /\[[^\[\]\n]+\]/.test(text);
}
