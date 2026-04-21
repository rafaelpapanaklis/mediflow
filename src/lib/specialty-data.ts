/**
 * Datos de las 17 páginas de especialidad para la landing pública.
 * Cada entry provee copy, features, mockup key, testimonial, FAQs y acento visual.
 * Español MX.
 */

export type SpecialtyCategory = "Dental" | "Médicas" | "Salud mental" | "Bienestar";

export type FeatureIcon =
  | "tooth" | "braces" | "gum" | "scan" | "skin" | "heart" | "female" | "baby"
  | "eye" | "brain" | "pill" | "apple" | "hand" | "spa" | "needle" | "leaf"
  | "doc" | "bell" | "invoice" | "box" | "camera" | "root" | "stethoscope";

export type MockupKey =
  | "dental" | "ortho" | "endo" | "perio" | "general" | "derma" | "cardio"
  | "gineco" | "peds" | "oftalmo" | "psico" | "psiq" | "nutri" | "fisio"
  | "estetica" | "acupuntura" | "homeopatia";

export interface SpecialtyFeature {
  title:   string;
  desc:    string;
  icon:    FeatureIcon;
}

export interface SpecialtyTestimonial {
  q:      string;
  name:   string;
  role:   string;
  city:   string;
  metric: string;
}

export interface Specialty {
  slug:         string;
  name:         string;
  category:     SpecialtyCategory;
  icon:         FeatureIcon;
  /** Hex para acento visual (gradients, highlights) */
  accent:       string;
  /** Tagline corto (chip) */
  tagline:      string;
  /** Pill sobre el H1 */
  eyebrow:      string;
  heroTitle:    string;
  heroSub:      string;
  /** Strip de métricas debajo del hero: tuple [valor, label] */
  metricsStrip: Array<[string, string]>;
  features:     SpecialtyFeature[];
  mockupKey:    MockupKey;
  testimonial:  SpecialtyTestimonial;
  faqs:         Array<[string, string]>;
}

function feature(title: string, desc: string, icon: FeatureIcon): SpecialtyFeature {
  return { title, desc, icon };
}

export const SPECIALTIES: Record<string, Specialty> = {
  "odontologia-general": {
    slug:      "odontologia-general",
    name:      "Odontología general",
    category:  "Dental",
    icon:      "tooth",
    accent:    "#a78bfa",
    tagline:   "Odontograma interactivo",
    eyebrow:   "Para dentistas generales",
    heroTitle: "El software dental que tus pacientes van a notar.",
    heroSub:   "Odontograma digital, radiografías con análisis por IA, presupuestos que se aceptan por WhatsApp y CFDI mexicano. Todo en una sola pantalla.",
    metricsStrip: [
      ["−73%", "Faltas a citas"],
      ["4.3 h", "Ahorradas por semana"],
      ["+28%", "Aceptación de tratamientos"],
      ["100%", "CFDI timbrado"],
    ],
    features: [
      feature("Odontograma digital", "Registra caries, restauraciones, ausencias y tratamientos directo sobre 32 piezas. Historial completo por pieza.", "tooth"),
      feature("Radiografías con IA", "Sube la radiografía, la IA marca hallazgos sugeridos en segundos. Segunda opinión instantánea.", "scan"),
      feature("Presupuestos que se firman", "Genera el plan de tratamiento, el paciente lo acepta desde WhatsApp con un click.", "doc"),
      feature("Recordatorios automáticos", "24 h y 2 h antes, por WhatsApp. Baja la tasa de faltas sin que levantes el teléfono.", "bell"),
      feature("CFDI 4.0 automático", "Cobras y se timbra. Se envía al correo del paciente. Cumples con el SAT sin intermediarios.", "invoice"),
      feature("Inventario dental", "Resinas, anestésicos, brackets. Alertas de stock bajo y reposición automática.", "box"),
    ],
    mockupKey: "dental",
    testimonial: {
      q:      "Dejamos Excel y WhatsApp manual. En 3 meses bajamos las faltas a citas de 22% a 6%. El odontograma interactivo es lo que más usamos — mis pacientes entienden su boca por primera vez.",
      name:   "Dra. Mariana Ochoa",
      role:   "Directora · Clínica Dental Polanco",
      city:   "CDMX",
      metric: "−73% faltas",
    },
    faqs: [
      ["¿Puedo importar desde Dentrix o SmileSoft?", "Sí. Hacemos la migración completa de pacientes, historia clínica y radiografías en 48 horas. Sin costo en plan PRO y CLINIC."],
      ["¿La IA reemplaza mi diagnóstico?", "No. La IA es una segunda opinión: marca hallazgos sugeridos en radiografías para acelerar tu revisión. El diagnóstico final siempre es tuyo."],
      ["¿Sirve para consultorios de un solo dentista?", "Sí. El plan BASIC está pensado para un profesional. Cuando creces, subes a PRO o CLINIC sin migrar datos."],
      ["¿Funciona sin internet?", "Requiere conexión para sincronizar, pero el expediente se cachea local. Si se cae la red 30 min sigues atendiendo, al volver se sincroniza."],
    ],
  },

  "ortodoncia": {
    slug: "ortodoncia", name: "Ortodoncia", category: "Dental", icon: "braces", accent: "#a78bfa",
    tagline: "Seguimiento fotográfico", eyebrow: "Para ortodoncistas",
    heroTitle: "Documenta cada ajuste. Visualiza cada avance.",
    heroSub:   "Timeline fotográfico del tratamiento, control de brackets y alineadores, recordatorios de citas mensuales. Tus pacientes ven su progreso, tú ves tu negocio.",
    metricsStrip: [["18 mo", "Tratamiento promedio"], ["+34%", "Retención paciente"], ["100%", "Casos documentados"], ["< 2 h", "Carga admin/sem"]],
    features: [
      feature("Timeline fotográfico", "Fotos intraorales y extraorales organizadas por fecha. El paciente ve su transformación mes a mes.", "camera"),
      feature("Control de brackets y alineadores", "Registra tipo, marca, lote. Próximos ajustes agendados automáticamente.", "braces"),
      feature("Cefalometrías digitales", "Sube la radiografía lateral y traza directo. Análisis Steiner, Ricketts, McNamara.", "scan"),
      feature("Planes a largo plazo", "Presupuestos con pagos mensuales programados. Cobranza automática.", "doc"),
      feature("Recordatorios mensuales", "Tu paciente no olvida su ajuste. WhatsApp 48 h y 2 h antes.", "bell"),
      feature("CFDI 4.0 por mensualidad", "Cada pago genera factura automática. Cero carga administrativa.", "invoice"),
    ],
    mockupKey: "ortho",
    testimonial: { q: "Los pacientes de ortodoncia me abandonaban en el mes 10 por falta de motivación. Con el timeline fotográfico ven el cambio y se quedan hasta el final. Subí retención 34%.", name: "Dr. Alejandro Kuri", role: "Ortodoncista · Smile Studio", city: "Guadalajara", metric: "+34% retención" },
    faqs: [
      ["¿Maneja alineadores como Invisalign?", "Sí. Registras lote, número de charola y fecha de cambio. El paciente recibe recordatorio del cambio."],
      ["¿Las fotos se almacenan de forma segura?", "Encriptadas en reposo y en tránsito. Cumplimos con la NOM-024 y LFPDPPP."],
      ["¿Puedo hacer cefalometría desde la tablet?", "Sí, desde cualquier navegador moderno. Tablet, laptop, iPad."],
      ["¿Funciona para consultorio pequeño?", "BASIC cubre un ortodoncista con hasta 500 pacientes activos."],
    ],
  },

  "endodoncia": {
    slug: "endodoncia", name: "Endodoncia", category: "Dental", icon: "root", accent: "#a78bfa",
    tagline: "Radiografías · IA caries", eyebrow: "Para endodoncistas",
    heroTitle: "Diagnósticos más rápidos. Tratamientos más seguros.",
    heroSub:   "Análisis automático de radiografías periapicales con IA de última generación. Marcado de conductos, lesiones periapicales sugeridas y comparativa antes/después.",
    metricsStrip: [["9 s", "Análisis por radiografía"], ["93%", "Precisión lesiones"], ["+40%", "Casos por semana"], ["4.9★", "Satisfacción paciente"]],
    features: [
      feature("IA para radiografías periapicales", "La IA marca conductos visibles, lesiones periapicales y estructuras relevantes. Revisas en 9 segundos lo que antes tomaba minutos.", "scan"),
      feature("Comparativa antes / después", "Superponé la periapical inicial sobre la de control. Evidencia visual indiscutible para el paciente.", "camera"),
      feature("Expediente endodóntico", "Piezas tratadas, número de conductos, longitud de trabajo, técnica usada. Todo en historial por pieza.", "tooth"),
      feature("Seguimiento post-tratamiento", "Citas de control automáticas a 3, 6 y 12 meses. Tu paciente no se olvida.", "bell"),
      feature("Referencias de otros dentistas", "Portal para que dentistas de cabecera te refieran pacientes. Reporte de caso automático al finalizar.", "doc"),
      feature("CFDI + cobros por terminal", "Cobras con la terminal y se timbra. Incluye división por paciente y aseguradora.", "invoice"),
    ],
    mockupKey: "endo",
    testimonial: { q: "La IA para radiografías es impresionante. No reemplaza mi ojo clínico, pero es una segunda opinión instantánea que mis pacientes valoran mucho. Hago 40% más casos por semana.", name: "Dr. Santiago Herrera", role: "Endodoncista · Centro Endodóntico MTY", city: "Monterrey", metric: "+40% casos" },
    faqs: [
      ["¿Qué precisión tiene la IA?", "93% en detección de lesiones periapicales según nuestras pruebas internas con 12,000 radiografías verificadas por especialistas."],
      ["¿Necesito radiógrafo digital específico?", "Funciona con cualquier radiógrafo que exporte DICOM, JPG o PNG. También apps de smartphone."],
      ["¿Se integra con mi dentista referente?", "Sí. Portal de referencias con reporte automático al finalizar el caso."],
      ["¿La IA está disponible en BASIC?", "PRO incluye 50 análisis/mes. CLINIC incluye análisis ilimitados."],
    ],
  },

  "periodoncia": {
    slug: "periodoncia", name: "Periodoncia", category: "Dental", icon: "gum", accent: "#a78bfa",
    tagline: "Periodontograma digital", eyebrow: "Para periodoncistas",
    heroTitle: "Periodontograma que tus pacientes entienden.",
    heroSub:   "Sondeo completo de 6 puntos por pieza. Índice de placa visual, sangrado, movilidad. Comparativa de visitas en una sola pantalla.",
    metricsStrip: [["6 min", "Periodontograma completo"], ["−52%", "Abandono en mantenimiento"], ["32", "Piezas mapeadas"], ["3", "Tipos de sondaje"]],
    features: [
      feature("Periodontograma visual", "Sondeo de 6 puntos por pieza, sangrado al sondaje, placa y movilidad. Todo en una vista clara.", "gum"),
      feature("Comparativa entre visitas", "Tus pacientes ven cómo bajaron sus bolsas periodontales. Retención de mantenimiento por las nubes.", "camera"),
      feature("Plan de mantenimiento automático", "Citas de 3, 4 o 6 meses según el riesgo. Recordatorios WhatsApp.", "bell"),
      feature("Protocolos por severidad", "Plantillas para gingivitis, periodontitis leve/moderada/severa. Personalizables.", "doc"),
      feature("Radiografías integradas", "Aleta mordida, panorámica, periapicales asociadas a cada sondaje.", "scan"),
      feature("Reporte para el paciente", "PDF visual con su periodontograma y plan. Se lo envías por WhatsApp.", "invoice"),
    ],
    mockupKey: "perio",
    testimonial: { q: "Mis pacientes de mantenimiento periodontal tenían 40% de deserción. Con la comparativa visual de sus bolsas periodontales, vuelven. Ya solo el 19% abandona, y es por mudanza.", name: "Dra. Ivonne Cárdenas", role: "Periodoncista · Periocenter", city: "Puebla", metric: "−52% abandono" },
    faqs: [
      ["¿Permite sondeo con voz?", "Sí, dictado por voz integrado. Tu asistente o tú dictas los valores y se registran solos."],
      ["¿Genera reporte visual al paciente?", "PDF con el periodontograma a color, comparativa con visita anterior y plan recomendado."],
      ["¿Se integra con higienistas?", "Los higienistas tienen su propio rol con permisos limitados. El periodoncista aprueba."],
      ["¿Hay plantillas por tipo de caso?", "Sí, plantillas editables para gingivitis, periodontitis I-IV según nueva clasificación AAP."],
    ],
  },

  "medicina-general": {
    slug: "medicina-general", name: "Medicina general", category: "Médicas", icon: "stethoscope", accent: "#34d399",
    tagline: "Receta electrónica", eyebrow: "Para médicos generales",
    heroTitle: "Tu consultorio, sin papeles, sin vueltas.",
    heroSub:   "Expediente electrónico NOM-024, receta digital con firma, signos vitales, laboratorios integrados. Todo en 30 segundos por consulta.",
    metricsStrip: [["NOM-024", "Cumplimiento total"], ["30 s", "Por nota SOAP"], ["4.3 h", "Ahorradas/semana"], ["0", "Papeles en tu escritorio"]],
    features: [
      feature("Expediente NOM-024", "Cumple con la Norma Oficial Mexicana para expedientes clínicos. Audit trail completo.", "doc"),
      feature("Receta electrónica", "Con firma digital, catálogo de medicamentos SSA y validación de dosis. Se envía por WhatsApp.", "pill"),
      feature("Signos vitales integrados", "Presión, frecuencia, saturación, temperatura. Gráficas de evolución por paciente.", "heart"),
      feature("Laboratorios y estudios", "Solicitud digital a laboratorios locales. Los resultados llegan directo al expediente.", "scan"),
      feature("CIE-10 con búsqueda inteligente", "Codificación automática con sugerencias. Reportes epidemiológicos listos.", "box"),
      feature("Teleconsulta integrada", "Video llamada nativa con expediente abierto en paralelo. Sin Zoom, sin fricciones.", "camera"),
    ],
    mockupKey: "general",
    testimonial: { q: "Lo que me convenció fue el CFDI nativo y la NOM-024. Antes usaba un sistema europeo que no timbraba; teníamos que facturar aparte. Ahora todo en un click, y ahorro 4 horas semanales.", name: "Dr. Ernesto Villalobos", role: "Médico general · Consultorio Villalobos", city: "Monterrey", metric: "4 h/semana" },
    faqs: [
      ["¿Es válida la receta electrónica en México?", "Sí. Firma digital certificada, código QR verificable, cumple con la NOM-024-SSA3-2012."],
      ["¿Funciona para consultorio de seguros?", "Sí. Integración con las principales aseguradoras mexicanas para CPT y tarifas."],
      ["¿Se integra con laboratorios?", "Tenemos integración directa con Chopo, Salud Digna y Olab. Otros por API o PDF."],
      ["¿Incluye teleconsulta?", "Sí, en PRO y CLINIC. Sin límite de sesiones, con expediente abierto durante la llamada."],
    ],
  },

  "dermatologia": {
    slug: "dermatologia", name: "Dermatología", category: "Médicas", icon: "skin", accent: "#34d399",
    tagline: "Galería de lesiones", eyebrow: "Para dermatólogos",
    heroTitle: "La piel se documenta mejor con imágenes.",
    heroSub:   "Galería visual por región corporal, mapa dermatológico interactivo, seguimiento fotográfico de lesiones y tratamientos estéticos.",
    metricsStrip: [["12 MP", "Fotos alta resolución"], ["+38%", "Conversión a tratamiento"], ["1", "Click al historial visual"], ["∞", "Fotos por paciente"]],
    features: [
      feature("Mapa dermatológico interactivo", "Click en la región del cuerpo, asocia la lesión con foto, diagnóstico, tratamiento.", "skin"),
      feature("Timeline antes/después", "Documenta cada tratamiento: toxina, rellenos, peels, láser. El paciente ve su cambio.", "camera"),
      feature("Dermatoscopía adjunta", "Sube fotos de dermatoscopio, compara con visitas previas para monitorear lesiones.", "scan"),
      feature("Protocolos estéticos", "Plantillas para limpieza facial, peeling, láser, radiofrecuencia. Con recordatorios.", "doc"),
      feature("CFDI para estética", "Timbrado automático incluso para pagos parciales y paquetes de sesiones.", "invoice"),
      feature("Recordatorios de control", "Revisión de nevos cada 6 meses, seguimiento de tratamientos. Automatizado.", "bell"),
    ],
    mockupKey: "derma",
    testimonial: { q: "En dermatología estética, mostrar el antes-después es la venta. Antes tenía las fotos regadas en Dropbox. Ahora en 2 clicks le enseño al paciente su transformación en tiempo real.", name: "Dra. Regina Mora", role: "Dermatóloga · Skin Lab", city: "CDMX", metric: "+38% conversión" },
    faqs: [
      ["¿Soporta dermatoscopía digital?", "Sí. Sube fotos de cualquier dermatoscopio. Compara automáticamente con visitas previas."],
      ["¿Las fotos se cifran?", "AES-256 en reposo, TLS 1.3 en tránsito. Servidores en México."],
      ["¿Incluye consentimientos informados?", "Plantillas editables para cada procedimiento estético. Firma digital desde el celular del paciente."],
      ["¿Maneja paquetes de sesiones?", "Sí. Vendes un paquete de 6 sesiones y se van descontando con cada cita. CFDI por sesión o global."],
    ],
  },

  "cardiologia": {
    slug: "cardiologia", name: "Cardiología", category: "Médicas", icon: "heart", accent: "#34d399",
    tagline: "EKG y signos vitales", eyebrow: "Para cardiólogos",
    heroTitle: "Cada signo, cada trazo, en contexto.",
    heroSub:   "Lectura de EKG, ecocardiogramas, Holter, MAPA. Gráficas de evolución, escalas de riesgo y alertas de valores críticos.",
    metricsStrip: [["12 der", "Lectura EKG"], ["Alerta", "Valores críticos"], ["CHADS", "Escalas integradas"], ["∞", "Histórico por paciente"]],
    features: [
      feature("Visor de EKG", "Sube trazos de 12 derivaciones, marca eventos, registra interpretación. Comparativa con EKG previos.", "scan"),
      feature("Gráficas de signos vitales", "Presión, frecuencia, saturación, peso. Tendencias a 6 meses, 1 año, 5 años.", "heart"),
      feature("Escalas de riesgo", "CHADS2-VASc, HAS-BLED, Framingham, TIMI. Calculadas automáticas según expediente.", "doc"),
      feature("Alertas de valores críticos", "Presión sistólica > 180, FC < 40, saturación < 90%. Notificación instantánea.", "bell"),
      feature("Recetas cardiológicas", "Catálogo con interacciones, ajuste por función renal, dosis pediátricas.", "pill"),
      feature("Informes para referencia", "PDF profesional para médicos referentes y aseguradoras.", "invoice"),
    ],
    mockupKey: "cardio",
    testimonial: { q: "La vista consolidada de EKGs del mismo paciente me permite detectar cambios sutiles que antes tardaba en notar. Las alertas de presión crítica son un salvavidas literal.", name: "Dr. Fernando Castillo", role: "Cardiólogo · Hospital Ángeles", city: "CDMX", metric: "12 der integradas" },
    faqs: [
      ["¿Soporta Holter y MAPA?", "Sí, adjunta PDF del reporte con metadatos. En roadmap: parsing automático de trazos."],
      ["¿Calcula escalas de riesgo?", "CHADS2-VASc, HAS-BLED, Framingham, TIMI, GRACE. Automático desde expediente."],
      ["¿Alertas a mi celular?", "Push al celular del médico cuando un paciente registra valores críticos en el portal."],
      ["¿Integra con Apple Health / wearables?", "En roadmap Q3 2026. Por ahora, el paciente puede adjuntar reportes PDF desde su portal."],
    ],
  },

  "ginecologia": {
    slug: "ginecologia", name: "Ginecología", category: "Médicas", icon: "female", accent: "#34d399",
    tagline: "Control prenatal", eyebrow: "Para ginecólogos y obstetras",
    heroTitle: "Del ciclo menstrual al parto, acompañada en cada paso.",
    heroSub:   "Control prenatal completo con curvas de crecimiento fetal, calendario de vacunación, ultrasonidos adjuntos, Papanicolaou y citologías.",
    metricsStrip: [["40 sem", "Control prenatal"], ["9", "Consultas esquema"], ["USG", "Galería por trimestre"], ["±100%", "Cumplimiento vacunas"]],
    features: [
      feature("Control prenatal", "Semana gestacional automática, peso, presión, FCF, altura uterina. Alertas por desviación.", "female"),
      feature("Ultrasonidos por trimestre", "Adjunta imágenes de USG. Galería organizada por semana gestacional.", "camera"),
      feature("Calendario de vacunación", "Esquema materno y del bebé. Recordatorios WhatsApp.", "bell"),
      feature("Papanicolaou y citologías", "Seguimiento de tamizaje cervical según NOM. Alertas de control anual.", "doc"),
      feature("Fichas de pareja", "Vincula expediente de la paciente con el de la pareja si aplica.", "heart"),
      feature("Privacidad reforzada", "Información sensible con cifrado adicional y control de acceso por rol.", "invoice"),
    ],
    mockupKey: "gineco",
    testimonial: { q: "El control prenatal visual es la mejor herramienta pedagógica que he tenido. Mis pacientes entienden su embarazo, siguen indicaciones al pie de la letra, y sus bebés nacen sanos.", name: "Dra. Lucía Fernández", role: "Ginecóloga-obstetra · Consultorio Ángeles", city: "Guadalajara", metric: "100% adherencia" },
    faqs: [
      ["¿Calcula edad gestacional?", "Sí. Por FUM o por USG. Alertas automáticas de controles según semana."],
      ["¿Maneja historia clínica perinatal CLAP?", "Sí, plantilla completa compatible con formato CLAP/SMR de la OPS."],
      ["¿Recordatorios al bebé también?", "Sí. Al nacer, se crea expediente del bebé vinculado con esquema de vacunación completo."],
      ["¿Compatible con aseguradoras de maternidad?", "Sí. Reportes en formato que aceptan GNP, AXA, MetLife y Mapfre."],
    ],
  },

  "pediatria": {
    slug: "pediatria", name: "Pediatría", category: "Médicas", icon: "baby", accent: "#34d399",
    tagline: "Curvas de crecimiento", eyebrow: "Para pediatras",
    heroTitle: "Tu paciente crece. Tu sistema también.",
    heroSub:   "Curvas de crecimiento OMS y CDC, calendario de vacunación, hitos del desarrollo, portal para papás.",
    metricsStrip: [["OMS", "Curvas estándar"], ["18", "Vacunas esquema"], ["0-18 a", "Rango completo"], ["2 apps", "Reemplaza 2 herramientas"]],
    features: [
      feature("Curvas de crecimiento", "Peso, talla, perímetro cefálico. Curvas OMS y CDC por edad y sexo. Automático.", "baby"),
      feature("Calendario vacunal", "Esquema nacional + vacunas adicionales. Alertas a los papás por WhatsApp.", "bell"),
      feature("Hitos del desarrollo", "Checklist por edad: sonrisa social, gateo, primeros pasos, frases. Con fecha registrada.", "doc"),
      feature("Recetas ajustadas por peso", "Dosis calculadas automáticamente por kg. Error-proof.", "pill"),
      feature("Portal para papás", "Los papás ven el historial, vacunas pendientes, hitos alcanzados. Suben fotos.", "heart"),
      feature("Teleconsulta pediátrica", "Videoconsulta para seguimientos rápidos. Los papás no se desplazan por fiebre leve.", "camera"),
    ],
    mockupKey: "peds",
    testimonial: { q: "La curva de crecimiento que le muestro al papá en la consulta cambió mi práctica. Entienden por qué subir o bajar a un percentil es relevante, y cumplen con el plan nutricional.", name: "Dr. Juan Pablo Arias", role: "Pediatra · Clínica Ibero", city: "CDMX", metric: "100% plan cumplido" },
    faqs: [
      ["¿Qué curvas de crecimiento usa?", "OMS para 0-5 años, CDC para 5-18. Seleccionable por paciente."],
      ["¿Maneja esquema nacional + CVN?", "Sí. Incluye Cartilla Nacional de Vacunación y vacunas adicionales (rotavirus, VPH, etc.)."],
      ["¿Los papás ven el expediente completo?", "Controlado por rol. Ven vacunas, citas, hitos. No ven notas privadas del médico."],
      ["¿Incluye escalas del desarrollo?", "Denver II y EDI (Evaluación del Desarrollo Infantil) integradas."],
    ],
  },

  "oftalmologia": {
    slug: "oftalmologia", name: "Oftalmología", category: "Médicas", icon: "eye", accent: "#34d399",
    tagline: "Agudeza visual", eyebrow: "Para oftalmólogos",
    heroTitle: "De 20/20 a la cirugía, todo en un expediente.",
    heroSub:   "Refracción, agudeza visual, presión intraocular, fondo de ojo. Graduaciones de anteojos, tarjetas de receta óptica automáticas.",
    metricsStrip: [["20/X", "Snellen digital"], ["LogMAR", "Escala alterna"], ["PIO", "Tracking histórico"], ["Rx", "Automática"]],
    features: [
      feature("Refracción y agudeza visual", "Snellen y LogMAR, OD/OI, con y sin corrección. Histórico completo.", "eye"),
      feature("Presión intraocular", "Gráfica de evolución de PIO. Alertas en sospecha de glaucoma.", "heart"),
      feature("Fondo de ojo", "Galería de retinografías OD/OI. Comparativa entre visitas.", "camera"),
      feature("Receta óptica", "Genera tarjeta de receta de anteojos automáticamente. Esfera, cilindro, eje, adición.", "doc"),
      feature("Campimetría y OCT", "Adjunta reportes de equipo. Integración con Humphrey y Zeiss en roadmap.", "scan"),
      feature("Pre-op de cirugía", "Checklist completo para cataratas, LASIK, estrabismo. Alertas de faltantes.", "bell"),
    ],
    mockupKey: "oftalmo",
    testimonial: { q: "La receta óptica automática me ahorra 2 minutos por paciente. Multiplicado por 30 consultas diarias, es una hora de mi día que dedico a cirugías.", name: "Dr. Rubén Galindo", role: "Oftalmólogo · Centro Óptico GDL", city: "Guadalajara", metric: "1 h/día liberada" },
    faqs: [
      ["¿Se conecta con mi OCT?", "Humphrey y Zeiss en roadmap Q2 2026. Por ahora, PDF adjunto."],
      ["¿Maneja cirugía oftalmológica?", "Pre-op, nota operatoria y post-op integrados. Con checklist por tipo de cirugía."],
      ["¿La receta óptica es imprimible?", "Tarjeta profesional con tu logo. PDF o envío por WhatsApp directo al paciente."],
      ["¿Tiene optotipos digitales?", "No incluidos por ahora. Compatible con los que ya uses en consulta."],
    ],
  },

  "psicologia": {
    slug: "psicologia", name: "Psicología", category: "Salud mental", icon: "brain", accent: "#38bdf8",
    tagline: "Notas SOAP + escalas", eyebrow: "Para psicólogos clínicos",
    heroTitle: "Notas clínicas profundas. Pacientes protegidos.",
    heroSub:   "Notas SOAP y DAP, escalas psicométricas (Beck, Hamilton, PHQ-9, GAD-7), teleterapia cifrada, facturación CFDI.",
    metricsStrip: [["SOAP / DAP", "Plantillas listas"], ["15+", "Escalas integradas"], ["E2E", "Cifrado teleterapia"], ["NOM-035", "Compatible"]],
    features: [
      feature("Notas SOAP / DAP", "Plantillas estructuradas. Dicta por voz, autocompletado inteligente.", "doc"),
      feature("Escalas psicométricas", "Beck, Hamilton, PHQ-9, GAD-7, MOCA, WAIS. Puntajes automáticos, gráficas de evolución.", "brain"),
      feature("Teleterapia cifrada", "Videollamada end-to-end encrypted. HIPAA-aligned. Grabación opcional con consentimiento.", "camera"),
      feature("Plan de tratamiento", "Objetivos terapéuticos, técnicas, tareas asignadas. Check de progreso sesión a sesión.", "box"),
      feature("Notificaciones al paciente", "Tareas entre sesiones, escalas de autoregistro, diarios emocionales.", "bell"),
      feature("Facturación CFDI", "Paquetes de sesiones, descuentos, pagos parciales. CFDI timbrado.", "invoice"),
    ],
    mockupKey: "psico",
    testimonial: { q: "Las escalas psicométricas digitales me cambiaron la práctica. El paciente contesta el PHQ-9 desde el celular antes de sesión, llego a la consulta con gráfica de evolución lista.", name: "Psic. Daniela Treviño", role: "Psicóloga clínica · Consultorio propio", city: "Mérida", metric: "15 escalas activas" },
    faqs: [
      ["¿Es HIPAA-compliant?", "HIPAA-aligned y cumple LFPDPPP mexicana. Cifrado AES-256, servidores en México."],
      ["¿Grabo las sesiones?", "Opcional, con consentimiento firmado del paciente. Almacenamiento cifrado."],
      ["¿Maneja pruebas proyectivas?", "Sí, adjuntas imágenes o reportes. Interpretación sigue siendo tuya."],
      ["¿Integra con plataformas como Doxy.me?", "Teleterapia nativa integrada, no necesitas plataforma externa."],
    ],
  },

  "psiquiatria": {
    slug: "psiquiatria", name: "Psiquiatría", category: "Salud mental", icon: "pill", accent: "#38bdf8",
    tagline: "Recetario controlado", eyebrow: "Para psiquiatras",
    heroTitle: "Recetas controladas. Seguimiento riguroso.",
    heroSub:   "Recetario con numeración COFEPRIS, control de Grupo II y III, interacciones medicamentosas, seguimiento de adherencia.",
    metricsStrip: [["G-II/III", "Recetario COFEPRIS"], ["Alerta", "Interacciones"], ["DSM-5", "Diagnóstico"], ["CIE-11", "Listo"]],
    features: [
      feature("Recetario controlado", "Numeración COFEPRIS para Grupo II y III. Reporte automático mensual.", "pill"),
      feature("Interacciones medicamentosas", "Alerta al prescribir combinaciones de riesgo. Base de datos actualizada.", "bell"),
      feature("Escalas diagnósticas", "DSM-5 y CIE-11. PHQ-9, GAD-7, Y-BOCS, YMRS, HAM-D, PANSS.", "brain"),
      feature("Seguimiento de adherencia", "El paciente registra tomas desde el portal. Gráfica de cumplimiento.", "heart"),
      feature("Teleconsulta con expediente", "Videollamada cifrada con expediente y recetario abierto en paralelo.", "camera"),
      feature("Reporte COFEPRIS", "Informe mensual de recetas Grupo II y III listo para enviar.", "doc"),
    ],
    mockupKey: "psiq",
    testimonial: { q: "El recetario con numeración COFEPRIS automática y el reporte mensual automático me liberan de la carga administrativa. Puedo enfocarme en mis pacientes, no en papeleo regulatorio.", name: "Dr. Roberto Aguilar", role: "Psiquiatra · Clínica Renacer", city: "Tijuana", metric: "0 h papeleo COFEPRIS" },
    faqs: [
      ["¿Maneja recetas de Grupo II y III?", "Sí. Numeración oficial, formato COFEPRIS, reporte mensual automático."],
      ["¿Alerta interacciones medicamentosas?", "Base de datos Lexicomp-equivalent actualizada mensualmente."],
      ["¿Tiene escalas diagnósticas?", "PHQ-9, GAD-7, Y-BOCS, YMRS, HAM-D, PANSS y más. Con tracking longitudinal."],
      ["¿Compatible con DSM-5 y CIE-11?", "Ambos, seleccionable por paciente."],
    ],
  },

  "nutricion": {
    slug: "nutricion", name: "Nutrición", category: "Bienestar", icon: "apple", accent: "#fbbf24",
    tagline: "Planes alimenticios", eyebrow: "Para nutriólogos",
    heroTitle: "Planes nutricionales que tus pacientes siguen.",
    heroSub:   "Base de 12,000 alimentos mexicanos, equivalencias SMAE, planes por requerimiento calórico, seguimiento antropométrico completo.",
    metricsStrip: [["12K", "Alimentos MX"], ["SMAE", "Equivalencias"], ["±84%", "Adherencia al plan"], ["8", "Medidas antropo"]],
    features: [
      feature("Planes alimenticios", "Genera menús por calorías y macros. Equivalencias SMAE editables, 12,000 alimentos mexicanos.", "apple"),
      feature("Antropometría", "Peso, talla, IMC, pliegues, bioimpedancia, composición corporal. Gráficas de evolución.", "heart"),
      feature("Cálculo de requerimientos", "Fórmula de Harris-Benedict, Mifflin-St Jeor, Katch-McArdle. Factor de actividad.", "scan"),
      feature("Recordatorios de comidas", "Tu paciente recibe recordatorios por WhatsApp, registra su comida con foto.", "bell"),
      feature("Recetas y listas de súper", "Cada plan genera recetario y lista de compras semanal.", "doc"),
      feature("Paquetes de sesiones", "Vende 8 sesiones, se van descontando. CFDI por pago o al completar paquete.", "invoice"),
    ],
    mockupKey: "nutri",
    testimonial: { q: "Entregar un plan nutricional tomaba 45 minutos post-consulta. Ahora lo genero en vivo durante la sesión, el paciente se lo lleva al celular, y la adherencia subió de 50% a 84%.", name: "Nut. Paulina Robles", role: "Nutrióloga · Vida Nutrio", city: "Querétaro", metric: "+34% adherencia" },
    faqs: [
      ["¿Tiene alimentos mexicanos reales?", "12,000 alimentos mexicanos, incluyendo marcas locales (Bimbo, La Costeña, etc.) con códigos SMAE."],
      ["¿Maneja bariatría?", "Protocolos pre y post cirugía bariátrica con seguimiento específico."],
      ["¿Integra con básculas bluetooth?", "Sí, con Tanita, Omron e InBody. Los datos se pueblan solos."],
      ["¿Genera menús automáticos?", "Sí. Tú defines requerimientos y restricciones, la app sugiere menús editables."],
    ],
  },

  "fisioterapia": {
    slug: "fisioterapia", name: "Fisioterapia", category: "Bienestar", icon: "hand", accent: "#fbbf24",
    tagline: "Evaluación postural", eyebrow: "Para fisioterapeutas",
    heroTitle: "Del diagnóstico postural a la alta terapéutica.",
    heroSub:   "Evaluación postural foto-asistida, rangos articulares, escalas de dolor, planes de ejercicios con videos.",
    metricsStrip: [["EVA/NRS", "Escalas dolor"], ["ROM", "Rangos articulares"], ["250+", "Ejercicios en bib."], ["Video", "Ejercicios al pac."]],
    features: [
      feature("Evaluación postural", "Sube fotos frontal, lateral, posterior. Marcas automáticas de líneas de referencia.", "hand"),
      feature("Rangos articulares", "ROM por articulación, con goniómetro digital. Comparativa entre sesiones.", "scan"),
      feature("Planes de ejercicio", "Biblioteca de 250+ ejercicios con video. Asigna al paciente, ven desde el celular.", "doc"),
      feature("Escalas de dolor", "EVA, NRS, Oswestry, DASH, WOMAC. Tracking longitudinal con gráficas.", "heart"),
      feature("Alta terapéutica", "Plantilla de alta con comparativa inicio vs. final. PDF profesional.", "invoice"),
      feature("Teleterapia supervisada", "Videollamada con paciente haciendo ejercicio, corriges en vivo.", "camera"),
    ],
    mockupKey: "fisio",
    testimonial: { q: "La biblioteca de ejercicios con video ahorra explicaciones en sesión. Mis pacientes los hacen en casa correctamente, vuelven con dolor bajado real, y el tratamiento dura 30% menos.", name: "Fis. Mauricio Esparza", role: "Fisioterapeuta · FisioMTY", city: "Monterrey", metric: "−30% tiempo tratamiento" },
    faqs: [
      ["¿Biblioteca de ejercicios incluida?", "250+ ejercicios en video profesional. Puedes subir los tuyos propios."],
      ["¿Escalas internacionales?", "EVA, NRS, Oswestry, DASH, WOMAC, SF-36. Todas con tracking longitudinal."],
      ["¿Evaluación postural automática?", "Foto-asistida. Tú marcas referencias, la app calcula ángulos y desviaciones."],
      ["¿Integra con equipos de electroterapia?", "Registro manual por ahora. Integración con Chattanooga en roadmap."],
    ],
  },

  "medicina-estetica": {
    slug: "medicina-estetica", name: "Medicina estética", category: "Bienestar", icon: "spa", accent: "#fbbf24",
    tagline: "Galería antes/después", eyebrow: "Para médicos estéticos",
    heroTitle: "El antes y después es tu mejor vendedor.",
    heroSub:   "Galería comparativa con marcas de inyección, tracking de productos (toxina, rellenos, hilos), consentimientos digitales, paquetes de sesiones.",
    metricsStrip: [["A/B", "Comparativa visual"], ["Lote", "Trazabilidad full"], ["+52%", "Retención paciente"], ["Firma", "Consentimientos"]],
    features: [
      feature("Galería antes/después", "Fotos lado a lado con mismas condiciones de luz. El paciente ve su cambio en 2 clicks.", "camera"),
      feature("Mapa de inyecciones", "Marca sobre el rostro dónde, cuánta toxina, qué marca. Historial por punto anatómico.", "skin"),
      feature("Control de productos", "Lote, caducidad, marca de rellenos, toxina, hilos, vitaminas. Trazabilidad completa.", "box"),
      feature("Consentimientos digitales", "Firma en el iPad del consultorio o el celular del paciente. Archivado automático.", "doc"),
      feature("Paquetes de sesiones", "Vendes 6 sesiones de láser, se van descontando. CFDI flexible.", "invoice"),
      feature("Recordatorios de toxina", "A los 4 meses, recordatorio automático para la siguiente aplicación.", "bell"),
    ],
    mockupKey: "estetica",
    testimonial: { q: "El mapa de inyecciones es oro. Registrar exactamente dónde apliqué toxina me permite replicar el resultado sesión tras sesión, y si el paciente regresa en 5 meses, sé qué hacer.", name: "Dra. Natalia Guzmán", role: "Médica estética · Aesthetic Lab", city: "CDMX", metric: "100% trazabilidad" },
    faqs: [
      ["¿Manejo trazabilidad de productos?", "Lote y caducidad por unidad de toxina, relleno, hilos. Requerido por COFEPRIS."],
      ["¿Consentimientos por procedimiento?", "Plantillas editables para cada tratamiento. Firma digital desde cualquier dispositivo."],
      ["¿Galería con permisos del paciente?", "Antes de mostrar públicamente, el paciente firma liberación de imagen digital."],
      ["¿Paquetes con descuento?", "Sí, paquetes de N sesiones con precio total, descuento calculado automático. CFDI por sesión."],
    ],
  },

  "acupuntura": {
    slug: "acupuntura", name: "Acupuntura", category: "Bienestar", icon: "needle", accent: "#fbbf24",
    tagline: "Mapa de meridianos", eyebrow: "Para acupunturistas",
    heroTitle: "Del diagnóstico energético a la aguja precisa.",
    heroSub:   "Mapa digital de meridianos, puntos usados por sesión, diagnóstico tradicional (pulso, lengua), protocolos por patología.",
    metricsStrip: [["361", "Puntos clásicos"], ["12+8", "Meridianos"], ["MTC", "Diagnóstico"], ["Histórico", "Por sesión"]],
    features: [
      feature("Mapa de meridianos", "Click sobre el cuerpo, registra qué puntos usaste en cada sesión. Historial por paciente.", "needle"),
      feature("Diagnóstico MTC", "Pulso, lengua, patrón energético. Plantillas por síndrome tradicional.", "doc"),
      feature("Protocolos por patología", "Bibliotecas de protocolos por cervicalgia, lumbago, insomnio, migraña, fertilidad.", "box"),
      feature("Evolución del paciente", "Gráfica de intensidad de síntomas por sesión. Sin métrica = sin argumento de valor.", "heart"),
      feature("Productos herbolarios", "Registro de prescripciones de herbolaria china, con lote y procedencia.", "pill"),
      feature("Recordatorios de sesiones", "Tratamientos son multi-sesión, los recordatorios suben adherencia dramáticamente.", "bell"),
    ],
    mockupKey: "acupuntura",
    testimonial: { q: "Registrar exactamente qué puntos funcionaron en cada paciente me permitió refinar mis protocolos. Ahora mi tasa de mejora en lumbago subió 40%, con evidencia.", name: "Dr. Yoshio Nakamura", role: "Acupunturista · Medicina China Integral", city: "CDMX", metric: "+40% mejora lumbago" },
    faqs: [
      ["¿Mapa digital de meridianos?", "Cuerpo completo frente, atrás, lateral. 361 puntos clásicos + puntos extraordinarios."],
      ["¿Maneja herbolaria china?", "Sí, catálogo de fórmulas clásicas y libres. Con lote y procedencia por COFEPRIS."],
      ["¿Protocolos por patología?", "Biblioteca inicial con 60 protocolos editables. Puedes crear los tuyos."],
      ["¿Tracking de evolución?", "Gráfica longitudinal de intensidad de síntomas. Evidencia visual de tu valor."],
    ],
  },

  "homeopatia": {
    slug: "homeopatia", name: "Homeopatía", category: "Bienestar", icon: "leaf", accent: "#fbbf24",
    tagline: "Materia médica integrada", eyebrow: "Para médicos homeópatas",
    heroTitle: "Similia similibus curantur. Digital.",
    heroSub:   "Materia médica integrada con 2,500 remedios, repertorización asistida, potencias, seguimiento longitudinal del paciente.",
    metricsStrip: [["2.5K", "Remedios"], ["Repertoriz.", "Asistida"], ["CH / DH / LM", "Potencias"], ["Plus", "Alopatía compat."]],
    features: [
      feature("Materia médica", "Base de datos con 2,500 remedios clásicos y contemporáneos. Búsqueda por síntoma, región, tipo.", "leaf"),
      feature("Repertorización asistida", "Ingresa síntomas, la app sugiere repertorizaciones a evaluar. Final decision es tuya.", "brain"),
      feature("Potencias y posología", "CH, DH, LM. Historial de potencias administradas al paciente.", "pill"),
      feature("Consulta unicista y pluralista", "Plantillas para ambas escuelas. El sistema no te obliga a una corriente.", "doc"),
      feature("Seguimiento longitudinal", "Constitución del paciente documentada. Evolución de síntomas sesión a sesión.", "heart"),
      feature("Compatible con alopatía", "Si tu paciente toma alopatía, lo registras. Alertas de incompatibilidades conocidas.", "bell"),
    ],
    mockupKey: "homeopatia",
    testimonial: { q: "La repertorización asistida acelera mi análisis sin reemplazar mi criterio. Ingreso los síntomas, veo sugerencias, decido. Gano 10 minutos por consulta, con mejor precisión.", name: "Dr. Alberto Peña", role: "Médico homeópata · Homeopatía MX", city: "Puebla", metric: "10 min/consulta" },
    faqs: [
      ["¿Maneja varias escuelas?", "Unicista, pluralista, complejista. Sin sesgo hacia una."],
      ["¿Qué materia médica?", "Boericke, Kent, Allen, Phatak, Nash. Actualizable."],
      ["¿Registro de constitución?", "Sí, plantillas por biotipo (Sulfur, Calcarea, Phosphorus, etc.) y seguimiento longitudinal."],
      ["¿Compatibilidad con alopatía?", "Si el paciente toma alopatía, se registra. Alertas de incompatibilidades documentadas."],
    ],
  },
};

export const SPECIALTY_SLUGS = Object.keys(SPECIALTIES);

export function getSpecialty(slug: string): Specialty | null {
  return SPECIALTIES[slug] ?? null;
}

export function getSpecialtiesByCategory(): Record<SpecialtyCategory, Specialty[]> {
  const result: Record<SpecialtyCategory, Specialty[]> = {
    "Dental":       [],
    "Médicas":      [],
    "Salud mental": [],
    "Bienestar":    [],
  };
  for (const s of Object.values(SPECIALTIES)) {
    result[s.category].push(s);
  }
  return result;
}
