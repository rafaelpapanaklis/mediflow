// ═══════════════════════════════════════════════════════════════════
// Biblioteca de plantillas semilla del módulo Marketing (WS-MKT-T6).
//
// Fuente CANÓNICA del set integrado que ve la clínica en
// /dashboard/marketing/library. Es data pura (sin React, sin prisma) →
// importable desde server y client. El cliente la fusiona con las
// plantillas que la clínica guarda en DB (POST /api/marketing/templates).
//
// El archivo sql/marketing_templates_seed.sql refleja el subconjunto
// UNIVERSAL (specialty=null) como plantillas globales para exponerlas por
// la API; aplicarlo es OPCIONAL — la biblioteca ya las muestra desde aquí.
// ═══════════════════════════════════════════════════════════════════

import type { ClinicCategoryValue } from "@/lib/directory/types";

export type TemplateKind = "IDEA" | "CAPTION" | "CAMPAIGN" | "IMAGE_BRIEF";

export interface TemplateKindMeta {
  id: TemplateKind;
  /** Etiqueta corta para los tabs */
  label: string;
  /** Nombre del icono de lucide-react (se mapea en el cliente) */
  icon: string;
  /** Ayuda de una línea sobre para qué sirve este tipo */
  hint: string;
}

export const TEMPLATE_KINDS: TemplateKindMeta[] = [
  { id: "IDEA",        label: "Ideas",     icon: "Lightbulb", hint: "Disparadores de contenido para no quedarte sin qué publicar." },
  { id: "CAPTION",     label: "Captions",  icon: "Type",      hint: "Textos listos para copiar y publicar en tus redes." },
  { id: "CAMPAIGN",    label: "Campañas",  icon: "Megaphone", hint: "Planes de varias publicaciones con un objetivo claro." },
  { id: "IMAGE_BRIEF", label: "Briefs",    icon: "Image",     hint: "Guías visuales para tu foto, carrusel o video." },
];

export interface SeedTemplate {
  /** Id determinista — usado por sql/marketing_templates_seed.sql para idempotencia. */
  id: string;
  kind: TemplateKind;
  /** null = universal (sirve para cualquier tipo de clínica). */
  specialty: ClinicCategoryValue | null;
  title: string;
  body: string;
  tags: string[];
}

// ───────────────────────────────────────────────────────────────────
// UNIVERSALES (specialty: null) — sirven para cualquier clínica. Estas
// son las que refleja el SQL semilla como globales.
// ───────────────────────────────────────────────────────────────────
const UNIVERSAL: SeedTemplate[] = [
  {
    id: "seed-idea-univ-equipo",
    kind: "IDEA",
    specialty: null,
    title: "Conoce al equipo",
    body: "Presenta a una persona del equipo: nombre, qué hace y un dato cercano (su frase favorita, por qué eligió esta profesión). Acerca la marca y genera confianza antes de la primera visita.",
    tags: ["equipo", "confianza", "marca"],
  },
  {
    id: "seed-idea-univ-faq",
    kind: "IDEA",
    specialty: null,
    title: "Resuelve una duda frecuente",
    body: "Toma la pregunta que más te hacen y respóndela en 3 líneas. Cierra con: \"¿Tienes otra duda? Escríbenos por mensaje directo.\" Educar posiciona a tu clínica como experta.",
    tags: ["educativo", "faq", "autoridad"],
  },
  {
    id: "seed-idea-univ-antes-despues",
    kind: "IDEA",
    specialty: null,
    title: "Antes y después",
    body: "Comparte una transformación real (siempre con consentimiento firmado del paciente). Explica brevemente el procedimiento y el tiempo que tomó. Es el contenido que más agenda citas.",
    tags: ["resultados", "prueba-social", "consentimiento"],
  },
  {
    id: "seed-idea-univ-detras",
    kind: "IDEA",
    specialty: null,
    title: "Detrás de cámaras",
    body: "Muestra el día a día: la preparación de tu espacio, la limpieza, la tecnología que usas. La transparencia tranquiliza a quien nunca te ha visitado.",
    tags: ["cercanía", "transparencia", "reels"],
  },
  {
    id: "seed-idea-univ-testimonio",
    kind: "IDEA",
    specialty: null,
    title: "Testimonio en video",
    body: "Pide a un paciente satisfecho que cuente en 20 segundos cómo se sintió. Sin guion, natural. Un testimonio real vale más que cualquier anuncio.",
    tags: ["testimonio", "video", "confianza"],
  },
  {
    id: "seed-caption-univ-bienvenida",
    kind: "CAPTION",
    specialty: null,
    title: "Bienvenida a nuevos pacientes",
    body: "¿Primera vez con nosotros? 💙\nEn {clinica} cuidamos cada detalle para que te sientas en confianza desde que entras.\nAgenda tu cita por mensaje directo o al {telefono}.\n📍 {ciudad}",
    tags: ["bienvenida", "nuevos-pacientes"],
  },
  {
    id: "seed-caption-univ-recordatorio",
    kind: "CAPTION",
    specialty: null,
    title: "Recordatorio: agenda tu cita",
    body: "Tu salud no puede esperar. ⏰\nAgenda hoy y aparta el horario que mejor te acomode.\n👉 Escríbenos por mensaje directo y con gusto te atendemos.",
    tags: ["recordatorio", "agenda"],
  },
  {
    id: "seed-caption-univ-promo",
    kind: "CAPTION",
    specialty: null,
    title: "Promoción del mes",
    body: "🎉 Promo de {mes}: {beneficio}.\nVálida hasta el {fecha} o hasta agotar lugares.\nAparta el tuyo por mensaje directo. ¡Te esperamos!",
    tags: ["promoción", "oferta"],
  },
  {
    id: "seed-caption-univ-tip",
    kind: "CAPTION",
    specialty: null,
    title: "Tip de la semana",
    body: "Tip de la semana 💡\n{tip_breve}\nGuárdalo para que no se te olvide y compártelo con quien lo necesite. 👇",
    tags: ["tip", "educativo", "guardar"],
  },
  {
    id: "seed-caption-univ-gracias",
    kind: "CAPTION",
    specialty: null,
    title: "Agradecimiento a pacientes",
    body: "Gracias por confiar en nosotros 🙏\nCada sonrisa que sale de aquí es la razón por la que hacemos lo que hacemos.\nNos vemos pronto. 💙",
    tags: ["agradecimiento", "comunidad"],
  },
  {
    id: "seed-campaign-univ-servicio",
    kind: "CAMPAIGN",
    specialty: null,
    title: "Lanzamiento de servicio nuevo",
    body: "Campaña de 4 publicaciones para estrenar un servicio:\n1) Teaser: \"Algo nuevo llega a {clinica}\" (genera intriga).\n2) Revelación: qué es y para quién es.\n3) Beneficios: 3 razones para probarlo + precio de lanzamiento.\n4) Prueba social: primer testimonio o resultado.\nPublica una cada 2-3 días.",
    tags: ["lanzamiento", "plan", "servicio"],
  },
  {
    id: "seed-campaign-univ-referidos",
    kind: "CAMPAIGN",
    specialty: null,
    title: "Programa de referidos",
    body: "Campaña para que tus pacientes te recomienden:\n1) Anuncio: \"Recomienda y gana {beneficio}\".\n2) Cómo participar en 2 pasos.\n3) Recordatorio con un testimonio de quien ya refirió.\nEl boca a boca es tu canal más barato y confiable.",
    tags: ["referidos", "fidelización", "plan"],
  },
  {
    id: "seed-campaign-univ-temporada",
    kind: "CAMPAIGN",
    specialty: null,
    title: "Campaña de temporada",
    body: "Aprovecha una fecha (regreso a clases, fin de año, Día de las Madres):\n1) Conecta tu servicio con la temporada.\n2) Oferta o paquete especial con fecha límite.\n3) Últimos días: urgencia + lugares limitados.\nLas fechas dan un motivo natural para agendar.",
    tags: ["temporada", "estacional", "plan"],
  },
  {
    id: "seed-brief-univ-fachada",
    kind: "IMAGE_BRIEF",
    specialty: null,
    title: "Foto de recepción / fachada",
    body: "Objetivo: transmitir limpieza y profesionalismo.\n• Luz natural, espacio ordenado y sin objetos personales a la vista.\n• Encuadre horizontal, a la altura de los ojos.\n• Incluye tu logo o un detalle de marca.\nEvita: desorden, cables visibles, iluminación amarilla.",
    tags: ["foto", "espacio", "marca"],
  },
  {
    id: "seed-brief-univ-retrato",
    kind: "IMAGE_BRIEF",
    specialty: null,
    title: "Retrato del especialista",
    body: "Objetivo: humanizar a quien atiende.\n• Fondo neutro o el propio consultorio desenfocado.\n• Bata o uniforme limpio, sonrisa natural.\n• Vertical para que funcione en historias y reels.\nUsa esta foto en tu perfil y en publicaciones de \"conoce al equipo\".",
    tags: ["retrato", "equipo", "foto"],
  },
  {
    id: "seed-brief-univ-carrusel",
    kind: "IMAGE_BRIEF",
    specialty: null,
    title: "Carrusel educativo (5 slides)",
    body: "Estructura de un carrusel que se guarda y comparte:\n1) Portada con la pregunta o el mito.\n2-4) Una idea por slide, frase corta + icono.\n5) Cierre con tu marca y llamado: \"Agenda por mensaje directo\".\nMantén la misma tipografía y colores en todos los slides.",
    tags: ["carrusel", "educativo", "diseño"],
  },
];

// ───────────────────────────────────────────────────────────────────
// POR ESPECIALIDAD — tailored a cada tipo de clínica. Se muestran junto
// a las universales cuando la clínica filtra por su especialidad.
// ───────────────────────────────────────────────────────────────────
const BY_SPECIALTY: SeedTemplate[] = [
  // DENTAL
  {
    id: "seed-idea-dental-mitos-blanqueamiento",
    kind: "IDEA",
    specialty: "DENTAL",
    title: "Mitos del blanqueamiento dental",
    body: "Desmiente 3 mitos: \"debilita el diente\", \"dura para siempre\", \"el de farmacia es igual\". Explica qué sí pueden esperar y por qué hacerlo con profesional. Educa y vende a la vez.",
    tags: ["dental", "blanqueamiento", "mitos"],
  },
  {
    id: "seed-caption-dental-limpieza",
    kind: "CAPTION",
    specialty: "DENTAL",
    title: "Promo de limpieza dental",
    body: "Tu sonrisa merece un reinicio ✨\nLimpieza dental profesional este {mes} con {beneficio}.\nQuita sarro, manchas y previene caries.\nAgenda por mensaje directo. 🦷",
    tags: ["dental", "limpieza", "promoción"],
  },
  {
    id: "seed-campaign-dental-mes-sonrisa",
    kind: "CAMPAIGN",
    specialty: "DENTAL",
    title: "Mes de la sonrisa",
    body: "Campaña de revisión preventiva:\n1) Dato: cada cuánto deberías ir al dentista.\n2) Checklist de señales para no ignorar.\n3) Paquete revisión + limpieza con precio especial.\n4) Antes y después de un caso real.",
    tags: ["dental", "prevención", "plan"],
  },
  // DERMATOLOGY
  {
    id: "seed-idea-derma-rutina",
    kind: "IDEA",
    specialty: "DERMATOLOGY",
    title: "Rutina según tu tipo de piel",
    body: "Explica en un carrusel la rutina básica (limpieza, hidratación, protección) y cómo cambia según piel grasa, seca o mixta. Posiciónate como la fuente confiable frente a los consejos de redes.",
    tags: ["dermatología", "skincare", "educativo"],
  },
  {
    id: "seed-caption-derma-spf",
    kind: "CAPTION",
    specialty: "DERMATOLOGY",
    title: "Protector solar todo el año",
    body: "El sol no descansa, tu piel tampoco. ☀️\nUsar SPF a diario previene manchas y envejecimiento prematuro.\n¿Dudas sobre cuál te conviene? Agenda tu valoración. 🧴",
    tags: ["dermatología", "protección-solar", "prevención"],
  },
  // AESTHETIC_MEDICINE
  {
    id: "seed-idea-estetica-toxina",
    kind: "IDEA",
    specialty: "AESTHETIC_MEDICINE",
    title: "Dudas sobre toxina botulínica",
    body: "Responde con honestidad: ¿duele?, ¿se nota artificial?, ¿cuánto dura? Refuerza que se busca un resultado natural y que lo aplica personal médico certificado.",
    tags: ["estética", "toxina", "faq"],
  },
  {
    id: "seed-caption-estetica-natural",
    kind: "CAPTION",
    specialty: "AESTHETIC_MEDICINE",
    title: "Resultados naturales",
    body: "Verte bien sin que se note. ✨\nNuestro objetivo siempre es realzar tus rasgos, no cambiarte.\nValoración con personal médico certificado. Agenda por mensaje directo.",
    tags: ["estética", "natural", "confianza"],
  },
  // NUTRITION
  {
    id: "seed-idea-nutricion-mitos",
    kind: "IDEA",
    specialty: "NUTRITION",
    title: "Mitos de las dietas de moda",
    body: "Explica por qué las dietas extremas no funcionan a largo plazo y qué sí: un plan personalizado y sostenible. Aterriza la idea de \"proceso, no milagro\".",
    tags: ["nutrición", "mitos", "educativo"],
  },
  {
    id: "seed-caption-nutricion-plan",
    kind: "CAPTION",
    specialty: "NUTRITION",
    title: "Plan personalizado",
    body: "No existe la dieta perfecta… existe TU plan. 🥗\nDiseñamos uno a tu medida, tu ritmo y tus gustos.\nAgenda tu primera consulta y empecemos juntos. 💪",
    tags: ["nutrición", "plan", "personalizado"],
  },
  // PSYCHOLOGY
  {
    id: "seed-idea-psico-senales",
    kind: "IDEA",
    specialty: "PSYCHOLOGY",
    title: "Señales de que vale la pena pedir apoyo",
    body: "Lista con tacto 4 señales (cansancio constante, irritabilidad, aislarte, dormir mal). Normaliza pedir ayuda y cierra con un mensaje cálido, sin diagnósticos.",
    tags: ["psicología", "bienestar", "educativo"],
  },
  {
    id: "seed-caption-psico-valentia",
    kind: "CAPTION",
    specialty: "PSYCHOLOGY",
    title: "Ir a terapia es valentía",
    body: "Pedir ayuda no es debilidad, es valentía. 💙\nUn espacio seguro, confidencial y sin juicios para ti.\nAgenda tu primera sesión cuando estés listo. Aquí estamos.",
    tags: ["psicología", "terapia", "empatía"],
  },
  // PHYSIOTHERAPY
  {
    id: "seed-idea-fisio-espalda",
    kind: "IDEA",
    specialty: "PHYSIOTHERAPY",
    title: "Ejercicios para el dolor de espalda",
    body: "Muestra en video 2-3 estiramientos suaves para quien pasa horas sentado. Aclara que ante dolor persistente hay que valorar. Contenido útil que se guarda y comparte.",
    tags: ["fisioterapia", "ejercicios", "video"],
  },
  {
    id: "seed-caption-fisio-recupera",
    kind: "CAPTION",
    specialty: "PHYSIOTHERAPY",
    title: "Recupérate de tu lesión",
    body: "Una lesión mal cuidada hoy es un dolor crónico mañana. 🦵\nDiseñamos tu plan de rehabilitación paso a paso.\nAgenda tu valoración y vuelve a moverte sin dolor.",
    tags: ["fisioterapia", "rehabilitación", "lesión"],
  },
  // SPA / MASSAGE
  {
    id: "seed-caption-spa-pausa",
    kind: "CAPTION",
    specialty: "SPA",
    title: "Regálate una pausa",
    body: "Tu cuerpo lleva todo el peso de la semana. 🌿\nDate una pausa: masaje, silencio y aromas que te reinician.\nReserva tu momento por mensaje directo.",
    tags: ["spa", "relajación", "autocuidado"],
  },
  {
    id: "seed-idea-masaje-beneficios",
    kind: "IDEA",
    specialty: "MASSAGE",
    title: "Beneficios del masaje mensual",
    body: "Explica qué gana el cuerpo con masaje regular: menos tensión, mejor sueño, menos dolor. Invita a hacerlo un hábito, no un lujo de una vez al año.",
    tags: ["masaje", "bienestar", "hábito"],
  },
  // BEAUTY_CENTER
  {
    id: "seed-caption-belleza-evento",
    kind: "CAPTION",
    specialty: "BEAUTY_CENTER",
    title: "Glow para tu evento",
    body: "¿Tienes un evento importante? ✨\nPrepara tu piel con tiempo y llega radiante.\nAparta tu cita esta semana por mensaje directo. 💆‍♀️",
    tags: ["belleza", "evento", "facial"],
  },
  // HAIR_SALON
  {
    id: "seed-caption-cabello-look",
    kind: "CAPTION",
    specialty: "HAIR_SALON",
    title: "Renueva tu look",
    body: "Nuevo mes, nuevo look. 💇‍♀️\nCorte, color o tratamiento: dinos qué quieres lograr y lo hacemos realidad.\nAgenda por mensaje directo. ¡Te esperamos!",
    tags: ["cabello", "look", "estilismo"],
  },
  // NAIL_SALON
  {
    id: "seed-caption-unas-disenos",
    kind: "CAPTION",
    specialty: "NAIL_SALON",
    title: "Diseños de la semana",
    body: "Tus uñas también hablan de ti. 💅\nEstos son los diseños más pedidos esta semana.\n¿Cuál te gusta para tu próxima cita? Aparta por mensaje directo.",
    tags: ["uñas", "diseño", "tendencia"],
  },
  // LASER_HAIR_REMOVAL
  {
    id: "seed-caption-laser-verano",
    kind: "CAPTION",
    specialty: "LASER_HAIR_REMOVAL",
    title: "Paquete sin vello para verano",
    body: "Despídete del rastrillo para siempre. ⚡\nPaquetes de depilación láser con seguimiento por sesión.\nEntre más pronto empieces, más lista estarás para el verano. Agenda ya.",
    tags: ["depilación-láser", "paquete", "verano"],
  },
  // PODIATRY
  {
    id: "seed-idea-podologia-diabetes",
    kind: "IDEA",
    specialty: "PODIATRY",
    title: "Cuida tus pies si tienes diabetes",
    body: "Explica por qué el cuidado del pie es clave en personas con diabetes y qué señales no ignorar. Invita a una revisión preventiva. Educa salvando complicaciones.",
    tags: ["podología", "diabetes", "prevención"],
  },
];

export const SEED_TEMPLATES: SeedTemplate[] = [...UNIVERSAL, ...BY_SPECIALTY];

/** Subconjunto universal (lo que refleja el SQL semilla como global). */
export const SEED_TEMPLATES_UNIVERSAL = UNIVERSAL;

/** Metadatos del tipo (label/icon/hint) por id. */
export function templateKindMeta(kind: TemplateKind): TemplateKindMeta {
  return TEMPLATE_KINDS.find((k) => k.id === kind) ?? TEMPLATE_KINDS[0];
}
