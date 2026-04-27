/**
 * Catálogo de plantillas SOAP. Cada template provee texto pre-escrito para
 * los 4 campos S/O/A/P. Los campos vacíos en el template no sobreescriben
 * lo que el doctor ya tenga.
 *
 * Atajos de teclado: SHORTCUT_KEY (1-9) → ⇧<n> aplica el template.
 *
 * El consumidor (clinical-client) decide si pide confirmación antes de
 * sobreescribir contenido existente.
 */

export interface SoapTemplate {
  /** Identificador estable para selección/atajos. */
  code: string;
  /** Nombre humano mostrado en UI. */
  name: string;
  /** Descripción corta para subtitle/tooltip. */
  desc: string;
  /** Atajo numérico ⇧<n> donde n es 1..9. Si null, sin atajo. */
  shortcut: number | null;
  /** Especialidad sugerida. "all" se muestra siempre. */
  specialty: "all" | "dental" | "medicine" | "psychology" | "nutrition" | "ortodoncia";
  /** Texto pre-escrito por sección. Vacío significa "no tocar". */
  s: string;
  o: string;
  a: string;
  p: string;
}

export const SOAP_TEMPLATES: SoapTemplate[] = [
  {
    code: "STANDARD",
    name: "SOAP estándar",
    desc: "Subjetivo · Objetivo · Análisis · Plan",
    shortcut: 1,
    specialty: "all",
    s: "Motivo de consulta:\nPadecimiento actual:\nAntecedentes relevantes:\nMedicación habitual:\nAlergias:",
    o: "Signos vitales:\n  TA: __ / __ mmHg · FC: __ lpm · FR: __ rpm · Temp: __ °C\nExploración física:\n  Cabeza y cuello: \n  Cardiopulmonar: \n  Abdomen: \n  Extremidades: ",
    a: "Diagnóstico principal:\nDiagnósticos diferenciales:\n  1. \n  2. ",
    p: "Tratamiento farmacológico:\nIndicaciones generales:\nEstudios solicitados:\nSeguimiento: control en __ días.",
  },
  {
    code: "FIRST_VISIT",
    name: "Primera consulta",
    desc: "Historia clínica completa",
    shortcut: 2,
    specialty: "medicine",
    s: "Antecedentes heredofamiliares:\n  Padre: \n  Madre: \n  Hermanos/a: \nAntecedentes personales no patológicos:\n  Alimentación: \n  Higiene: \n  Tabaquismo / alcoholismo: \n  Actividad física: \nAntecedentes personales patológicos:\n  Cirugías previas: \n  Enfermedades crónicas: \n  Hospitalizaciones: \n  Transfusiones: \nAntecedentes ginecoobstétricos (si aplica):\nMotivo de consulta:\nPadecimiento actual:",
    o: "Somatometría:\n  Peso: __ kg · Talla: __ m · IMC: __ \nSignos vitales:\n  TA: __ / __ · FC: __ · FR: __ · Temp: __\nExploración física por sistemas:\n  Cabeza y cuello: \n  Cardiopulmonar: \n  Abdomen: \n  Genitourinario: \n  Neurológico: \n  Piel y faneras: ",
    a: "Diagnóstico principal:\nComorbilidades:",
    p: "Plan de manejo inicial:\nEstudios complementarios:\nReferencias:\nFecha de seguimiento:",
  },
  {
    code: "URGENCY_DENTAL",
    name: "Urgencia dental",
    desc: "Dolor agudo / trauma / infección",
    shortcut: 3,
    specialty: "dental",
    s: "Dolor de inicio: __ horas/días.\nLocalización (diente / cuadrante): \nIntensidad EVA: __ / 10.\nCarácter del dolor (pulsátil / continuo / punzante / referido):\nFactores que lo agravan / alivian:\nMedicación tomada antes de la consulta:",
    o: "Inspección extraoral: \nInspección intraoral: \nExploración del diente afectado:\n  Percusión vertical: __ · Percusión horizontal: __ \n  Pruebas de vitalidad: __ \n  Movilidad: grado __ \n  Sondaje periodontal: __ mm \nRadiografía periapical: ",
    a: "Diagnóstico clínico de urgencia:\n  (p. ej. pulpitis irreversible, absceso periapical agudo, fractura coronaria…)",
    p: "Manejo de urgencia:\n  - Anestesia local con lidocaína 2% c/epi.\n  - Apertura cameral / drenaje / ferulización (según diagnóstico).\nMedicación:\n  - Ibuprofeno 400 mg c/8 h por 3 días.\n  - Paracetamol 500 mg c/6 h si dolor adicional.\n  - Amoxicilina 500 mg c/8 h por 7 días si signos de infección.\nIndicaciones:\n  - Dieta blanda 24-48 h, evitar el lado afectado.\n  - Aplicar hielo local 20 min cada 2 h.\nCita de continuación: en __ días para tratamiento definitivo.",
  },
  {
    code: "DENTAL_CLEANING",
    name: "Limpieza dental",
    desc: "Profilaxis + recomendaciones",
    shortcut: 4,
    specialty: "dental",
    s: "Paciente acude para limpieza dental de rutina.\nCepillado: __ veces al día. Hilo dental: __\nÚltima limpieza: hace __ meses.",
    o: "Higiene oral: aceptable / regular / deficiente.\nÍndice de placa: __ %\nCálculo supragingival: localizado / generalizado.\nCálculo subgingival: ausente / presente.\nGingiva: rosada / eritematosa / sangrado al sondaje.\nLesiones cariosas activas: ",
    a: "Profilaxis dental.\nGingivitis leve / moderada (si aplica).",
    p: "Profilaxis con ultrasonido y pulido con copa.\nAplicación tópica de flúor.\nReforzar técnica de cepillado modificado de Bass + uso de hilo dental.\nControl en 6 meses.",
  },
  {
    code: "ENDODONTICS",
    name: "Endodoncia",
    desc: "Tratamiento de conductos",
    shortcut: 5,
    specialty: "dental",
    s: "Dolor pulpar referido en diente __.\nDuración: __ días. EVA inicial: __ / 10.",
    o: "Pulpa con respuesta exagerada y persistente al frío.\nPercusión vertical positiva.\nRadiografía periapical: lesión apical de __ mm.\nDiente con caries profunda / restauración filtrada / fractura.",
    a: "Pulpitis irreversible · diente __.\n(o periodontitis apical aguda según hallazgos)",
    p: "Tratamiento de conductos en 1-2 sesiones bajo aislamiento absoluto.\n  - Apertura cameral, instrumentación rotatoria, irrigación con NaOCl 2.5% + EDTA 17%.\n  - Obturación con gutapercha + cemento bioceramico.\nAnalgesia post-operatoria: ibuprofeno 400 mg c/8 h por 3 días.\nRestauración definitiva (incrustación / corona) en cita posterior.\nControl radiográfico a los 6 y 12 meses.",
  },
  {
    code: "POST_EXTRACTION",
    name: "Post-extracción",
    desc: "Indicaciones tras exodoncia",
    shortcut: 6,
    specialty: "dental",
    s: "Paciente acude para extracción de pieza dental __.",
    o: "Procedimiento realizado bajo anestesia local con lidocaína 2% + epinefrina.\nExtracción simple / quirúrgica con osteotomía mínima.\nHemostasia adecuada con compresión + sutura __ puntos seda 3-0.",
    a: "Post-extracción dental simple / compleja.",
    p: "Mordida sostenida sobre gasa estéril por 30 min.\nIbuprofeno 400 mg c/8 h por 3 días.\nAmoxicilina 500 mg c/8 h por 5 días si extracción compleja.\nAplicar hielo local 20 min cada 2 h las primeras 24 h.\nDieta blanda 24-48 h. Evitar enjuagues vigorosos en las primeras 24 h.\nNo fumar ni beber con popote por 72 h.\nCita de revisión y retiro de sutura en 7 días.",
  },
  {
    code: "ORTHO_CONTROL",
    name: "Control de ortodoncia",
    desc: "Ajuste mensual de aparatología",
    shortcut: 7,
    specialty: "ortodoncia",
    s: "Sin molestias relevantes desde último ajuste.\nHigiene oral: __\nDolor / aflojamiento de bracket: ",
    o: "Aparatología fija superior / inferior íntegra.\nArco actual: __ (Ni-Ti / acero / TMA · calibre __).\nAvance: __\nMordida: clase __ molar y canina.",
    a: "Control de ortodoncia · sin novedad / con incidencia menor.",
    p: "Cambio de arco a __\nUso de elásticos clase __ por __ horas al día.\nReforzar higiene con cepillo interproximal e irrigador.\nPróximo control en 4 semanas.",
  },
  {
    code: "PSYCH_FOLLOWUP",
    name: "Psicología · seguimiento",
    desc: "Sesión de continuación",
    shortcut: 8,
    specialty: "psychology",
    s: "Estado anímico actual:\nEventos relevantes desde última sesión:\nAdherencia a técnicas / tareas:",
    o: "Apariencia, contacto visual, lenguaje, afecto observado:\nEscalas aplicadas:\n  PHQ-9: __ / 27 — __ \n  GAD-7: __ / 21 — __ \n  Otra: ",
    a: "Diagnóstico de trabajo:\nPlanteamiento clínico actual:",
    p: "Intervención principal de hoy:\nTarea / técnica para la semana:\nIndicación medicamentosa (si aplica):\nPróxima sesión: en __ días.",
  },
  {
    code: "NUTRITION",
    name: "Nutrición · plan",
    desc: "Plan dietético + somatometría",
    shortcut: 9,
    specialty: "nutrition",
    s: "Hábitos alimenticios actuales:\nNúmero de comidas/día:\nIngesta de agua: __ litros.\nActividad física: __ \nAdherencia a plan previo:",
    o: "Somatometría:\n  Peso: __ kg · Talla: __ m · IMC: __ \n  % grasa: __ · % músculo: __ \n  Cintura: __ cm · Cadera: __ cm · ICC: __ \nGasto energético basal estimado: __ kcal.",
    a: "Estado nutricional:\nObjetivo terapéutico:",
    p: "Plan calórico: __ kcal / día.\nDistribución macros:\n  Proteína: __ g/kg · Carbohidratos: __ % · Grasa: __ %\nRecomendaciones:\n  - \n  - \nSeguimiento en __ semanas.",
  },
];

/** Devuelve el template por su shortcut (⇧1..⇧9) o null. */
export function findTemplateByShortcut(n: number): SoapTemplate | null {
  return SOAP_TEMPLATES.find((t) => t.shortcut === n) ?? null;
}
