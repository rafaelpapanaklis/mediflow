/**
 * Contenido de las 17 páginas de especialidad.
 * Cada entrada describe una vertical de clínica que MediFlow soporta.
 * Las entradas se llenan incrementalmente — el comentario __INSERT__ marca
 * dónde van las nuevas categorías para mantener edits estables.
 */

export type SpecialtyGroup = "salud" | "estetica" | "belleza";

export type Feature = {
  title: string;
  description: string;
  iconName: string;       // nombre de un componente de lucide-react
};

export type UseCase = {
  title: string;
  description: string;
};

export type Faq = {
  question: string;
  answer: string;
};

export type Testimonial = {
  author: string;
  role: string;
  clinic: string;
  text: string;
};

export type SpecialtyColor =
  | "blue" | "teal" | "emerald" | "violet" | "amber" | "lime" | "rose"
  | "pink" | "purple" | "cyan" | "orange" | "indigo" | "green" | "fuchsia";

export type SpecialtyContent = {
  slug: string;
  category: SpecialtyGroup;
  color: SpecialtyColor;
  nombre: string;

  // SEO
  seoTitle: string;
  seoDescription: string;

  // Hero
  heroTitle: string;
  heroSubtitle: string;
  heroVariant: SpecialtyGroup;
  iconMainName: string;
  iconSecondaryNames: string[];   // 8 íconos de lucide-react

  // Cuerpo
  designedFor: string[];          // 2-3 párrafos
  features: Feature[];            // 8
  clinicalFormTitle: string;
  clinicalFormDescription: string;
  useCases: UseCase[];            // 3
  integrations: string[];         // 5
  faqs: Faq[];                    // 4
  testimonial: Testimonial;
  relatedSlugs: string[];         // 4

  // Imágenes Unsplash (null = el template usa fallback gradiente)
  unsplashAmbient: string | null;
  unsplashCases: string | null;
};

/* -------------------------------------------------------------------------- */
/*  Lista de slugs en orden — usada por sitemap, getSpecialty y               */
/*  generateStaticParams. Mantén este orden para la nav, footer y sitemap.    */
/* -------------------------------------------------------------------------- */

export const SPECIALTY_SLUGS = [
  "dental",
  "medicina-general",
  "nutricion",
  "psicologia",
  "dermatologia",
  "fisioterapia",
  "podologia",
  "medicina-estetica",
  "clinicas-capilares",
  "centros-estetica",
  "cejas-pestanas",
  "masajes",
  "depilacion-laser",
  "peluquerias",
  "medicina-alternativa",
  "unas",
  "spas",
] as const;

export type SpecialtySlug = (typeof SPECIALTY_SLUGS)[number];

/* Slugs que reciben un bloque MedicalBusiness adicional en JSON-LD */
export const HEALTH_SPECIALTY_SLUGS: readonly string[] = [
  "dental",
  "medicina-general",
  "nutricion",
  "psicologia",
  "dermatologia",
  "fisioterapia",
  "podologia",
  "medicina-estetica",
  "clinicas-capilares",
];

export function isHealthSpecialty(slug: string): boolean {
  return HEALTH_SPECIALTY_SLUGS.includes(slug);
}

/* -------------------------------------------------------------------------- */
/*  Contenido completo por categoría                                          */
/* -------------------------------------------------------------------------- */

export const SPECIALTIES: Record<string, SpecialtyContent> = {
  dental: {
    slug: "dental",
    category: "salud",
    color: "blue",
    nombre: "Dental",
    seoTitle: "Software dental — Odontograma digital y CFDI",
    seoDescription: "Software para clínicas dentales en México: odontograma por superficie, periodontograma, planes por pieza, radiografías y CFDI 4.0. Prueba 14 días gratis.",
    heroTitle: "Software para clínicas dentales que tus pacientes recordarán",
    heroSubtitle: "Odontograma por superficie, periodontograma, planes de tratamiento por pieza y CFDI 4.0 — todo en un solo lugar, diseñado por dentistas para dentistas.",
    heroVariant: "salud",
    iconMainName: "Smile",
    iconSecondaryNames: ["Stethoscope", "FileText", "Calendar", "Camera", "Receipt", "ClipboardList", "AlertCircle", "Users"],
    designedFor: [
      "MediFlow no es un CRM genérico al que le pegaron campos dentales encima. Cada cita, expediente y presupuesto está construido alrededor del flujo real de un consultorio dental: el paciente entra, abres el odontograma, marcas hallazgos por superficie, generas plan de tratamiento por pieza y entregas presupuesto antes de que se levante de la silla.",
      "Soportamos notación FDI internacional con dentición adulta y temporal pediátrica, las 5 superficies por diente (Oclusal, Mesial, Distal, Vestibular, Lingual/Palatino) y condiciones de pieza completa: extracción, implante, ausente, corona, endodoncia. Tu odontograma vive en el navegador, no en un PDF olvidado.",
      "Y como sabemos que un dentista mexicano necesita timbrar facturas el mismo día y mandar recordatorios por WhatsApp para que no le cancelen, ambas cosas vienen incluidas — sin integraciones de terceros caras ni configuraciones de fin de semana.",
    ],
    features: [
      { iconName: "Smile",         title: "Odontograma por superficie",     description: "Marca caries, restauraciones, coronas, endodoncias e implantes por las 5 superficies de cada diente con notación FDI. Adulto y dentición temporal pediátrica incluidos." },
      { iconName: "Stethoscope",   title: "Periodontograma digital",        description: "Placa, cálculo, índice gingival, profundidad de sondeo por sextante, sangrado al sondaje, movilidad e instrucciones de higiene en una sola pantalla." },
      { iconName: "ClipboardList", title: "Planes de tratamiento por pieza", description: "Vincula procedimientos a piezas, asigna prioridad y costo desde tu catálogo, y rastrea el avance sesión por sesión sin perder el hilo." },
      { iconName: "Camera",        title: "Radiografías y fotos intraorales", description: "Sube panorámicas, periapicales, bitewings y fotos intraorales directo al expediente. Comparación antes/después por ángulo." },
      { iconName: "Receipt",       title: "Presupuestos con CFDI 4.0",      description: "Genera presupuestos PDF a partir del plan de tratamiento, divide en cuotas mensuales y emite CFDI 4.0 timbrado al cobrar cada parcialidad." },
      { iconName: "Calendar",      title: "Agenda con WhatsApp",            description: "Recordatorios automáticos 24h antes y confirmación por respuesta del paciente. Reduce no-shows hasta 40% en clínicas dentales." },
      { iconName: "FileText",      title: "Notas SOAP integradas",          description: "Subjetivo, Objetivo, Análisis y Plan integrados al odontograma, con evaluación oclusal (clase molar, overbite, overjet) y prescripción de medicamentos." },
      { iconName: "AlertCircle",   title: "Inventario de insumos",          description: "Stock para anestésicos, resinas, brackets y materiales de impresión. Alertas automáticas al llegar al mínimo configurado." },
    ],
    clinicalFormTitle: "Tu expediente dental especializado",
    clinicalFormDescription: "El formulario clínico de MediFlow no es un campo de texto libre. Es una plantilla dental real con odontograma interactivo de 5 superficies por diente, periodontograma con sondeo por sextante, evaluación oclusal (clase molar I/II/III, overbite, overjet), análisis de ATM, notas SOAP y prescripción de medicamentos con dosis y duración.",
    useCases: [
      { title: "Primera consulta",            description: "Datos básicos del paciente, odontograma en 3 minutos, plan de tratamiento, presupuesto a 6 meses y PDF por WhatsApp antes de que se levante de la silla." },
      { title: "Endodoncia en varias sesiones", description: "Plan con 4 sesiones vinculadas a la pieza 26, las 4 citas agendadas en el momento, y factura parcial timbrada cada vez que el paciente paga su cuota." },
      { title: "Ortodoncia con seguimiento",   description: "Fotos intraorales en cada cita de ajuste, comparación mes a mes y mensualidad por CFDI sin salir del expediente del paciente." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿El odontograma soporta dentición pediátrica?",    answer: "Sí. Cambias entre dentición adulta (FDI 11–48) y temporal (FDI 51–85) con un click en el mismo expediente. Útil si atiendes adultos y niños." },
      { question: "¿Puedo emitir CFDI 4.0 desde el plan de tratamiento?", answer: "Sí. MediFlow emite CFDI 4.0 timbrados ante el SAT con tu RFC, soporta pagos en parcialidades (PPD), complemento de pago y descarga del XML/PDF." },
      { question: "¿Funciona con varias sucursales?",                   answer: "Sí, el plan Clínica permite múltiples sucursales con pacientes y agenda separados, y reportes consolidados por dueño." },
      { question: "¿Cuánto tarda configurar mi clínica?",               answer: "Menos de 10 minutos. Te registras, eliges Odontología, cargas doctores y horarios, y ya puedes empezar a agendar." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Dra. María González", role: "Odontóloga", clinic: "Dental Smile CDMX", text: "Pasé de hojas de cálculo y radiografías en USB a tener todo en un solo lugar. El odontograma por superficie es lo más cercano que he visto a cómo realmente trabajamos los dentistas." },
    relatedSlugs: ["medicina-general", "dermatologia", "podologia", "fisioterapia"],
    unsplashAmbient: "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "medicina-general": {
    slug: "medicina-general",
    category: "salud",
    color: "teal",
    nombre: "Medicina General",
    seoTitle: "Software para consultorio médico — Expediente y CIE-10",
    seoDescription: "Software para médicos generales en México: expediente con signos vitales, diagnóstico CIE-10, prescripción digital, referidos y CFDI 4.0. Prueba 14 días gratis.",
    heroTitle: "Software para tu consultorio médico, sin papeleo",
    heroSubtitle: "Signos vitales, diagnóstico CIE-10, prescripción digital, incapacidades y referidos a especialistas — todo en un solo expediente.",
    heroVariant: "salud",
    iconMainName: "Stethoscope",
    iconSecondaryNames: ["Heart", "Activity", "FileText", "Calendar", "Pill", "ClipboardCheck", "Thermometer", "UserCheck"],
    designedFor: [
      "Como médico general, tu día es un maratón: 20 a 30 pacientes con motivos de consulta totalmente distintos. MediFlow está pensado para que captures lo importante en cada cita sin perder ni un minuto: signos vitales completos, antecedentes, exploración física, diagnóstico con CIE-10 y plan terapéutico — todo en una sola pantalla.",
      "Incluye AUDIT-C para tamizaje rápido de alcohol, cálculo de pack-year para tabaquismo, prescripción digital con dosis y duración (cada 4h, 6h, semanal), pase a especialista entre 13 categorías y emisión de incapacidades médicas con conteo de días.",
      "Y porque sabemos que en México la facturación CFDI 4.0 no es opcional, MediFlow timbra al SAT al cobro y manda el XML al paciente por correo o WhatsApp en automático.",
    ],
    features: [
      { iconName: "Heart",          title: "Signos vitales completos",   description: "Tensión arterial, frecuencia cardiaca, temperatura, frecuencia respiratoria, saturación O₂, glucosa capilar, peso y talla en una sola sección con alertas si están fuera de rango." },
      { iconName: "FileText",       title: "Diagnóstico CIE-10",         description: "Búsqueda asistida en 16 categorías (respiratoria, digestiva, cardiaca, endocrina, psiquiátrica, musculoesquelética) con códigos oficiales pre-cargados." },
      { iconName: "Pill",           title: "Prescripción digital",       description: "Recetas con dosis, frecuencia (c/4h, c/6h, semanal) y duración. Múltiples fármacos por receta, historial de prescripciones por paciente y firma digital." },
      { iconName: "Activity",       title: "Diagnóstico diferencial",    description: "Lista de diagnósticos diferenciales con probabilidad (Alta/Media/Baja) para que tu razonamiento clínico quede documentado en cada nota." },
      { iconName: "UserCheck",      title: "Pase a especialista",        description: "Referidos a 13 especialidades (cardiología, neurología, dermatología, ortopedia, etc.) con motivo del envío y carta automática." },
      { iconName: "ClipboardCheck", title: "Tamizaje AUDIT-C",           description: "Cuestionario de 3 ítems para detección rápida de consumo de alcohol con cálculo de score y alerta si es mayor o igual a 8 (alto riesgo)." },
      { iconName: "Calendar",       title: "Incapacidades médicas",      description: "Genera incapacidades con conteo de días, motivo y firma digital. Imprime o manda al paciente por WhatsApp en un click." },
      { iconName: "Thermometer",    title: "Cálculo pack-year",          description: "Calculadora automática de tabaquismo en pack-year para evaluación de riesgo cardiovascular y pulmonar en cada consulta." },
    ],
    clinicalFormTitle: "Tu expediente médico SOAP completo",
    clinicalFormDescription: "Subjetivo, Objetivo, Análisis y Plan integrados con signos vitales, antecedentes heredofamiliares, AUDIT-C, pack-year, exploración física por aparatos, diagnóstico CIE-10 con probabilidad diferencial, prescripción con dosis/frecuencia/duración, referidos a especialista e incapacidad médica con conteo de días.",
    useCases: [
      { title: "Consulta de control HTA",   description: "Tomas signos vitales, comparas tendencia con visitas previas, ajustas dosis del antihipertensivo, generas la receta y agendas seguimiento en 30 días." },
      { title: "Paciente con tos persistente", description: "Llenas SOAP, marcas diferencial (bronquitis 60%, alergia 30%, neumonía 10%), pides radiografía y das incapacidad de 3 días con todo timbrado al instante." },
      { title: "Adulto mayor con polifarmacia", description: "Revisas las 8 medicaciones que toma, detectas interacciones, simplificas el esquema y mandas la receta nueva por WhatsApp al paciente y a su cuidador." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Tiene el catálogo CIE-10 oficial?",            answer: "Sí, MediFlow incluye los códigos CIE-10 oficiales organizados en 16 categorías clínicas con búsqueda por palabra clave o código." },
      { question: "¿Puedo recetar medicamentos controlados?",       answer: "Sí, MediFlow soporta receta de psicotrópicos con folio. Las recetas se imprimen con tu cédula profesional y firma digital." },
      { question: "¿Sirve para teleconsulta?",                      answer: "Sí, integra Daily.co para videollamadas sin instalar nada — link directo al paciente con sala creada en el momento." },
      { question: "¿Funciona si comparto consultorio?",             answer: "Sí, cada médico ve su propia agenda y solo sus pacientes. El admin del consultorio ve todo y configura comisiones por consulta." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Dr. Roberto Hernández", role: "Médico General", clinic: "Consultorio Roma Norte", text: "Pasé de tener un cuaderno por paciente a tener todo el historial buscable. Lo que más uso es el diagnóstico diferencial con probabilidades — me obliga a documentar bien el razonamiento." },
    relatedSlugs: ["dental", "nutricion", "psicologia", "dermatologia"],
    unsplashAmbient: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  nutricion: {
    slug: "nutricion",
    category: "salud",
    color: "emerald",
    nombre: "Nutrición",
    seoTitle: "Software para nutriólogos — IMC, TDEE y plan alimenticio",
    seoDescription: "Software para nutriólogos en México: cálculo automático IMC, TMB, TDEE, plan alimenticio, frecuencia de alimentos y metas SMART. Prueba 14 días gratis.",
    heroTitle: "Software para tu consultorio de nutrición que se siente cuidado",
    heroSubtitle: "Antropometría completa, cálculo automático de IMC, TMB y TDEE, plan alimenticio por comidas y seguimiento de metas SMART en cada visita.",
    heroVariant: "salud",
    iconMainName: "Salad",
    iconSecondaryNames: ["Apple", "Scale", "LineChart", "Calendar", "FileText", "Target", "Utensils", "Droplet"],
    designedFor: [
      "Tu paciente quiere saber su IMC, su gasto calórico real y qué puede comer mañana. MediFlow calcula todo automáticamente: peso, talla, IMC, BMR con Mifflin-St Jeor, TDEE con factor de actividad, índice cintura-cadera y porcentaje de grasa corporal — todo en una sola pantalla.",
      "El plan alimenticio se estructura en las 5 comidas del día (desayuno, colación, comida, merienda, cena) y la frecuencia de alimentos en 12 categorías (frutas, verduras, cárnicos, lácteos, leguminosas, ultraprocesados). Tus pacientes ven su evolución de peso en una gráfica, no en un cuaderno.",
      "Las metas SMART quedan documentadas con fecha objetivo, porcentaje de progreso y estado (en progreso, lograda o abandonada). Cuando vuelve el paciente en 4 semanas, ves de un vistazo qué cumplió y qué no.",
    ],
    features: [
      { iconName: "Scale",     title: "Antropometría completa",    description: "Peso, talla, IMC, porcentaje de grasa corporal, masa muscular, perímetro cintura, perímetro cadera e índice cintura-cadera con clasificación automática." },
      { iconName: "LineChart", title: "Cálculo TMB y TDEE",        description: "Tasa metabólica basal con fórmula Harris-Benedict y gasto energético total con 5 niveles de actividad (sedentario a muy activo, factores 1.2 a 1.9)." },
      { iconName: "Apple",     title: "Frecuencia de alimentos",   description: "Cuestionario de 12 categorías (frutas, verduras, leguminosas, cárnicos, lácteos, cereales integrales, ultraprocesados, bebidas azucaradas, comida rápida) con recomendaciones." },
      { iconName: "Utensils",  title: "Plan alimenticio por comidas", description: "Estructura tu plan en desayuno, colación matutina, comida, merienda y cena con porciones, sustituciones y notas para cada comida." },
      { iconName: "Target",    title: "Metas SMART",               description: "Define metas específicas con fecha objetivo, porcentaje de avance y estado. El paciente ve su progreso en cada visita." },
      { iconName: "Droplet",   title: "Hidratación y descanso",    description: "Registra ingesta de agua, horas de sueño y comidas por día — variables clave para evaluar adherencia al plan." },
      { iconName: "FileText",  title: "Laboratorios y suplementos", description: "Captura resultados de laboratorio, alergias, intolerancias alimentarias y suplementación actual del paciente." },
      { iconName: "Calendar",  title: "Seguimiento por WhatsApp",  description: "Recordatorios automáticos de citas de control y mensajes de seguimiento entre consultas para mejorar adherencia." },
    ],
    clinicalFormTitle: "Tu expediente nutricional con cálculos automáticos",
    clinicalFormDescription: "El formulario calcula automáticamente IMC, BMR (Harris-Benedict), TDEE (Mifflin-St Jeor con factor de actividad de 1.2 a 1.9), peso ideal por fórmula de Lorentz e índice cintura-cadera. Incluye estructura de plan alimenticio en 5 comidas, frecuencia de 12 grupos de alimentos, metas SMART con progreso, y notas SOAP para diagnóstico nutricional.",
    useCases: [
      { title: "Plan de pérdida de peso",       description: "Calculas IMC y TDEE, defines déficit calórico, armas plan de 5 comidas con sustituciones, fijas meta SMART de 4 kg en 8 semanas y agendas control en 4 semanas." },
      { title: "Seguimiento mensual",            description: "Registras peso nuevo, ves la gráfica de evolución, ajustas el plan, actualizas el progreso de las metas y mandas el resumen por WhatsApp." },
      { title: "Paciente con diabetes tipo 2",   description: "Capturas glucosa, HbA1c y triglicéridos, identificas alimentos a evitar, armas plan bajo en carbohidratos refinados y educas con material por WhatsApp." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Calcula automáticamente IMC y TDEE?",          answer: "Sí. Cuando capturas peso, talla, edad, sexo y nivel de actividad, MediFlow calcula IMC, BMR (Harris-Benedict), TDEE (Mifflin-St Jeor) e índice cintura-cadera al instante." },
      { question: "¿Puedo dar consultas en línea?",                 answer: "Sí, MediFlow integra teleconsulta sin instalación adicional. Mandas el link al paciente y entran al consultorio virtual desde su navegador." },
      { question: "¿El paciente ve su progreso?",                   answer: "Sí, hay un portal opcional donde el paciente revisa su gráfica de peso, sus metas activas y su plan alimenticio actual." },
      { question: "¿Puedo emitir facturas CFDI?",                   answer: "Sí, MediFlow timbra CFDI 4.0 ante el SAT con tu RFC al momento del cobro. Aceptamos pago a meses sin intereses con Stripe." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "L.N. Andrea Vázquez", role: "Nutrióloga clínica", clinic: "NutriBalance Guadalajara", text: "Cambié de Excel a MediFlow y lo que más cambió fue el seguimiento entre consultas. El paciente ve su progreso, yo veo si está cumpliendo las metas, y ya no llego a la cita preguntando '¿cómo te fue?' a ciegas." },
    relatedSlugs: ["medicina-general", "psicologia", "fisioterapia", "medicina-alternativa"],
    unsplashAmbient: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  psicologia: {
    slug: "psicologia",
    category: "salud",
    color: "violet",
    nombre: "Psicología",
    seoTitle: "Software para psicólogos — PHQ-9, GAD-7 y notas SOAP/BIRP",
    seoDescription: "Software para psicólogos en México: escalas PHQ-9 y GAD-7, notas SOAP/BIRP/DAP, plan de seguridad, metas terapéuticas y agenda con WhatsApp. Prueba gratis.",
    heroTitle: "Software para tu consulta psicológica con la confidencialidad que mereces",
    heroSubtitle: "PHQ-9, GAD-7, notas SOAP/BIRP/DAP, plan de seguridad y metas terapéuticas — todo cifrado, todo en un solo lugar.",
    heroVariant: "salud",
    iconMainName: "Brain",
    iconSecondaryNames: ["MessageCircle", "NotebookPen", "Calendar", "HeartHandshake", "ClipboardList", "Users", "Shield", "Lightbulb"],
    designedFor: [
      "Como psicólogo, lo que captures en cada sesión es información sensible — y lo último que quieres es que viva en un Word sin contraseña. MediFlow encripta los expedientes, exige autenticación de dos factores y registra cada acceso por auditoría.",
      "Las escalas estandarizadas (PHQ-9 para depresión con clasificación mínima/leve/moderada/severa, GAD-7 para ansiedad, AUDIT-C para alcohol, DAST para sustancias) están integradas con cálculo automático del score, así no pasas tiempo sumando puntos.",
      "Soportamos tres formatos de nota: SOAP, BIRP (Behavior/Intervention/Response/Plan) y DAP (Data/Assessment/Plan). Plan de seguridad de 6 componentes para casos de riesgo suicida, alianza terapéutica WAISR de 4 ítems y metas terapéuticas con estado (en progreso, lograda, abandonada).",
    ],
    features: [
      { iconName: "ClipboardList", title: "PHQ-9 y GAD-7 integrados",   description: "Escalas validadas con cálculo automático del puntaje y clasificación de severidad. Comparativa entre sesiones para ver tendencia." },
      { iconName: "NotebookPen",   title: "Notas SOAP, BIRP, DAP",      description: "Tres formatos de documentación clínica para que elijas el que mejor se adapte a tu enfoque terapéutico." },
      { iconName: "Shield",        title: "Plan de seguridad",          description: "Plantilla de 6 componentes (señales de alarma, estrategias de afrontamiento, redes de apoyo, contactos de emergencia, restricción de medios)." },
      { iconName: "HeartHandshake", title: "Alianza terapéutica WAISR", description: "Escala de 4 ítems en Likert 1-5 promediada con interpretación. Mide la calidad del vínculo en cada fase del proceso." },
      { iconName: "Lightbulb",     title: "Metas terapéuticas",         description: "Define metas con estado (en progreso, lograda, abandonada) y velo evolucionar sesión tras sesión sin perder el hilo del proceso." },
      { iconName: "Calendar",      title: "Agenda con recordatorios",    description: "Recordatorios automáticos por WhatsApp 24h antes de la sesión. Reduce inasistencias hasta 35% en consulta privada." },
      { iconName: "MessageCircle", title: "Tamizaje AUDIT-C y DAST",     description: "Cuestionarios cortos para detectar consumo de alcohol y sustancias en la primera entrevista, con score y bandera de riesgo." },
      { iconName: "Users",         title: "Sesiones de pareja y familia", description: "Registra múltiples participantes en una misma sesión con notas individuales por cada uno y plan terapéutico compartido." },
    ],
    clinicalFormTitle: "Tu expediente psicológico estructurado",
    clinicalFormDescription: "Incluye PHQ-9 (9 ítems, severidad mínima/leve/moderada/severa), GAD-7 (7 ítems para ansiedad), AUDIT-C, DAST, WAISR para alianza terapéutica, plan de seguridad de 6 componentes, estado mental (ánimo, sueño, apetito, funcionamiento social/laboral, ideación suicida), notas en SOAP/BIRP/DAP y metas terapéuticas con estado de avance.",
    useCases: [
      { title: "Primera entrevista",          description: "Aplicas PHQ-9 y GAD-7 al inicio, capturas historia clínica y motivo de consulta, defines hipótesis diagnóstica y plan de 12 sesiones con metas iniciales." },
      { title: "Sesión de seguimiento",        description: "Repites PHQ-9 para ver evolución, escribes nota BIRP, actualizas el progreso de las metas terapéuticas y agendas la siguiente con recordatorio automático." },
      { title: "Paciente en crisis",           description: "Activas el plan de seguridad de 6 componentes, escalas a emergencias si es necesario, dejas registro detallado y notificas al contacto autorizado." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Los expedientes son confidenciales?",          answer: "Sí. Los expedientes están cifrados en reposo, requieren autenticación de dos factores y cada acceso queda registrado en una bitácora de auditoría." },
      { question: "¿Sirve para terapia en línea?",                 answer: "Sí, MediFlow integra videollamadas con Daily.co. Mandas el link al paciente y entran sin instalar nada — ideal para terapia remota." },
      { question: "¿Tiene escalas validadas?",                     answer: "Sí. PHQ-9, GAD-7, AUDIT-C, DAST y WAISR están integradas con cálculo automático del score y clasificación de severidad." },
      { question: "¿Puedo trabajar con varios psicólogos?",        answer: "Sí, cada psicólogo ve solo sus propios pacientes a menos que el admin del centro le otorgue permisos cruzados explícitos." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Mtro. Diego Salinas", role: "Psicólogo clínico", clinic: "Espacio Mental CDMX", text: "Lo que me convenció fue el plan de seguridad estructurado para casos de riesgo. Antes lo tenía como nota suelta, ahora es una plantilla que no se me olvida llenar y queda en el expediente." },
    relatedSlugs: ["medicina-general", "nutricion", "medicina-alternativa", "fisioterapia"],
    unsplashAmbient: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  dermatologia: {
    slug: "dermatologia",
    category: "salud",
    color: "amber",
    nombre: "Dermatología",
    seoTitle: "Software dermatológico — Fitzpatrick, SCORAD y fotos clínicas",
    seoDescription: "Software para clínicas de dermatología: tipos Fitzpatrick I-VI, escala SCORAD, mapeo corporal de lesiones, fotos antes/después y CFDI 4.0. Prueba 14 días gratis.",
    heroTitle: "Software para tu clínica de dermatología, con la piel como protagonista",
    heroSubtitle: "Tipos Fitzpatrick, escala SCORAD, mapeo corporal de lesiones y fotos clínicas estandarizadas — todo en un solo expediente.",
    heroVariant: "salud",
    iconMainName: "Sun",
    iconSecondaryNames: ["Sparkles", "Camera", "FileText", "Calendar", "Layers", "Eye", "Search", "Shield"],
    designedFor: [
      "En dermatología, la fotografía estandarizada vale más que mil notas. MediFlow tiene un protocolo fotográfico integrado: misma luz, misma distancia, misma postura, comparación lado a lado entre visitas (mejoría, sin cambio o empeoramiento).",
      "El mapeo corporal divide al paciente en 12 zonas y cada lesión queda documentada con tipo (mácula, pápula, placa, vesícula, ampolla, pústula, úlcera, costra, escama), tamaño, color (eritematosa, hiperpigmentada, hipopigmentada, violácea) y bordes.",
      "Para casos de dermatitis atópica, calculamos automáticamente el SCORAD: extensión por la regla de los 9, intensidad de 6 ítems en escala 0-3, y prurito/insomnio en VAS 0-10. Te clasifica el caso como leve (<25), moderado (25-50) o severo (>50) sin que tengas que sumar.",
    ],
    features: [
      { iconName: "Layers",   title: "Tipos de Fitzpatrick I-VI",   description: "Clasificación de fototipo cutáneo del paciente para estratificación de riesgo en procedimientos láser, peelings y exposición solar." },
      { iconName: "Search",   title: "Escala SCORAD automática",    description: "Cálculo de SCORAD para dermatitis atópica con extensión, intensidad de 6 signos y síntomas subjetivos en VAS. Clasificación leve/moderada/severa." },
      { iconName: "Eye",      title: "Mapeo corporal por zonas",    description: "12 zonas del cuerpo con descripción detallada de cada lesión: tipo, tamaño, color, bordes y evolución entre visitas." },
      { iconName: "Camera",   title: "Protocolo fotográfico",       description: "Fotos clínicas estandarizadas con misma luz, distancia y postura. Comparación antes/después entre visitas para documentar evolución." },
      { iconName: "Sparkles", title: "Catálogo CIE-10 dermatológico", description: "19 diagnósticos dermatológicos pre-cargados (psoriasis L40, dermatitis atópica L20, vitíligo L80, etc.) con códigos oficiales." },
      { iconName: "FileText", title: "Historial de procedimientos", description: "Registro de peelings, criocirugía, electrocirugía, biopsias y láseres con parámetros, fecha y resultados visibles en línea de tiempo." },
      { iconName: "Calendar", title: "Agenda con recordatorios",     description: "Recordatorios automáticos por WhatsApp 24h antes de la cita y 7 días antes en casos de seguimiento de tratamiento prolongado." },
      { iconName: "Shield",   title: "Consentimiento informado",     description: "Plantillas de consentimiento por procedimiento (peeling, criocirugía, biopsia) con firma digital del paciente desde el celular." },
    ],
    clinicalFormTitle: "Tu expediente dermatológico visual",
    clinicalFormDescription: "Incluye clasificación de Fitzpatrick I-VI, cálculo automático de SCORAD para dermatitis atópica (extensión por regla de los 9, intensidad de 6 signos en 0-3, prurito y sueño en VAS), mapeo corporal de 12 zonas con descripción de lesiones (tipo, tamaño, color, bordes), CIE-10 dermatológico y protocolo fotográfico estandarizado con comparación entre visitas.",
    useCases: [
      { title: "Acné severo grado IV",         description: "Documentas lesiones por zona facial, fotografías estandarizadas iniciales, prescribes isotretinoína con consentimiento firmado y agendas controles mensuales con SCORAD por visita." },
      { title: "Lunar atípico",                description: "Capturas con dermatoscopia, marcas en mapeo corporal, decides biopsia, generas consentimiento y le mandas por WhatsApp el resultado de patología cuando llegue." },
      { title: "Dermatitis atópica pediátrica", description: "Calculas SCORAD inicial automáticamente, ves la clasificación de severidad, mandas plan de cuidados al cuidador y agendas seguimiento en 4 semanas." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Calcula el SCORAD automáticamente?",            answer: "Sí. Tú capturas extensión, intensidad de los 6 signos clásicos, prurito y trastorno del sueño, y MediFlow calcula el SCORAD final con su clasificación leve/moderada/severa." },
      { question: "¿Soporta dermatoscopia?",                        answer: "Sí, puedes subir fotos de dermatoscopia al expediente del paciente con etiquetas por lesión y comparación entre visitas." },
      { question: "¿Las fotos quedan vinculadas al expediente?",    answer: "Sí, cada foto queda asociada a la zona corporal y a la cita en la que se tomó. La línea de tiempo del paciente muestra la evolución visual." },
      { question: "¿Tiene catálogo CIE-10 dermatológico?",          answer: "Sí, los 19 diagnósticos dermatológicos más comunes están pre-cargados con sus códigos oficiales L20, L40, L80, etc." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Dra. Patricia Mendoza", role: "Dermatóloga", clinic: "Piel Clínica Polanco", text: "El protocolo fotográfico estandarizado fue lo que me hizo cambiar. Ahora cada foto es comparable y los pacientes ven su evolución real, no impresiones subjetivas." },
    relatedSlugs: ["medicina-estetica", "medicina-general", "centros-estetica", "depilacion-laser"],
    unsplashAmbient: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  fisioterapia: {
    slug: "fisioterapia",
    category: "salud",
    color: "lime",
    nombre: "Fisioterapia",
    seoTitle: "Software para fisioterapia — VAS, ROM, DASH y HEP",
    seoDescription: "Software para clínicas de fisioterapia: escala VAS, mediciones ROM, pruebas ortopédicas, DASH/KOOS/Oswestry y programa HEP. Prueba 14 días gratis.",
    heroTitle: "Software para tu clínica de fisioterapia que mide la mejoría real",
    heroSubtitle: "VAS, ROM, pruebas ortopédicas regionales, DASH/KOOS/Oswestry y programa de ejercicios en casa — todo en un solo expediente.",
    heroVariant: "salud",
    iconMainName: "Activity",
    iconSecondaryNames: ["Dumbbell", "Target", "TrendingUp", "Calendar", "FileText", "Footprints", "Zap", "Users"],
    designedFor: [
      "Como fisioterapeuta sabes que tu trabajo se mide en grados, centímetros y porcentajes — no en sensaciones. MediFlow integra escala VAS de 0-10 para dolor, mediciones de ROM (rango de movimiento) por articulación con grados y lateralidad, y outcome measures validados como DASH, KOOS, NDI y Oswestry con conversión automática a severidad.",
      "Las pruebas ortopédicas están organizadas por región: hombro (Neer, Hawkins, Jobe), rodilla (Lachman, McMurray), columna lumbar (Lasègue/SLR, Slump). Marcas las que aplicaste y el resultado, y queda en el expediente sin que tengas que escribir párrafos.",
      "El programa de ejercicios en casa (HEP) se entrega al paciente con nombre del ejercicio, series, repeticiones y frecuencia. Reciben recordatorios diarios por WhatsApp para mantener adherencia entre sesiones.",
    ],
    features: [
      { iconName: "Activity",    title: "Escala VAS de dolor",          description: "0 a 10 con anclas de texto pre/post sesión y delta automático para mostrar mejoría inmediata al paciente." },
      { iconName: "Target",      title: "Mediciones ROM",               description: "Rango de movimiento por articulación con grados, movimiento (flexión, extensión, rotación) y lateralidad. Comparativa entre sesiones." },
      { iconName: "TrendingUp",  title: "Outcome measures",             description: "DASH para hombro/codo/muñeca, KOOS para rodilla, NDI para cuello, Oswestry para lumbar. Conversión automática de % a severidad." },
      { iconName: "Dumbbell",    title: "Programa HEP",                 description: "Programa de ejercicios en casa con nombre, series, repeticiones, frecuencia y videos opcionales por ejercicio." },
      { iconName: "Users",       title: "Pruebas ortopédicas",          description: "Tests por región: Neer, Hawkins, Jobe (hombro), Lachman, McMurray (rodilla), Lasègue, Slump (columna). Marcas y queda registrado." },
      { iconName: "Footprints",  title: "Evaluación postural y marcha", description: "Vistas anterior, lateral y posterior con observaciones, más patrones de marcha (antiálgico, Trendelenburg, en estepaje)." },
      { iconName: "Zap",         title: "Tratamientos aplicados",       description: "Terapia manual, TENS, EMS, ultrasonido, dry needling e hidroterapia con parámetros y duración por sesión." },
      { iconName: "Calendar",    title: "Sesiones autorizadas vs hechas", description: "Conteo automático de sesiones autorizadas por la aseguradora vs las realizadas, con alerta cuando se acerca al límite." },
    ],
    clinicalFormTitle: "Tu expediente fisioterapéutico medible",
    clinicalFormDescription: "Incluye VAS de dolor 0-10, mediciones de ROM en grados por articulación con lateralidad, baterías de pruebas ortopédicas por región (hombro, rodilla, columna), outcome measures DASH/KOOS/NDI/Oswestry con conversión automática a severidad, evaluación postural en 3 vistas, patrones de marcha y programa HEP con series, reps y frecuencia.",
    useCases: [
      { title: "Lesión de manguito rotador",    description: "Aplicas tests de Neer, Hawkins y Jobe, mides ROM en grados, capturas DASH inicial, defines plan de 12 sesiones y entregas HEP con 5 ejercicios diarios." },
      { title: "Recuperación post-cirugía rodilla", description: "Mides KOOS pre/post cirugía, registras ROM por sesión, aplicas TENS y terapia manual, y muestras la mejoría en una gráfica al paciente." },
      { title: "Dolor lumbar crónico",          description: "Aplicas Oswestry inicial, evaluación postural completa, defines plan de 8 sesiones con tracción y ejercicios de Williams, y mandas el HEP por WhatsApp." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Tiene VAS y outcome measures validados?",       answer: "Sí. Escala VAS 0-10 con anclas de texto, además de DASH, KOOS, NDI y Oswestry con conversión automática de score a severidad clínica." },
      { question: "¿El paciente recibe su HEP por WhatsApp?",        answer: "Sí, el programa de ejercicios en casa se manda al paciente por WhatsApp con instrucciones, series, repeticiones y frecuencia. Opcionalmente con videos." },
      { question: "¿Sirve para fisioterapia deportiva?",            answer: "Sí. Las pruebas ortopédicas, ROM detallado y outcome measures KOOS/DASH son ideales para atletas y deportistas en rehabilitación." },
      { question: "¿Puedo facturar a aseguradoras?",                answer: "Sí, MediFlow lleva control de sesiones autorizadas vs realizadas y emite CFDI 4.0 con el RFC de la aseguradora cuando corresponde." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "L.F.T. Carlos Rivera", role: "Fisioterapeuta", clinic: "Reactiva Centro de Rehabilitación", text: "El HEP por WhatsApp cambió la adherencia de mis pacientes — ahora sí hacen los ejercicios en casa porque les llega el recordatorio. Y los outcome measures me dejan demostrar la mejoría con datos, no con sensaciones." },
    relatedSlugs: ["podologia", "medicina-general", "medicina-alternativa", "masajes"],
    unsplashAmbient: "https://images.unsplash.com/photo-1599493758267-c6c884c7071f?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  podologia: {
    slug: "podologia",
    category: "salud",
    color: "rose",
    nombre: "Podología",
    seoTitle: "Software para podología — IWGDF, mapeo plantar y ortesis",
    seoDescription: "Software para clínicas de podología: clasificación IWGDF de pie diabético, mapeo plantar, ITB, monofilamento, pipeline de ortesis y CFDI 4.0. Prueba gratis.",
    heroTitle: "Software para tu clínica de podología que cuida cada paso",
    heroSubtitle: "Clasificación de riesgo IWGDF, mapeo plantar, evaluación vascular con ITB y pipeline de ortesis personalizadas — todo en un solo expediente.",
    heroVariant: "salud",
    iconMainName: "Footprints",
    iconSecondaryNames: ["Activity", "Scissors", "FileText", "Calendar", "Camera", "Shield", "Search", "AlertCircle"],
    designedFor: [
      "El pie diabético no se diagnostica con buenas intenciones, se mide. MediFlow integra el screening IWGDF completo: monofilamento de Semmes-Weinstein en 4 sitios (Hallux, 1er MTT, 3er MTT, 5to MTT), evaluación de sensibilidad, temperatura, pulsos pedio y tibial, llenado capilar e ITB con interpretación automática (normal, EAP leve, EAP moderada, EAP severa).",
      "La clasificación de riesgo (Riesgo 0 sin neuropatía, Riesgo 1 con neuropatía, Riesgo 2 con neuropatía + deformidad/EAP, Riesgo 3 con úlcera o amputación previa) se calcula sola con base en lo que capturas, y dispara recomendaciones de seguimiento por nivel.",
      "El pipeline de ortesis personalizadas tiene 6 estados (evaluación, molde tomado, en laboratorio, listo para entrega, entregado, en ajuste) para que sepas en qué etapa está cada par de plantillas y avises al paciente cuando estén listas.",
    ],
    features: [
      { iconName: "Activity",     title: "Screening IWGDF",            description: "Monofilamento en 4 sitios, sensibilidad, temperatura, pulsos pedio y tibial, llenado capilar e ITB con clasificación automática Riesgo 0-3." },
      { iconName: "Search",       title: "Mapeo plantar",              description: "7 zonas plantares (hallux, dedos menores, cabezas metatarsales, arco medial, lateral, talón medial, lateral) con 6 estados de presión y úlceras." },
      { iconName: "Shield",       title: "ITB con interpretación",     description: "Índice tobillo-brazo con clasificación automática: normal (>0.9), EAP leve (0.7-0.9), moderada (0.4-0.7) o severa (<0.4)." },
      { iconName: "FileText",     title: "Pipeline de ortesis",        description: "6 estados de seguimiento de ortesis: evaluación, molde tomado, en laboratorio, listo para entrega, entregado y en ajuste." },
      { iconName: "Camera",       title: "Documentación de heridas",   description: "Captura largo, ancho, profundidad y tipo de herida (úlcera, herida, callo, verruga) con fotografías comparativas entre visitas." },
      { iconName: "Scissors",     title: "Tratamientos podológicos",   description: "Cirugía ungueal, desbridamiento, evaluación biomecánica, fascitis plantar, crioterapia para verruga y cuidado general." },
      { iconName: "Calendar",     title: "Recall automatizado",        description: "Sistema de citas de seguimiento programadas a 1, 3, 6 o 12 meses según el nivel de riesgo del paciente." },
      { iconName: "AlertCircle",  title: "Evaluación de calzado",      description: "Registra observaciones del calzado del paciente con recomendaciones específicas según su riesgo y patología." },
    ],
    clinicalFormTitle: "Tu expediente podológico con clasificación IWGDF",
    clinicalFormDescription: "Incluye monofilamento Semmes-Weinstein en 4 sitios bilateral, sensibilidad, temperatura, pulsos pedio y tibial, llenado capilar, ITB con interpretación automática EAP, mapeo plantar de 7 zonas con 6 estados, pipeline de ortesis con 6 fases, dimensiones de heridas y clasificación IWGDF Riesgo 0-3 calculada automáticamente.",
    useCases: [
      { title: "Paciente diabético nuevo",      description: "Aplicas screening IWGDF completo, calculas riesgo automático, defines recall a 3 meses si es Riesgo 1, registras evaluación de calzado y educas al paciente." },
      { title: "Ortesis personalizada",         description: "Tomas molde, marcas estado en pipeline, le avisas al laboratorio, actualizas estados a entrega y ajuste, y notificas al paciente por WhatsApp cuando estén listas." },
      { title: "Úlcera plantar grado II",        description: "Mides largo/ancho/profundidad, fotografías iniciales, plan de desbridamiento semanal, control de presión y seguimiento fotográfico hasta cicatrización completa." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Calcula el IWGDF automáticamente?",            answer: "Sí. Tú capturas monofilamento, sensibilidad, deformidades y antecedentes, y MediFlow calcula el nivel de riesgo (0, 1, 2 o 3) con sus recomendaciones de seguimiento." },
      { question: "¿Lleva control de ortesis personalizadas?",     answer: "Sí, hay un pipeline de 6 estados desde evaluación hasta entrega y ajuste, con notificaciones al paciente por WhatsApp en cada cambio." },
      { question: "¿Documenta heridas con fotos?",                  answer: "Sí. Cada herida tiene dimensiones (largo, ancho, profundidad) y fotos seriadas para ver evolución de cicatrización en línea de tiempo." },
      { question: "¿Sirve para podología deportiva?",              answer: "Sí. La evaluación biomecánica, mapeo plantar y registro de calzado son útiles también para deportistas con sobrecargas o lesiones repetitivas." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Lic. Sandra Ortiz", role: "Podóloga", clinic: "PiePro Querétaro", text: "El IWGDF integrado me cambió la vida. Antes calculaba el riesgo en una hojita, ahora MediFlow lo hace en automático y me dice el seguimiento sugerido — y queda en el expediente para auditoría." },
    relatedSlugs: ["fisioterapia", "medicina-general", "dental", "dermatologia"],
    unsplashAmbient: "https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "medicina-estetica": {
    slug: "medicina-estetica",
    category: "salud",
    color: "pink",
    nombre: "Medicina Estética",
    seoTitle: "Software para medicina estética — GAIS, mapeo facial y trazabilidad",
    seoDescription: "Software para clínicas de medicina estética: escala GAIS, mapeo facial por zonas, trazabilidad de lotes, fotos antes/después y paquetes de sesiones. Prueba gratis.",
    heroTitle: "Software para tu clínica de medicina estética con resultados medibles",
    heroSubtitle: "Mapeo facial por 8 zonas, escala GAIS pre/post, trazabilidad de lotes, paquetes de sesiones y fotos antes/después estandarizadas — todo en un solo lugar.",
    heroVariant: "estetica",
    iconMainName: "Sparkles",
    iconSecondaryNames: ["Syringe", "Camera", "Calendar", "FileText", "Star", "Heart", "Droplet", "TrendingUp"],
    designedFor: [
      "En medicina estética, los resultados se demuestran con fotos comparables y escalas validadas. MediFlow integra la GAIS (Global Aesthetic Improvement Scale) con calificación pre/post y delta calculado de -1 a 3, para que tu paciente vea su mejoría objetiva.",
      "El mapeo facial divide el rostro en 8 zonas (frente, glabela, patas de gallo, surcos nasogenianos, labios, mentón, pómulos, mandíbula) y cada zona registra el producto aplicado, las unidades o ml, y suma automáticamente el total. La trazabilidad de lote queda registrada — fundamental por norma sanitaria.",
      "Para procedimientos riesgosos, el formulario marca contraindicaciones críticas: embarazo, anticoagulantes, isotretinoína, enfermedades autoinmunes, tendencia a queloides — sin que se te olviden en la consulta.",
    ],
    features: [
      { iconName: "Star",       title: "Escala GAIS pre/post",         description: "Global Aesthetic Improvement Scale con calificación pre y post procedimiento. Delta automático de -1 a 3 para mostrar mejoría objetiva." },
      { iconName: "Syringe",    title: "Mapeo facial por zonas",       description: "8 zonas del rostro (frente, glabela, patas de gallo, surcos nasogenianos, labios, mentón, pómulos, mandíbula) con producto, unidades/ml y total automático." },
      { iconName: "FileText",   title: "Trazabilidad de lotes",        description: "Cada producto inyectado queda registrado con nombre, lote y fecha de caducidad — cumplimiento normativo y respaldo ante auditorías." },
      { iconName: "Camera",     title: "Fotos antes/después",          description: "Protocolo fotográfico estandarizado con misma luz, ángulo y distancia. Comparativa lado a lado para cada visita." },
      { iconName: "Droplet",    title: "Catálogo de procedimientos",   description: "Botox, rellenos, PRP, mesoterapia, peelings, hilos tensores y láser con protocolos pre-definidos por procedimiento." },
      { iconName: "Heart",      title: "Contraindicaciones",           description: "Lista pre-cargada: embarazo, anticoagulantes, isotretinoína, autoinmunes, tendencia a queloides — checklist obligatorio antes del procedimiento." },
      { iconName: "Calendar",   title: "Paquetes de sesiones",         description: "Vende paquetes de 3, 5 o 10 sesiones con control de redenciones y aviso automático cuando le quedan pocas al paciente." },
      { iconName: "TrendingUp", title: "Notas post y plan",            description: "Notas post-procedimiento con instrucciones para el paciente y plan para la siguiente sesión, todo vinculado al expediente." },
    ],
    clinicalFormTitle: "Tu expediente estético con trazabilidad y GAIS",
    clinicalFormDescription: "Incluye Fitzpatrick para riesgo de procedimiento, mapeo facial de 8 zonas con producto/unidades/lote por zona, GAIS pre/post con delta automático, lista de contraindicaciones críticas (embarazo, anticoagulantes, isotretinoína, autoinmunes, queloides), notas post-procedimiento, plan de siguiente sesión y protocolo fotográfico estandarizado.",
    useCases: [
      { title: "Aplicación de toxina botulínica",  description: "Marcas zonas frente y glabela, registras producto y unidades por zona, capturas foto pre, calificas GAIS inicial, ejecutas, capturas foto post y agendas revisión a 14 días." },
      { title: "Paquete de rellenos facial",        description: "Vendes paquete de 3 sesiones, planeas distribución por visita en mejillas, surcos y labios, y trackeas redenciones con foto comparativa por sesión." },
      { title: "Tratamiento PRP capilar",            description: "Defines plan de 6 sesiones, capturas foto inicial estandarizada, registras parámetros de centrifugación y muestras evolución mes a mes." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Lleva trazabilidad de productos inyectables?",  answer: "Sí. Cada aplicación queda con nombre del producto, lote, fecha de caducidad y cantidad — cumple con requisitos sanitarios y respalda ante auditorías." },
      { question: "¿Calcula la GAIS automáticamente?",              answer: "Sí, capturas la calificación pre y post del paciente y MediFlow calcula el delta de mejoría con clasificación visual." },
      { question: "¿Soporta paquetes de sesiones?",                  answer: "Sí, puedes vender paquetes de 3, 5 o 10 sesiones, llevar control de redenciones y avisar al paciente cuando le quedan pocas." },
      { question: "¿Tiene plantillas de consentimiento?",           answer: "Sí, plantillas por procedimiento (toxina, rellenos, PRP, peeling) que el paciente firma desde el celular antes de la aplicación." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Dra. Fernanda Ríos", role: "Médica Estética", clinic: "Estética Roma", text: "Lo de la trazabilidad de lotes me da tranquilidad. Si una marca tiene retiro de producto, en 30 segundos sé qué pacientes recibieron ese lote y los puedo contactar." },
    relatedSlugs: ["dermatologia", "clinicas-capilares", "centros-estetica", "depilacion-laser"],
    unsplashAmbient: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "clinicas-capilares": {
    slug: "clinicas-capilares",
    category: "salud",
    color: "purple",
    nombre: "Clínicas Capilares",
    seoTitle: "Software para clínicas capilares — Norwood, conteo de grafts y supervivencia",
    seoDescription: "Software para clínicas de restauración capilar: clasificación Norwood/Ludwig, conteo de grafts, seguimiento de supervivencia y técnicas FUE/FUT/PRP. Prueba gratis.",
    heroTitle: "Software para tu clínica capilar con datos por folículo",
    heroSubtitle: "Clasificación Norwood/Ludwig, conteo de grafts cosechados vs implantados, supervivencia por zona y línea de tiempo a 12 meses — todo en un solo expediente.",
    heroVariant: "salud",
    iconMainName: "Scissors",
    iconSecondaryNames: ["Microscope", "Camera", "FileText", "Calendar", "LineChart", "Users", "Sparkles", "Target"],
    designedFor: [
      "En restauración capilar, la diferencia entre un buen resultado y uno excelente está en los datos: cuántos grafts cosechaste, cuántos implantaste, cuántos sobrevivieron a los 12 meses por zona, qué densidad alcanzaste en folículos por cm². MediFlow lleva todo eso de forma estructurada para que cada cirugía sea comparable.",
      "Clasificación Norwood I-VII para hombres y Ludwig I-III para mujeres con clasificación visual integrada. Para cada zona tratada (frontal, temporal, vertex, occipital, hairline) capturas grafts implantados y a los 1, 3, 6, 9 y 12 meses registras supervivencia con porcentaje calculado automáticamente.",
      "Soportamos las técnicas FUE, FUT y PRP capilar. Cada paciente tiene su línea de tiempo fotográfica con observaciones por hito y evolución de densidad medible.",
    ],
    features: [
      { iconName: "Microscope", title: "Norwood y Ludwig integrados",  description: "Clasificación visual Norwood I-VII para hombres y Ludwig I-III para mujeres en el formulario de evaluación inicial." },
      { iconName: "Target",     title: "Conteo de grafts",             description: "Grafts cosechados vs implantados con diferencial automático y desglose por zona donante y receptora." },
      { iconName: "LineChart",  title: "Densidad folículos/cm²",        description: "Captura densidad basal y posterior al procedimiento, con porcentaje de cambio calculado por zona tratada." },
      { iconName: "Camera",     title: "Línea de tiempo a 12 meses",   description: "Hitos fotográficos a 1, 3, 6, 9 y 12 meses post-operatorio con observaciones del paciente y del cirujano." },
      { iconName: "Calendar",   title: "Supervivencia por zona",        description: "Registro de supervivencia de injertos a 12 meses por cada zona (frontal, temporal, vertex, occipital, hairline) con porcentaje." },
      { iconName: "Sparkles",   title: "Técnicas FUE, FUT, PRP",       description: "Soporta los 3 protocolos principales con campos específicos por técnica y catálogo de procedimientos asociados." },
      { iconName: "FileText",   title: "Consentimiento informado",     description: "Plantillas de consentimiento por técnica, firma digital del paciente y archivo PDF en el expediente." },
      { iconName: "Users",      title: "Multi-cirujano y permisos",    description: "Cada cirujano ve sus propios pacientes, el admin ve todo y configura comisiones por procedimiento o por graft." },
    ],
    clinicalFormTitle: "Tu expediente capilar con conteo y supervivencia",
    clinicalFormDescription: "Incluye clasificación visual Norwood I-VII (hombres) y Ludwig I-III (mujeres), conteo de grafts cosechados vs implantados con diferencial, densidad folículos/cm² basal y post, zonas tratadas (frontal, temporal, vertex, occipital, hairline), línea de tiempo de 1/3/6/9/12 meses con observaciones, y porcentaje de supervivencia por zona calculado automáticamente.",
    useCases: [
      { title: "Evaluación pre-operatoria",       description: "Clasificas Norwood o Ludwig, calculas grafts requeridos por zona, fotografías estandarizadas iniciales y firmas consentimiento desde el celular del paciente." },
      { title: "Cirugía FUE de 2500 grafts",      description: "Capturas extraídos vs implantados, distribución por zona, documentas técnica usada y agendas controles automáticos a 1, 3, 6 y 12 meses." },
      { title: "Control de 6 meses",              description: "Tomas fotos comparativas, calculas supervivencia por zona, registras observaciones del paciente y comparas densidad inicial vs actual." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Soporta FUE, FUT y PRP capilar?",              answer: "Sí, las tres técnicas principales con campos específicos por protocolo y catálogo de procedimientos asociados." },
      { question: "¿Calcula supervivencia por zona automáticamente?", answer: "Sí. Capturas grafts implantados y los visibles en cada hito, y MediFlow calcula la supervivencia porcentual por zona tratada." },
      { question: "¿Sirve para clínicas con varios cirujanos?",     answer: "Sí, cada cirujano ve sus pacientes y agenda. El admin gestiona comisiones, paquetes y reportes consolidados." },
      { question: "¿El paciente recibe sus fotos comparativas?",    answer: "Sí, puedes compartir un enlace seguro al paciente con su línea de tiempo fotográfica de evolución." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Dr. Alejandro Castro", role: "Cirujano capilar", clinic: "Capilar México", text: "El conteo automático de supervivencia por zona me permite mostrar resultados reales a pacientes nuevos. Antes era 'créeme', ahora es 'mira la gráfica'." },
    relatedSlugs: ["medicina-estetica", "dermatologia", "centros-estetica", "peluquerias"],
    unsplashAmbient: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "centros-estetica": {
    slug: "centros-estetica",
    category: "estetica",
    color: "rose",
    nombre: "Centros de Estética",
    seoTitle: "Software para centro de estética — Baumann, paquetes y antes/después",
    seoDescription: "Software para centros de estética en México: tipo de piel Baumann, parámetros de equipos, paquetes de tratamiento, fotos antes/después y CFDI 4.0. Prueba gratis.",
    heroTitle: "Software para tu centro de estética que vende paquetes con confianza",
    heroSubtitle: "Tipo de piel Baumann, parámetros de equipos, paquetes de sesiones con redenciones, fotos antes/después y agenda con WhatsApp — todo en un solo lugar.",
    heroVariant: "estetica",
    iconMainName: "Flower2",
    iconSecondaryNames: ["Sparkles", "Camera", "Calendar", "Package", "Star", "Heart", "Palette", "Wand2"],
    designedFor: [
      "Tu centro de estética vive de paquetes y de mostrar resultados. MediFlow está diseñado para que vendas paquetes con confianza: cada paquete tiene un número de sesiones contratadas, redenciones, vencimiento opcional y aviso al cliente cuando le quedan pocas o cuando está por expirar.",
      "El expediente captura tipo de piel Baumann en sus 4 dimensiones: hidratación (oleoso/seco), sensibilidad (sensible/resistente), pigmentación (pigmentado/no pigmentado) y arrugas (rugoso/tenso). Esto te permite recomendar el tratamiento correcto desde la primera visita.",
      "Para tratamientos con equipo (radiofrecuencia, cavitación, LED, microdermoabrasión), guardas los parámetros usados (energía en J/cm², frecuencia en Hz, profundidad, tiempo de exposición) para reproducir resultados o ajustar en la siguiente sesión.",
    ],
    features: [
      { iconName: "Sparkles", title: "Tipo de piel Baumann",          description: "Clasificación de 4 dimensiones (hidratación, sensibilidad, pigmentación, arrugas) que define el tratamiento ideal por cliente." },
      { iconName: "Wand2",    title: "Catálogo de tratamientos",      description: "Faciales, envolturas corporales, radiofrecuencia, cavitación, LED, microdermoabrasión — todo organizado con duración y precio." },
      { iconName: "Package",  title: "Paquetes con redenciones",       description: "Vende paquetes de 5 o 10 sesiones con vigencia, registro automático de cada redención y aviso cuando quedan pocas." },
      { iconName: "Camera",   title: "Fotos antes/después",            description: "Compara visualmente el progreso del cliente entre sesiones con protocolo fotográfico estandarizado por zona." },
      { iconName: "Star",     title: "Parámetros de equipos",          description: "Energía (J/cm²), frecuencia (Hz), profundidad y tiempo de exposición por sesión y por equipo. Reproducible y auditable." },
      { iconName: "Calendar", title: "Agenda con WhatsApp",            description: "Recordatorios automáticos por WhatsApp 24h antes y mensaje post-tratamiento con instrucciones de cuidados en casa." },
      { iconName: "Heart",    title: "Contraindicaciones",             description: "Lista pre-cargada (embarazo, marcapasos, fotosensibilidad, autoinmunes, heridas abiertas) marcada en cada expediente." },
      { iconName: "Palette",  title: "Reacciones post-tratamiento",    description: "Registra eritema, edema, sensibilidad o descamación con severidad 0-3 y tiempo de resolución para análisis de adherencia." },
    ],
    clinicalFormTitle: "Tu expediente de estética con tipología de piel",
    clinicalFormDescription: "Incluye tipo de piel Baumann en 4 dimensiones, catálogo de tratamientos faciales y corporales, parámetros por equipo (energía J/cm², frecuencia Hz, profundidad, tiempo, modo), reacciones post-tratamiento con severidad 0-3, contraindicaciones críticas y registro de paquetes con redenciones.",
    useCases: [
      { title: "Cliente nuevo de facial",         description: "Aplicas test Baumann, recomiendas paquete de 5 limpiezas con radiofrecuencia, capturas foto inicial y agendas la siguiente cita en 2 semanas." },
      { title: "Tratamiento de cavitación",        description: "Capturas medidas iniciales, parámetros del equipo, ejecutas las 8 sesiones con fotos cada 4, comparas progreso y vendes paquete de mantenimiento." },
      { title: "Microdermoabrasión seriada",       description: "Diseñas plan de 6 sesiones, llevas reacciones post (eritema, descamación) por sesión y ajustas parámetros si el cliente reacciona fuerte." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co"],
    faqs: [
      { question: "¿Cómo manejo los paquetes que vendí?",         answer: "Cada paquete tiene número de sesiones, redenciones contadas automáticamente, fecha de vencimiento opcional y avisos al cliente cuando quedan pocas o están por vencer." },
      { question: "¿Sirve para varios estilistas/profesionales?", answer: "Sí, cada profesional ve su agenda y sus clientes asignados. El admin del centro ve todo y configura comisiones por servicio." },
      { question: "¿Puedo emitir CFDI 4.0?",                     answer: "Sí, MediFlow timbra ante el SAT con tu RFC y manda el XML/PDF al cliente automáticamente al cobro." },
      { question: "¿Las fotos se ven en el celular del cliente?", answer: "Sí, hay un portal opcional donde el cliente revisa su línea de tiempo de fotos comparativas y su próxima cita." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Mariana López", role: "Directora", clinic: "Glow Estética León", text: "Antes perdíamos clientes porque vencían los paquetes y no nos enterábamos. Ahora MediFlow avisa cuando le quedan 2 sesiones y agendamos la siguiente desde el mismo mensaje." },
    relatedSlugs: ["medicina-estetica", "depilacion-laser", "spas", "cejas-pestanas"],
    unsplashAmbient: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "cejas-pestanas": {
    slug: "cejas-pestanas",
    category: "belleza",
    color: "cyan",
    nombre: "Cejas y Pestañas",
    seoTitle: "Software para estudio de cejas y pestañas — Mapa, fórmula y patch test",
    seoDescription: "Software para estudios de cejas y pestañas en México: mapa de pestañas, fórmulas de color, patch test, retención y citas con WhatsApp. Prueba 14 días gratis.",
    heroTitle: "Software para tu estudio de cejas y pestañas, hecho a tu medida",
    heroSubtitle: "Mapa de pestañas con curvatura/largo/grosor, fórmula de tinte, patch test con vencimiento y retención por relleno — todo en una sola app.",
    heroVariant: "belleza",
    iconMainName: "Eye",
    iconSecondaryNames: ["Sparkles", "Palette", "Calendar", "Camera", "Star", "Brush", "Wand2", "Heart"],
    designedFor: [
      "En extensiones de pestañas, los detalles importan: curvatura J/B/C/D, largo de 8 a 16 mm y grosor de 0.05 a 0.25 mm. MediFlow guarda el mapa exacto de cada cliente para que la próxima lashista (o tú misma en 4 semanas) reproduzca el look sin tener que adivinar.",
      "El patch test con fecha y vencimiento a 6 meses queda registrado, así sabes cuándo necesitas repetirlo antes de aplicar pegamento. La sensibilidad histórica del cliente se documenta con producto, reacción y severidad.",
      "Para tinte de cejas y pestañas, guardas la fórmula exacta: marca, ratio de mezcla y tiempo de procesado. Y el porcentaje de retención de pestañas en cada relleno se calcula automáticamente para que veas qué clientes mantienen bien y cuáles no.",
    ],
    features: [
      { iconName: "Eye",      title: "Mapa de pestañas",          description: "Curvatura J/B/C/D, largo 8-16 mm y grosor 0.05-0.25 mm por sección (interna, media, externa) para reproducir el look exacto." },
      { iconName: "Brush",    title: "Fórmula de tinte",          description: "Marca, ratio de mezcla y tiempo de procesado guardados por cliente para reproducir color exacto en cada visita." },
      { iconName: "Heart",    title: "Patch test con vencimiento", description: "Fecha del último patch test con alerta automática a los 6 meses para que repitas antes de aplicar pegamento." },
      { iconName: "Sparkles", title: "Porcentaje de retención",    description: "Cálculo automático de retención por relleno con visualización: bien (>70%), moderado (40-70%), pobre (<40%)." },
      { iconName: "Calendar", title: "Recordatorios de relleno",   description: "Avisos automáticos por WhatsApp a las 2, 3 o 4 semanas para programar el siguiente relleno y mantener la base." },
      { iconName: "Camera",   title: "Fotos antes/después",        description: "Foto del look final y comparativa con visitas anteriores para documentar evolución y compartir con el cliente." },
      { iconName: "Wand2",    title: "Catálogo de servicios",      description: "Extensiones clásicas, volumen ruso, mega volumen, lifting, tinte de cejas y pestañas — con duración y precio." },
      { iconName: "Star",     title: "Historial de sensibilidad",  description: "Registro de reacciones previas (producto, fecha, tipo, severidad) para evitar repetir productos problemáticos." },
    ],
    clinicalFormTitle: "Tu expediente de cejas y pestañas reproducible",
    clinicalFormDescription: "Incluye mapa de pestañas por sección con curvatura J/B/C/D, largo 8-16 mm y grosor 0.05-0.25 mm; fórmula de tinte (marca, ratio, tiempo); patch test con vencimiento de 6 meses; intervalo de relleno (2/3/4 semanas); evaluación de pestañas naturales (largo, densidad, curvatura, condición frágil/escasa/debilitada) y porcentaje de retención calculado.",
    useCases: [
      { title: "Cliente nueva de extensiones",   description: "Aplicas patch test, evalúas pestañas naturales, defines mapa de curvatura y largo, fotografías el look final y agendas relleno en 3 semanas." },
      { title: "Relleno con cálculo de retención", description: "Capturas pestañas faltantes, calculas retención automática, decides si rellenar o aplicar set nuevo y comentas con la cliente." },
      { title: "Tinte de cejas con henna",        description: "Capturas fórmula y tiempo, fotografías antes y después, mandas el resultado por WhatsApp y agendas siguiente cita." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Instagram"],
    faqs: [
      { question: "¿Guarda el mapa exacto de cada cliente?",        answer: "Sí. Curvatura J/B/C/D, largo y grosor por sección. Cuando vuelve la cliente, abres su mapa y lo reproduces sin tener que adivinar." },
      { question: "¿Manda recordatorio de patch test?",             answer: "Sí, después de 6 meses el sistema avisa que el patch test está vencido y bloquea el agendamiento de servicios con pegamento hasta que se renueve." },
      { question: "¿Calcula retención por cliente?",                 answer: "Sí, en cada relleno capturas pestañas faltantes y MediFlow calcula el porcentaje de retención con clasificación visual." },
      { question: "¿Las fotos van al Instagram del estudio?",        answer: "Puedes descargar la foto desde el expediente y compartirla en Instagram con el catálogo de servicios visible." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Karla Pérez", role: "Lashista certificada", clinic: "Lash Lab Monterrey", text: "El mapa de pestañas guardado por cliente fue mi salvación. Antes anotaba en un cuaderno, ahora cada cliente tiene su mapa exacto y reproduzco el look idéntico cada relleno." },
    relatedSlugs: ["centros-estetica", "unas", "peluquerias", "depilacion-laser"],
    unsplashAmbient: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  masajes: {
    slug: "masajes",
    category: "belleza",
    color: "amber",
    nombre: "Masajes",
    seoTitle: "Software para estudio de masajes — Mapeo de dolor y VAS pre/post",
    seoDescription: "Software para estudios de masajes terapéuticos en México: mapeo corporal de dolor, puntos gatillo, VAS pre/post, contraindicaciones y agenda con WhatsApp. Prueba gratis.",
    heroTitle: "Software para tu estudio de masajes con mapa del dolor a la mano",
    heroSubtitle: "Mapeo corporal de zonas dolorosas, puntos gatillo nombrados, VAS pre/post con delta, contraindicaciones y agenda con WhatsApp — todo en una app.",
    heroVariant: "belleza",
    iconMainName: "Hand",
    iconSecondaryNames: ["Waves", "Heart", "Calendar", "Star", "Flower2", "Clock", "Leaf", "Sparkles"],
    designedFor: [
      "Tu cliente entra con dolor en algún lado y sale buscando un alivio que dure hasta la próxima sesión. MediFlow te permite capturar dónde le duele exactamente con un mapeo corporal por checkboxes, calificar la intensidad antes y después con escala VAS 0-10, y mostrarle el delta de mejoría tangible.",
      "Soportamos los 12 puntos gatillo más comunes (trapecio superior, piriforme, psoas iliaco, etc.) con clasificación activo/latente. La preferencia de presión va de 1 a 5 (suave a firme) y queda registrada para que la siguiente vez no tengas que preguntar.",
      "Para cada cliente registras contraindicaciones críticas (embarazo, várices, hipertensión, lesiones recientes), tipo de masaje preferido (sueco, profundo, deportivo, drenaje linfático, piedras calientes, tailandés, prenatal, miofascial) y zonas a evitar.",
    ],
    features: [
      { iconName: "Hand",     title: "Mapeo corporal de dolor",      description: "Checkboxes por región del cuerpo (cuello, hombros, lumbar, glúteos, isquiotibiales, etc.) para identificar zonas a trabajar en cada sesión." },
      { iconName: "Star",     title: "Puntos gatillo nombrados",     description: "12 puntos gatillo con clasificación activo/latente: trapecio superior, piriforme, psoas iliaco y los 9 más comunes." },
      { iconName: "Heart",    title: "VAS pre/post con delta",        description: "Escala visual analógica 0-10 antes y después de la sesión con cálculo automático del delta de mejoría para mostrar al cliente." },
      { iconName: "Sparkles", title: "Tipos de masaje",               description: "Sueco, profundo, deportivo, drenaje linfático, piedras calientes, tailandés, prenatal, miofascial — catálogo con duración y precio." },
      { iconName: "Leaf",     title: "Contraindicaciones",            description: "Lista pre-cargada (embarazo, várices, hipertensión, lesiones recientes, fiebre) marcada en cada expediente para evitar errores." },
      { iconName: "Flower2",  title: "Preferencias del cliente",       description: "Presión preferida (1-5), aceites favoritos, música, aromas y zonas a evitar — todo guardado para la siguiente cita." },
      { iconName: "Calendar", title: "Agenda con WhatsApp",            description: "Recordatorios automáticos 24h antes con tipo de masaje contratado y mensaje post-sesión con consejos de hidratación." },
      { iconName: "Clock",    title: "Sesiones y paquetes",            description: "Vende paquetes de 5 o 10 sesiones con redenciones automáticas, vencimiento opcional y reportes de utilización." },
    ],
    clinicalFormTitle: "Tu expediente de masaje terapéutico",
    clinicalFormDescription: "Incluye mapeo corporal de zonas dolorosas, 12 puntos gatillo nombrados con clasificación activo/latente, VAS pre/post sesión con delta, evaluación postural en 3 vistas, patrones de marcha, preferencia de presión 1-5, contraindicaciones críticas, tipo de masaje contratado y plan de seguimiento.",
    useCases: [
      { title: "Cliente con dolor lumbar",       description: "Capturas mapeo de zonas, marcas puntos gatillo activos, calificas VAS 8/10 inicial, ejecutas masaje profundo de 60 min, calificas VAS 3/10 post y agendas seguimiento." },
      { title: "Masaje prenatal",                 description: "Marcas embarazo en contraindicaciones, eliges plantilla prenatal con zonas seguras, calificas comodidad post-sesión y mandas recordatorio mensual." },
      { title: "Drenaje linfático en serie",      description: "Vendes paquete de 10 sesiones con vigencia, registras medidas iniciales, llevas redenciones automáticas y comparas medidas al final." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Instagram"],
    faqs: [
      { question: "¿Sirve para masajes terapéuticos y relajantes?",  answer: "Sí, los dos. Tienes catálogos para masajes terapéuticos (deep tissue, miofascial, deportivo) y relajantes (sueco, piedras calientes, prenatal)." },
      { question: "¿Puedo llevar paquetes de sesiones?",              answer: "Sí, vendes paquetes con sesiones contratadas, llevas redenciones automáticas y avisas al cliente cuando le quedan pocas." },
      { question: "¿Manda recordatorios automáticos?",                 answer: "Sí, recordatorio 24h antes de la cita por WhatsApp y mensaje post-sesión con consejos de hidratación y descanso." },
      { question: "¿Funciona si trabajo a domicilio?",                answer: "Sí. Capturas en tu celular durante o después de la sesión y emites factura CFDI desde el mismo dispositivo si la quieres facturar." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Tania Ramos", role: "Masoterapeuta", clinic: "Manos del Sol Cancún", text: "El VAS pre/post fue lo que cambió mi negocio. Ahora les muestro a mis clientes que entraron con un 8 de dolor y salieron con un 3 — y agendan la siguiente sin pensarlo." },
    relatedSlugs: ["fisioterapia", "spas", "medicina-alternativa", "centros-estetica"],
    unsplashAmbient: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "depilacion-laser": {
    slug: "depilacion-laser",
    category: "estetica",
    color: "orange",
    nombre: "Depilación Láser",
    seoTitle: "Software para depilación láser — Fitzpatrick, parámetros y reducción",
    seoDescription: "Software para centros de depilación láser: tipos Fitzpatrick, parámetros por equipo, test spot, paquetes por zona y porcentaje de reducción. Prueba 14 días gratis.",
    heroTitle: "Software para tu centro de depilación láser con parámetros bajo control",
    heroSubtitle: "Tipos Fitzpatrick, parámetros de Alexandrita/Diodo/Nd:YAG/IPL, test spot a 24-48h, paquetes por zona y reducción acumulada — todo en una app.",
    heroVariant: "estetica",
    iconMainName: "Zap",
    iconSecondaryNames: ["Sparkles", "Calendar", "Camera", "Shield", "Target", "Package", "Clock", "Star"],
    designedFor: [
      "La depilación láser segura empieza por conocer el tipo de piel del cliente: Fitzpatrick I-VI determina qué equipo y qué parámetros usar. MediFlow registra el fototipo y muestra alertas si los parámetros configurados son incompatibles con la piel del cliente.",
      "Para cada sesión registras los parámetros exactos: fluencia (J/cm²), ancho de pulso (ms), tamaño del spot (mm), método de enfriamiento (cryo, contacto, aire). Esto te permite reproducir resultados o ajustar agresividad por sesión.",
      "El test spot a las 24-48h queda documentado por zona con parámetros y reacción, antes de hacer el tratamiento completo. La reducción acumulada por zona se calcula automáticamente entre sesiones para mostrar progreso al cliente.",
    ],
    features: [
      { iconName: "Shield",   title: "Tipos Fitzpatrick I-VI",       description: "Clasificación obligatoria del fototipo cutáneo del cliente con alertas si los parámetros son incompatibles con su piel." },
      { iconName: "Sparkles", title: "Equipos Alex/Diodo/Nd:YAG/IPL", description: "Cada equipo con sus rangos de parámetros aceptados — fluencia, pulso, spot — para cada zona corporal." },
      { iconName: "Target",   title: "Parámetros por sesión",         description: "Fluencia (J/cm²), ancho de pulso (ms), spot (mm), método de enfriamiento — guardado y reproducible en siguiente sesión." },
      { iconName: "Camera",   title: "Test spot a 24-48h",            description: "Registro de test spot inicial con parámetros, foto de reacción a 24h y a 48h, y resultado para autorizar tratamiento completo." },
      { iconName: "Star",     title: "Reducción acumulada",           description: "Cálculo automático del porcentaje de reducción de vello por zona entre sesiones con barra de progreso visual." },
      { iconName: "Package",  title: "Paquetes por zona",             description: "Vende paquetes por zona corporal (axilas, piernas completas, bikini, espalda) con sesiones contratadas y vencimiento." },
      { iconName: "Calendar", title: "Espaciado entre sesiones",      description: "Recordatorios automáticos cuando llega el momento de la siguiente sesión según ciclo capilar (4-6 semanas según zona)." },
      { iconName: "Clock",    title: "Pre-sesión checklist",          description: "Lista de 6 contraindicaciones (sol, depilación con cera, retinoides, autobronceador, fotosensibles, rasurado) marcada antes de cada sesión." },
    ],
    clinicalFormTitle: "Tu expediente láser con parámetros y reducción",
    clinicalFormDescription: "Incluye Fitzpatrick I-VI, color de vello (6 categorías de negro a gris), grosor (fino/medio/grueso), 4 tipos de equipo (Alexandrita, Diodo, Nd:YAG, IPL), parámetros por sesión (fluencia, pulso, spot, enfriamiento), checklist pre-sesión de 6 contraindicaciones, protocolo de test spot a 24-48h y porcentaje de reducción acumulada por zona.",
    useCases: [
      { title: "Cliente nuevo de piernas completas",  description: "Capturas Fitzpatrick III, color y grosor del vello, haces test spot, esperas 24-48h, autorizas y vendes paquete de 8 sesiones con primera cita en 4 semanas." },
      { title: "Sesión de mantenimiento axilas",       description: "Recuperas parámetros previos, ajustas si la reducción ya es alta, registras nueva sesión y muestras la barra de progreso de reducción." },
      { title: "Cliente con piel oscura Fitzpatrick V", description: "Sistema te muestra solo los equipos compatibles (Nd:YAG), bloquea fluencias inseguras y exige test spot doble antes de tratamiento completo." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Instagram"],
    faqs: [
      { question: "¿Soporta los 4 tipos de láser principales?",     answer: "Sí: Alexandrita 755 nm, Diodo 800 nm, Nd:YAG 1064 nm e IPL — cada uno con sus rangos de parámetros aceptados por zona y fototipo." },
      { question: "¿Tiene checklist pre-sesión obligatorio?",       answer: "Sí, 6 contraindicaciones (sol reciente, depilación con cera, retinoides, autobronceador, fotosensibles, rasurado) que debes confirmar antes de cada sesión." },
      { question: "¿Cómo calcula la reducción acumulada?",          answer: "Capturas densidad de vello pre y observación post por zona, y MediFlow calcula el porcentaje de reducción acumulada con barra visual." },
      { question: "¿Funciona con varios equipos en el mismo centro?", answer: "Sí, registras múltiples equipos con sus parámetros respectivos. Cada sesión queda asociada al equipo usado para reproducir condiciones." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Lic. Daniela Ortega", role: "Cosmiatra", clinic: "Suave Láser Querétaro", text: "La alerta de Fitzpatrick me ha salvado de quemaduras en pieles oscuras. Antes confiaba en mi memoria, ahora el sistema me bloquea fluencias peligrosas." },
    relatedSlugs: ["centros-estetica", "medicina-estetica", "dermatologia", "spas"],
    unsplashAmbient: "https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  peluquerias: {
    slug: "peluquerias",
    category: "belleza",
    color: "indigo",
    nombre: "Peluquerías",
    seoTitle: "Software para salón de peluquería — Fórmulas de color y agenda",
    seoDescription: "Software para salones de peluquería en México: fórmulas de color por cliente, diagnóstico capilar, comisiones por estilista, agenda online y CFDI. Prueba 14 días gratis.",
    heroTitle: "Software para tu salón de peluquería con fórmulas que no se olvidan",
    heroSubtitle: "Fórmulas de color exactas por cliente, diagnóstico capilar, agenda online por estilista y comisiones automáticas — todo en una app.",
    heroVariant: "belleza",
    iconMainName: "Scissors",
    iconSecondaryNames: ["Palette", "Calendar", "Users", "Star", "Package", "Brush", "Camera", "Sparkles"],
    designedFor: [
      "El cliente vuelve cada mes y espera el mismo color exacto. MediFlow guarda la fórmula real: marca, tono (ej. 7/1), ratio (1:1.5) y volumen del oxidante (10/20/30/40). Cuando vuelve, abres su expediente y reproduces el color sin tener que adivinar.",
      "El diagnóstico capilar incluye porosidad (baja/media/alta), tipo de cuero cabelludo (graso/seco/mixto), elasticidad, grosor y nivel de daño 1-5 con código de color. Esto te permite recomendar tratamientos, productos y frecuencia de visita.",
      "Soportamos múltiples estilistas con agenda separada, asignación por servicio (color, corte, peinado, alaciado) y cálculo automático de comisiones por estilista al final del día.",
    ],
    features: [
      { iconName: "Palette",  title: "Fórmula de color por cliente", description: "Marca, tono (ej. 7/1), ratio (1:1.5) y volumen del oxidante (10-40) guardados por cliente. Reproducible en cada visita." },
      { iconName: "Brush",    title: "Diagnóstico capilar",          description: "Porosidad, tipo de cuero cabelludo, elasticidad, grosor y nivel de daño 1-5. Define qué productos recomendarle al cliente." },
      { iconName: "Calendar", title: "Agenda online por estilista",  description: "Cada estilista con su agenda independiente, slots de tiempo configurables y reservas online por el cliente." },
      { iconName: "Users",    title: "Comisiones por servicio",      description: "Cálculo automático de comisión por estilista al final del día con desglose por servicio (color, corte, peinado, mechas)." },
      { iconName: "Star",     title: "Servicios y precios",          description: "Catálogo configurable de servicios con duración estimada para que la agenda calcule slots correctos automáticamente." },
      { iconName: "Package",  title: "Inventario de productos",       description: "Stock de tintes, oxidantes, decolorantes y productos para venta con alerta de mínimo y registro de uso por servicio." },
      { iconName: "Camera",   title: "Fotos antes/después",          description: "Documenta cambios drásticos (cambio de color, transformación) con foto comparativa y permiso para subir a Instagram del salón." },
      { iconName: "Sparkles", title: "Recordatorios de visita",       description: "Aviso por WhatsApp cuando el cliente normalmente vendría (ej. 5 semanas) para que agende sin que lo olvides." },
    ],
    clinicalFormTitle: "Tu expediente de peluquería con la fórmula exacta",
    clinicalFormDescription: "Incluye 5 tipos de cabello (liso fino a rizado), fórmula de color con marca/tono/ratio/oxidante, tiempo de procesado, diagnóstico capilar (porosidad baja/media/alta, cuero cabelludo graso/seco/mixto, elasticidad, grosor), nivel de daño 1-5, preferencias del cliente (estilo, frecuencia de visita, productos favoritos) y recomendaciones de cuidado en casa.",
    useCases: [
      { title: "Clienta nueva de color",         description: "Diagnostica cabello, decide proceso, captura fórmula nueva, ejecuta, fotografía resultado y agenda retoque en 5 semanas con recordatorio automático." },
      { title: "Retoque de raíz mensual",         description: "Abres el expediente, recuperas fórmula del último color, ajustas si hay canas, ejecutas y le mandas la próxima cita por WhatsApp." },
      { title: "Cambio drástico con balayage",    description: "Capturas fotos pre y consentimiento del cambio, registras técnica usada, productos por sesión y resultado final para cartera del salón." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Instagram"],
    faqs: [
      { question: "¿Guarda la fórmula exacta del color?",            answer: "Sí. Marca, tono (ej. 7/1), ratio (1:1.5) y volumen del oxidante (10/20/30/40) por cliente. Cuando vuelve, abres su expediente y reproduces el color." },
      { question: "¿Tiene reservas online para clientes?",            answer: "Sí, cada salón tiene una landing pública opcional donde los clientes ven horarios disponibles por estilista y reservan en línea." },
      { question: "¿Calcula comisiones por estilista?",                answer: "Sí, al final del día MediFlow desglosa servicios por estilista, calcula la comisión configurada y genera un reporte para liquidación." },
      { question: "¿Funciona si el salón tiene muchos servicios?",   answer: "Sí. Configuras tu catálogo completo (color, corte, peinado, alaciado, tratamientos, mechas) con duración y precio. La agenda calcula slots solos." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Eduardo Soto", role: "Estilista master", clinic: "Salón Loft Polanco", text: "Antes pegaba la fórmula con cinta en el folder de cada clienta. Ahora abro su expediente en el iPad y reproduzco el color en 5 segundos." },
    relatedSlugs: ["cejas-pestanas", "unas", "centros-estetica", "spas"],
    unsplashAmbient: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  "medicina-alternativa": {
    slug: "medicina-alternativa",
    category: "salud",
    color: "green",
    nombre: "Medicina Alternativa",
    seoTitle: "Software para medicina alternativa — Acupuntura, MTC y herbolaria",
    seoDescription: "Software para acupuntura, medicina tradicional china, herbolaria y homeopatía: puntos meridianos, pulso, lengua, fórmulas herbales e interacciones. Prueba gratis.",
    heroTitle: "Software para tu consultorio de medicina alternativa con la sabiduría tradicional digital",
    heroSubtitle: "Puntos de acupuntura por meridiano, evaluación de pulso y lengua, fórmulas herbales con alertas de interacciones — todo en un expediente.",
    heroVariant: "salud",
    iconMainName: "Leaf",
    iconSecondaryNames: ["Flower2", "Heart", "Calendar", "Waves", "Sun", "Sparkles", "Moon", "Compass"],
    designedFor: [
      "MediFlow respeta las modalidades tradicionales: acupuntura, ventosas, gua sha, moxibustión, electroacupuntura, quiropráctica, naturopatía, herbolaria y homeopatía. Cada modalidad tiene sus propios campos y catálogo.",
      "Para acupuntura registras puntos por meridiano (LI4, ST36, SP6, LR3, etc.) con lateralidad (izquierdo, derecho, bilateral) y técnica (tonificación, sedación, neutra) más tiempo de retención. La evaluación TCM incluye pulso (7 tipos), lengua y patrón (exceso/deficiencia, frío/calor, humedad, estancamiento de Qi).",
      "El catálogo de fórmulas herbales incluye un detector de interacciones con medicamentos comunes — Ginkgo con anticoagulantes, hierba de San Juan con SSRIs — para evitar problemas y proteger al paciente.",
    ],
    features: [
      { iconName: "Compass",  title: "Puntos de acupuntura",         description: "Catálogo completo por meridiano (LI4, ST36, SP6, LR3, etc.) con lateralidad, técnica de tonificación o sedación y tiempo de retención." },
      { iconName: "Waves",    title: "Evaluación de pulso",          description: "7 tipos de pulso TCM (superficial, profundo, rápido, lento, resbaladizo, áspero, de cuerda) con observaciones por sesión." },
      { iconName: "Moon",     title: "Observación de lengua",        description: "Color, capa, forma y humedad de la lengua para diagnóstico TCM. Patrón de exceso/deficiencia, frío/calor y estancamiento." },
      { iconName: "Leaf",     title: "Fórmulas herbales",            description: "Catálogo de fórmulas con dosis, vía de administración y duración. Cada fórmula vinculable al expediente del paciente." },
      { iconName: "Heart",    title: "Detector de interacciones",     description: "Alertas automáticas si una hierba tiene interacción con medicamentos comunes (Ginkgo + anticoagulantes, Hierba de San Juan + SSRIs)." },
      { iconName: "Sparkles", title: "5 elementos y constitución",    description: "Tipo constitucional según los 5 elementos (madera, fuego, tierra, metal, agua) y diagnóstico TCM por patrón." },
      { iconName: "Sun",      title: "Modalidades múltiples",         description: "Acupuntura, ventosas, moxibustión, electroacupuntura, gua sha, herbolaria, homeopatía — todo en el mismo expediente." },
      { iconName: "Calendar", title: "Plan de seguimiento",           description: "Registro de evolución sesión tras sesión con cambios en pulso, lengua y patrón. Recordatorios automáticos por WhatsApp." },
    ],
    clinicalFormTitle: "Tu expediente integrativo con sabiduría tradicional",
    clinicalFormDescription: "Incluye modalidades múltiples (acupuntura, ventosas, moxa, electroacupuntura, quiropráctica, naturopatía, herbolaria, homeopatía), puntos por 15 meridianos con lateralidad y técnica, pulso de 7 tipos, observación de lengua, patrón TCM (exceso/deficiencia, frío/calor, humedad, estancamiento de Qi), constitución por 5 elementos y detector de interacciones herbales con medicamentos comunes.",
    useCases: [
      { title: "Sesión de acupuntura para insomnio",  description: "Evalúas pulso y lengua, identificas patrón de deficiencia de Yin, seleccionas puntos HT7, KI3, SP6 con tonificación, ejecutas y agendas seguimiento semanal." },
      { title: "Tratamiento herbal para gastritis",    description: "Capturas síntomas y patrón TCM, prescribes fórmula con dosis y duración, sistema alerta si hay interacción con omeprazol que ya toma el paciente." },
      { title: "Quiropraxia post-lesión",              description: "Documentas evaluación postural, modalidad usada (HVLA, soft tissue), zonas trabajadas y mejoría reportada por el paciente con escala visual." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Daily.co (teleconsulta)"],
    faqs: [
      { question: "¿Soporta múltiples modalidades?",                 answer: "Sí: acupuntura, ventosas, gua sha, moxibustión, electroacupuntura, quiropráctica, naturopatía, herbolaria y homeopatía con catálogo específico para cada una." },
      { question: "¿Tiene diagnóstico TCM completo?",                answer: "Sí, evaluación de pulso (7 tipos), lengua, patrón de exceso/deficiencia, frío/calor, humedad, estancamiento de Qi y tipo constitucional por 5 elementos." },
      { question: "¿Detecta interacciones de hierbas con medicamentos?", answer: "Sí, base de datos con las interacciones más críticas (Ginkgo+anticoagulantes, Hierba de San Juan+SSRIs, etc.) que dispara alerta al prescribir." },
      { question: "¿Puedo registrar puntos de acupuntura por sesión?", answer: "Sí, cada sesión guarda los puntos seleccionados, lateralidad, técnica usada y tiempo de retención para reproducir el protocolo." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Lic. Hiroshi Tanaka", role: "Acupunturista", clinic: "Ki Center Tulum", text: "El detector de interacciones herbales me da paz mental. Cuando un paciente me cuenta qué medicamentos toma, MediFlow me alerta antes de que prescriba algo que no debería." },
    relatedSlugs: ["fisioterapia", "psicologia", "medicina-general", "nutricion"],
    unsplashAmbient: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  unas: {
    slug: "unas",
    category: "belleza",
    color: "fuchsia",
    nombre: "Estudios de Uñas",
    seoTitle: "Software para estudio de uñas — Mapa de salud y servicios",
    seoDescription: "Software para estudios de manicura y nail art en México: mapa de salud por uña, alergias a metacrilatos, fotos antes/después y agenda con WhatsApp. Prueba gratis.",
    heroTitle: "Software para tu estudio de uñas que cuida cada detalle",
    heroSubtitle: "Mapa de salud por uña, registro de alergias a metacrilatos, fotos antes/después y agenda con WhatsApp — todo en una app.",
    heroVariant: "belleza",
    iconMainName: "Palette",
    iconSecondaryNames: ["Sparkles", "Brush", "Calendar", "Star", "Camera", "Package", "Wand2", "Heart"],
    designedFor: [
      "Tu cliente no es un servicio — es una persona con dedos específicos, uñas que crecen distinto y posibles alergias. MediFlow tiene un mapa de salud por uña: cada dedo de cada mano y pie con 8 estados posibles (sana, hongos, estriada, manchada, frágil, onicólisis, encarnada, engrosada). Eso le da contexto a tu trabajo.",
      "Las alergias importan: si una clienta es sensible a metacrilatos, MediFlow lo marca como bandera roja en su expediente y avisa antes de aplicar acrílico. Las reacciones previas (fecha, producto, tipo, severidad) quedan registradas para no repetir.",
      "Soportamos manicura, pedicura, gel, acrílico, dip powder, nail art, reparación y parafina. Cada servicio con duración, precio y catálogo de formas (almendra, cuadrada, ovalada, stiletto, coffin, squoval, redonda).",
    ],
    features: [
      { iconName: "Brush",    title: "Mapa de salud por uña",        description: "Cada dedo de manos y pies con 8 estados (sana, hongos, estriada, manchada, frágil, onicólisis, encarnada, engrosada)." },
      { iconName: "Heart",    title: "Alergias y reacciones",         description: "Bandera de alergia a metacrilatos y registro histórico de reacciones (producto, fecha, tipo, severidad) para evitar repetir." },
      { iconName: "Sparkles", title: "Catálogo de servicios",         description: "Manicura, pedicura, gel, acrílico, dip powder, nail art, reparación y parafina con duración y precio." },
      { iconName: "Wand2",    title: "Catálogo de formas",            description: "Almendra, cuadrada, ovalada, stiletto, coffin, squoval, redonda — guarda la preferencia del cliente para próxima visita." },
      { iconName: "Camera",   title: "Fotos antes/después",           description: "Documenta cada nail art con fotos para que el cliente comparta y para construir tu portafolio en redes sociales." },
      { iconName: "Calendar", title: "Recordatorios automáticos",      description: "Recordatorios por WhatsApp 24h antes de la cita y sugerencia de la siguiente cita según frecuencia habitual del cliente." },
      { iconName: "Package",  title: "Inventario de productos",        description: "Stock de geles, acrílicos, dip powders y herramientas con alerta automática cuando llegas al mínimo configurado." },
      { iconName: "Star",     title: "Preferencias guardadas",         description: "Color recurrente, marcas favoritas, largo preferido y técnico asignado — todo guardado para que la cliente se sienta atendida." },
    ],
    clinicalFormTitle: "Tu expediente de manicura con mapa por uña",
    clinicalFormDescription: "Incluye 8 servicios (manicura, pedicura, gel, acrílico, dip powder, nail art, reparación, parafina), 7 formas de uña, mapa de salud por uña con 8 condiciones, bandera de alergia a metacrilatos, historial de reacciones (fecha, producto, tipo, severidad) y preferencias del cliente (color recurrente, marcas favoritas, largo preferido).",
    useCases: [
      { title: "Cliente nueva de manicura gel",     description: "Capturas mapa de salud, aplicas el servicio, fotografías el resultado, defines color recurrente y agendas el próximo retoque en 2-3 semanas." },
      { title: "Cliente con alergia a metacrilatos",  description: "Bandera de alerta visible al abrir el expediente, eliges productos sin metacrilatos, registras servicio realizado y verificas tolerancia." },
      { title: "Sesión de nail art",                 description: "Capturas el diseño con foto, anotas técnica usada, productos aplicados y compartes con la cliente para que la suba a sus redes." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Instagram"],
    faqs: [
      { question: "¿Tiene mapa de salud por dedo?",               answer: "Sí, cada uña de manos y pies se documenta con su condición (sana, hongos, estriada, manchada, frágil, onicólisis, encarnada, engrosada)." },
      { question: "¿Lleva control de alergias a productos?",       answer: "Sí, marcas alergia a metacrilatos como bandera roja del expediente y registras reacciones previas con fecha, producto y severidad." },
      { question: "¿Sirve para múltiples técnicas?",                answer: "Sí, manicura tradicional, gel, acrílico, dip powder, nail art, reparación y parafina están en el catálogo configurable." },
      { question: "¿Las fotos van a Instagram?",                   answer: "Puedes descargar la foto del expediente y compartirla en tus redes sociales con el catálogo de servicios visible." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Brenda Aguirre", role: "Nail technician", clinic: "Polish Studio Mérida", text: "El mapa de salud por uña me hace ver cosas que antes pasaba por alto. Detecté un caso de hongo en un dedo que la clienta no había notado y la mandé al podólogo a tiempo." },
    relatedSlugs: ["cejas-pestanas", "centros-estetica", "peluquerias", "spas"],
    unsplashAmbient: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
  spas: {
    slug: "spas",
    category: "belleza",
    color: "teal",
    nombre: "Spas",
    seoTitle: "Software para spa — Cuestionario, circuito termal y paquetes",
    seoDescription: "Software para spas y centros de bienestar en México: cuestionario de salud, circuito termal personalizable, escala de estrés y paquetes con redenciones. Prueba gratis.",
    heroTitle: "Software para tu spa que cuida la experiencia desde la primera reserva",
    heroSubtitle: "Cuestionario de salud, circuito termal personalizable, escala de estrés pre/post y paquetes con redenciones — todo en una app pensada para wellness.",
    heroVariant: "belleza",
    iconMainName: "Waves",
    iconSecondaryNames: ["Flower2", "Leaf", "Heart", "Calendar", "Package", "Star", "Sun", "Sparkles"],
    designedFor: [
      "Tu spa no es solo masajes — es una experiencia. MediFlow te ayuda a diseñar circuitos termales secuenciados (sauna, vapor, hidroterapia, flotación) con tiempo y temperatura por estación, reordenables con un click para personalizar cada visita.",
      "El cuestionario de salud captura contraindicaciones (cardiovasculares, claustrofobia, embarazo, hipotensión, alergias cutáneas) antes de la primera visita para no comprometer al cliente. La escala de estrés 1-10 al llegar y al salir te muestra el delta de relajación tangible.",
      "Las preferencias del cliente quedan guardadas: temperatura preferida, presión de masaje, música ambiente, iluminación, aromas favoritos. Cuando vuelve, su próxima experiencia ya está diseñada para él.",
    ],
    features: [
      { iconName: "Heart",    title: "Cuestionario de salud",         description: "Contraindicaciones (cardiovasculares, claustrofobia, embarazo, hipotensión, alergias cutáneas) marcadas antes de la primera visita." },
      { iconName: "Waves",    title: "Circuito termal personalizable", description: "Diseña secuencias de sauna, vapor, hidroterapia, flotación con tiempo y temperatura por estación. Reordenable por cliente." },
      { iconName: "Sun",      title: "Escala de estrés pre/post",     description: "Calificación de estrés 1-10 al llegar y al salir con delta calculado para mostrar la relajación al cliente." },
      { iconName: "Flower2",  title: "Catálogo de servicios",          description: "Hidroterapia, sauna, flotación, envolturas, circuito termal, masaje spa, facial, paquete pareja, ritual completo." },
      { iconName: "Sparkles", title: "Preferencias del cliente",       description: "Temperatura, presión, música, iluminación, aromas favoritos guardados para personalizar visitas futuras." },
      { iconName: "Package",  title: "Paquetes y memberships",         description: "Vende paquetes mensuales, anuales o pases ilimitados con redenciones automáticas y vencimiento configurable." },
      { iconName: "Calendar", title: "Reservas online",                description: "Tu spa con landing pública opcional donde los clientes ven horarios disponibles y reservan ritual o circuito sin llamar." },
      { iconName: "Star",     title: "Sueño y bienestar",              description: "Calificación de calidad de sueño y nivel de energía para entender la evolución del bienestar del cliente." },
    ],
    clinicalFormTitle: "Tu expediente de spa con experiencia personalizada",
    clinicalFormDescription: "Incluye 9 tipos de servicios spa, escala de estrés 1-10 con delta calculado, calidad de sueño en 5 niveles, circuito termal secuenciable con tiempo y temperatura por paso, preferencias del cliente (temperatura, presión, música, aromas) y contraindicaciones críticas (cardiovasculares, claustrofobia, embarazo, hipotensión, alergias cutáneas).",
    useCases: [
      { title: "Cliente nuevo de circuito termal",   description: "Aplicas cuestionario de salud, diseñas circuito personalizado con sauna, vapor y flotación, calificas estrés inicial y comparas al final con foto del cliente sonriendo." },
      { title: "Paquete mensual de bienestar",        description: "Vendes membership con 4 visitas al mes, llevas redenciones automáticas, registras escala de estrés en cada visita y muestras la evolución mensual." },
      { title: "Ritual de pareja para aniversario",    description: "Reservan ritual de 3 horas (envoltura, masaje, hidroterapia), capturas preferencias de ambos, ejecutas y mandas foto recuerdo por WhatsApp después." },
    ],
    integrations: ["WhatsApp Business API", "Google Calendar", "Facturapi (CFDI 4.0)", "Stripe", "Instagram"],
    faqs: [
      { question: "¿Sirve para spa con circuito termal?",            answer: "Sí, puedes diseñar circuitos secuenciables (sauna, vapor, hidroterapia, flotación) con tiempo y temperatura por estación, reordenables por cliente." },
      { question: "¿Lleva membresías y paquetes?",                   answer: "Sí, vendes paquetes mensuales, anuales o pases ilimitados con redenciones automáticas, vencimiento y aviso al cliente cuando le quedan pocas." },
      { question: "¿Tiene reservas online?",                          answer: "Sí, cada spa puede tener una landing pública donde el cliente reserva su ritual o circuito y elige fecha y hora sin llamar." },
      { question: "¿Sirve para spa de hotel?",                        answer: "Sí. Soporta múltiples profesionales, agendas paralelas, paquetes con código promocional y separación entre huéspedes y clientes externos." },
    ],
    // TODO: reemplazar con testimonio real
    testimonial: { author: "Adriana Beltrán", role: "Gerente de spa", clinic: "Aqua Spa Cancún", text: "El cuestionario de salud nos cambió la operación. Antes preguntábamos verbalmente y a veces se olvidaba algo importante. Ahora cada cliente lo llena desde su celular antes de llegar." },
    relatedSlugs: ["masajes", "centros-estetica", "medicina-alternativa", "depilacion-laser"],
    unsplashAmbient: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80&auto=format",
    unsplashCases: null,
  },
};

export function getSpecialty(slug: string): SpecialtyContent | null {
  return SPECIALTIES[slug] ?? null;
}

export const SPECIALTY_LIST: SpecialtyContent[] = SPECIALTY_SLUGS
  .map((s) => SPECIALTIES[s])
  .filter((s): s is SpecialtyContent => Boolean(s));
