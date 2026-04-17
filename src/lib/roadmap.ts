export type RoadmapStatus = "launched" | "in_progress" | "planned";

export interface RoadmapItem {
  title: string;
  description: string;
  status: RoadmapStatus;
  quarter?: string;
}

export const STATUS_META: Record<RoadmapStatus, { label: string; accent: string; bg: string; border: string }> = {
  launched:    { label: "Lanzado",       accent: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  in_progress: { label: "En desarrollo", accent: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30" },
  planned:     { label: "Planeado",      accent: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30" },
};

// Hardcoded — actualiza este archivo cuando cambie el estado de una feature.
export const ROADMAP: RoadmapItem[] = [
  // Launched
  { title: "Expediente clínico multi-especialidad", description: "Dental, medicina general, dermatología, psicología, podología, nutrición y más con campos específicos por área.", status: "launched", quarter: "Q1 2026" },
  { title: "Análisis de radiografías con IA",        description: "Detección asistida de hallazgos en radiografías dentales con explicación clínica y recomendaciones.", status: "launched", quarter: "Q1 2026" },
  { title: "Recordatorios de cita por WhatsApp",     description: "Envío automático 24 h y 1 h antes de la cita. Respuestas del paciente se registran en la ficha.", status: "launched", quarter: "Q4 2025" },
  { title: "Agenda multi-doctor con Google Calendar", description: "Sincroniza citas con Google Calendar por doctor y a nivel clínica. Salas y recursos configurables.", status: "launched", quarter: "Q4 2025" },
  { title: "Landing page pública por clínica",        description: "Cada clínica obtiene un sitio público con galería, testimonios, servicios y reservas online.", status: "launched", quarter: "Q1 2026" },
  { title: "Telemedicina con video integrado",        description: "Videoconsulta con Daily.co, cobro automático Stripe y grabación opcional.", status: "launched", quarter: "Q1 2026" },

  // In progress
  { title: "Cobro automático mensual con Stripe",    description: "Suscripciones recurrentes y self-service de cambio de plan desde el portal del doctor.", status: "in_progress", quarter: "Q2 2026" },
  { title: "Generación de CFDI (factura SAT)",        description: "Emisión y cancelación de CFDI 4.0 directamente desde el módulo de facturación.", status: "in_progress", quarter: "Q2 2026" },
  { title: "Reportes financieros exportables a Excel", description: "MRR, ARR, LTV, churn y conversión con exportación XLSX por periodo.", status: "in_progress", quarter: "Q2 2026" },
  { title: "Portal del paciente",                     description: "Acceso propio del paciente a sus citas, expediente, recetas y pagos.", status: "in_progress", quarter: "Q2 2026" },

  // Planned
  { title: "App móvil nativa (iOS/Android)",         description: "Acceso completo desde el celular con notificaciones push para doctor y paciente.", status: "planned", quarter: "Q3 2026" },
  { title: "Integración con laboratorios clínicos",  description: "Solicitud y recepción automática de estudios de laboratorio desde el expediente.", status: "planned", quarter: "Q3 2026" },
  { title: "Recetas electrónicas firmadas",          description: "Emisión de receta médica con firma digital y envío por correo/WhatsApp al paciente.", status: "planned", quarter: "Q3 2026" },
  { title: "Inventario con lectura de código de barras", description: "Alta y salida de inventario escaneando productos desde el celular.", status: "planned", quarter: "Q3 2026" },
  { title: "Marketplace de plantillas de especialidad", description: "Comunidad de doctores que comparten formatos, protocolos y plantillas por especialidad.", status: "planned", quarter: "Q4 2026" },
];
