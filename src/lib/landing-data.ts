export type IconColor = {
  bg: string;
  text: string;
};

export const iconColors: Record<string, IconColor> = {
  blue:   { bg: "bg-blue-500/15",    text: "text-blue-400" },
  purple: { bg: "bg-purple-500/15",  text: "text-purple-400" },
  teal:   { bg: "bg-teal-500/15",    text: "text-teal-400" },
  pink:   { bg: "bg-pink-500/15",    text: "text-pink-400" },
  amber:  { bg: "bg-amber-500/15",   text: "text-amber-400" },
  green:  { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  rose:   { bg: "bg-rose-500/15",    text: "text-rose-400" },
  cyan:   { bg: "bg-cyan-500/15",    text: "text-cyan-400" },
  indigo: { bg: "bg-indigo-500/15",  text: "text-indigo-400" },
  orange: { bg: "bg-orange-500/15",  text: "text-orange-400" },
  lime:   { bg: "bg-lime-500/15",    text: "text-lime-400" },
  violet: { bg: "bg-violet-500/15",  text: "text-violet-400" },
};

export type SpecialtyIconKey =
  | "Smile" | "Stethoscope" | "Salad" | "Brain" | "Sun" | "Activity"
  | "Dumbbell" | "Sparkles" | "Scissors" | "Flower2" | "Hand" | "Zap"
  | "Leaf" | "Palette" | "Waves";

export type Specialty = {
  name: string;
  slug: string;
  desc: string;
  iconKey: SpecialtyIconKey;
  colorKey: keyof typeof iconColors;
};

export type SpecialtyCategory = "salud" | "estetica" | "belleza";

export const specialties: Record<SpecialtyCategory, Specialty[]> = {
  salud: [
    { name: "Dental",           slug: "dental",           desc: "Odontograma, periodontograma y radiografías digitales.", iconKey: "Smile",       colorKey: "blue"   },
    { name: "Medicina General", slug: "medicina-general", desc: "Consulta con CIE-10, vitales y prescripciones.",          iconKey: "Stethoscope", colorKey: "teal"   },
    { name: "Nutrición",        slug: "nutricion",        desc: "Planes alimenticios, IMC y seguimiento de peso.",         iconKey: "Salad",       colorKey: "green"  },
    { name: "Psicología",       slug: "psicologia",       desc: "Notas SOAP/BIRP, escalas PHQ-9 y plan terapéutico.",      iconKey: "Brain",       colorKey: "purple" },
    { name: "Dermatología",     slug: "dermatologia",     desc: "Registro fotográfico de lesiones y tratamientos.",        iconKey: "Sun",         colorKey: "amber"  },
    { name: "Fisioterapia",     slug: "fisioterapia",     desc: "Ejercicios personalizados, ROM y evolución.",             iconKey: "Activity",    colorKey: "lime"   },
    { name: "Podología",        slug: "podologia",        desc: "Evaluación podológica, ortesis y pie diabético.",         iconKey: "Dumbbell",    colorKey: "rose"   },
  ],
  estetica: [
    { name: "Medicina Estética",  slug: "medicina-estetica",  desc: "Botox, fillers, PRP y protocolos faciales.",         iconKey: "Sparkles", colorKey: "pink"   },
    { name: "Clínicas Capilares", slug: "clinicas-capilares", desc: "Trasplante capilar, PRP y seguimiento folicular.",   iconKey: "Scissors", colorKey: "violet" },
  ],
  belleza: [
    { name: "Centros de Estética",   slug: "centros-estetica",    desc: "Faciales, corporales y aparatología avanzada.",    iconKey: "Flower2",  colorKey: "rose"   },
    { name: "Cejas y Pestañas",      slug: "cejas-pestanas",      desc: "Microblading, extensiones y diseño personalizado.", iconKey: "Sparkles", colorKey: "cyan"   },
    { name: "Masajes",               slug: "masajes",             desc: "Terapéuticos, deportivos y relajantes.",            iconKey: "Hand",     colorKey: "amber"  },
    { name: "Depilación Láser",      slug: "depilacion-laser",    desc: "Control por zona, sesiones y fototipos.",           iconKey: "Zap",      colorKey: "orange" },
    { name: "Peluquerías",           slug: "peluquerias",         desc: "Colorimetría, fórmulas y agenda por servicio.",     iconKey: "Scissors", colorKey: "indigo" },
    { name: "Medicina Alternativa",  slug: "medicina-alternativa",desc: "Acupuntura, herbolaria y terapias holísticas.",     iconKey: "Leaf",     colorKey: "green"  },
    { name: "Uñas",                  slug: "unas",                desc: "Manicura, pedicura, gel, acrílico y nail art.",     iconKey: "Palette",  colorKey: "pink"   },
    { name: "Spas",                  slug: "spas",                desc: "Circuitos de agua, envolturas y paquetes relax.",   iconKey: "Waves",    colorKey: "teal"   },
  ],
};

export type FeatureIconKey =
  | "Calendar" | "FileText" | "Receipt" | "Users"
  | "Camera" | "Package" | "Shield" | "BarChart3";

export type FeatureSpan = 3 | 4 | 6;

export type Feature = {
  name: string;
  desc: string;
  iconKey: FeatureIconKey;
  colorKey: keyof typeof iconColors;
  span: FeatureSpan;
};

export const features: Feature[] = [
  { name: "Agenda inteligente",    desc: "Confirmación automática por WhatsApp. Cero dobles reservaciones.", iconKey: "Calendar", colorKey: "blue",   span: 6 },
  { name: "Expediente clínico",    desc: "Formularios especializados por categoría con notas SOAP.",        iconKey: "FileText", colorKey: "purple", span: 6 },
  { name: "Facturación CFDI 4.0",  desc: "Timbrado automático, pagos a plazos y reportes fiscales.",        iconKey: "Receipt",  colorKey: "amber",  span: 4 },
  { name: "Portal del paciente",   desc: "Citas, historial y pagos — acceso seguro por link.",              iconKey: "Users",    colorKey: "teal",   span: 4 },
  { name: "Fotos antes/después",   desc: "Comparación visual por ángulo para documentar progreso.",         iconKey: "Camera",   colorKey: "pink",   span: 4 },
  { name: "Paquetes y bonos",      desc: "Sesiones prepagadas con control de redención automático.",        iconKey: "Package",  colorKey: "green",  span: 6 },
  { name: "Inventario",            desc: "Stock en tiempo real con alertas de mínimo y trazabilidad.",      iconKey: "Shield",   colorKey: "orange", span: 3 },
  { name: "Reportes y analytics",  desc: "KPIs, revenue, churn y ocupación para decidir con datos.",        iconKey: "BarChart3", colorKey: "indigo", span: 3 },
];

export type PricingPlan = {
  name: string;
  subtitle: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  highlighted: boolean;
};

export const pricingPlans: PricingPlan[] = [
  {
    name: "Básico",
    subtitle: "Para consultorios individuales",
    price: "$499",
    period: "/mes",
    features: ["1 profesional", "200 pacientes", "Agenda completa", "Expediente clínico", "Facturación básica", "Soporte por email"],
    cta: "Empezar 14 días gratis",
    highlighted: false,
  },
  {
    name: "Profesional",
    subtitle: "El más popular",
    price: "$999",
    period: "/mes",
    features: ["Hasta 5 profesionales", "Pacientes ilimitados", "Todo lo del Básico", "Fotos antes/después", "Paquetes y membresías", "WhatsApp bidireccional", "Soporte prioritario"],
    cta: "Empezar 14 días gratis",
    highlighted: true,
  },
  {
    name: "Clínica",
    subtitle: "Para equipos grandes",
    price: "$2,499",
    period: "/mes",
    features: ["Profesionales ilimitados", "Todo lo del Profesional", "Múltiples sucursales", "Inventario avanzado", "Reportes y analytics", "API access", "Soporte 24/7"],
    cta: "Empezar 14 días gratis",
    highlighted: false,
  },
];

export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  image: string;
};

export const testimonials: Testimonial[] = [
  {
    quote: "Los expedientes digitales para odontología me ahorraron horas cada semana. Mis pacientes adoran el portal de citas.",
    name: "Dra. María García",
    role: "Directora · Clínica Dental Sonrisa · CDMX",
    image: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=100&h=100&fit=crop&crop=face",
  },
  {
    quote: "Los paquetes y fotos antes/después son increíbles. La agenda con WhatsApp eliminó las inasistencias casi por completo.",
    name: "Lic. Andrea Torres",
    role: "Fundadora · Centro de Estética Bella · Monterrey",
    image: "https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=100&h=100&fit=crop&crop=face",
  },
  {
    quote: "Los ejercicios personalizados y el seguimiento ROM me permiten dar un servicio de primer nivel.",
    name: "Dr. Carlos Mendoza",
    role: "Fisioterapeuta · Fisioterapia Integral · Guadalajara",
    image: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=100&h=100&fit=crop&crop=face",
  },
];

export type Step = {
  number: string;
  title: string;
  desc: string;
};

export const steps: Step[] = [
  { number: "1", title: "Crea tu cuenta",       desc: "Elige tu especialidad, nombra tu clínica y registra tu primer profesional." },
  { number: "2", title: "Configura tu agenda",  desc: "Define horarios, servicios y conecta WhatsApp para recordatorios automáticos." },
  { number: "3", title: "Recibe pacientes",     desc: "Agenda citas, crea expedientes y factura — todo desde un solo panel." },
];

export type Stat = {
  number: string;
  label: string;
};

export const stats: Stat[] = [
  { number: "500+",    label: "clínicas activas" },
  { number: "50,000+", label: "pacientes gestionados" },
  { number: "18",      label: "especialidades" },
];

export const marqueeLogos = [
  "Dental Sonrisa", "Clínica Vital", "EstétiCare", "NutriSalud",
  "Centro Bella", "FisioPlus", "DermaClin", "PsicoWell",
];
