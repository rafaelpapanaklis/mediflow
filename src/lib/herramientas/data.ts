// ─────────────────────────────────────────────────────────────────────────────
// Registro de las herramientas gratuitas públicas (/herramientas).
//
// Data 100% ESTÁTICA en el repo: ni BD, ni API, ni SQL. El índice, el sitemap y
// los bloques de "otras herramientas" leen de aquí, así que un slug nuevo se
// agrega en un solo lugar. Las páginas viven en src/app/herramientas/<slug>/ y
// se prerenderizan en build (no dependen de DATABASE_URL).
//
// Los `relatedBlogSlugs` están verificados contra el sitemap público — el mapa
// de títulos vive en src/lib/casos/blog-links.ts y es la lista de artículos que
// realmente existen. Nunca enlaces un slug que no esté ahí: sería un 404
// indexado.
// ─────────────────────────────────────────────────────────────────────────────

export type HerramientaIcon =
  | "citas-perdidas"
  | "punto-equilibrio"
  | "aviso-privacidad"
  | "consentimiento"
  | "precio-tratamiento";

export type Herramienta = {
  slug: string;
  /** Nombre corto para tarjetas y navegación. */
  name: string;
  /** Pregunta o promesa — es el H1 de la página. */
  headline: string;
  /** Para qué sirve, una línea (tarjeta del índice). */
  purpose: string;
  icon: HerramientaIcon;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  relatedBlogSlugs: string[];
};

/** Fecha de publicación de la sección (sitemap + JSON-LD). ISO, sin Date.now. */
export const HERRAMIENTAS_PUBLISHED_AT = "2026-07-29T12:00:00.000Z";

/**
 * La línea que va SIEMPRE visible en cada herramienta. No es letra chica: es la
 * razón por la que un dentista se anima a teclear los números de su clínica.
 */
export const HERRAMIENTAS_PRIVACY_NOTE =
  "Tus datos no salen de tu navegador: los cálculos y los textos se generan en tu dispositivo y no se envían a ningún servidor. Nada se guarda y no hace falta registrarte.";

export const HERRAMIENTAS: Herramienta[] = [
  {
    slug: "calculadora-citas-perdidas",
    name: "Calculadora de citas perdidas",
    headline: "¿Cuánto te cuestan las citas perdidas?",
    purpose:
      "Pon tus citas por semana, tu porcentaje de inasistencia y tu ticket promedio para ver el dinero que se va al mes y al año.",
    icon: "citas-perdidas",
    metaTitle: "Calculadora de citas perdidas en tu clínica dental",
    metaDescription:
      "Calcula gratis cuánto dinero pierdes al mes y al año por citas perdidas en tu clínica dental. Corre en tu navegador, sin registro y sin enviar datos.",
    keywords: [
      "calculadora de citas perdidas",
      "no shows clínica dental",
      "inasistencia de pacientes",
      "cuánto cuesta una cita perdida",
      "calculadora gratis para dentistas",
    ],
    relatedBlogSlugs: [
      "reducir-no-shows-clinica-dental",
      "confirmacion-citas-whatsapp",
      "lista-espera-pacientes-dental",
    ],
  },
  {
    slug: "calculadora-punto-equilibrio",
    name: "Calculadora de punto de equilibrio",
    headline: "Punto de equilibrio de tu consultorio",
    purpose:
      "Cuántos tratamientos al mes necesitas para cubrir tus gastos fijos, con el equivalente por semana y por día hábil.",
    icon: "punto-equilibrio",
    metaTitle: "Calculadora de punto de equilibrio para consultorios",
    metaDescription:
      "Calcula el punto de equilibrio de tu consultorio dental: cuántos tratamientos al mes necesitas para no perder. Gratis y sin salir de tu navegador.",
    keywords: [
      "calculadora punto de equilibrio",
      "punto de equilibrio consultorio dental",
      "gastos fijos consultorio",
      "margen por tratamiento",
      "rentabilidad clínica dental",
    ],
    relatedBlogSlugs: [
      "punto-equilibrio-consultorio-dental",
      "finanzas-clinica-dental-guia",
      "como-administrar-clinica-dental",
    ],
  },
  {
    slug: "generador-aviso-privacidad",
    name: "Generador de aviso de privacidad",
    headline: "Generador de aviso de privacidad para consultorio",
    purpose:
      "Llena tus datos y obtén un aviso de privacidad simplificado, listo para copiar o imprimir y revisar con tu asesor legal.",
    icon: "aviso-privacidad",
    metaTitle: "Generador de aviso de privacidad para consultorio",
    metaDescription:
      "Genera gratis el aviso de privacidad simplificado de tu consultorio dental con tus datos y finalidades. Se arma en tu navegador: copia o imprime.",
    keywords: [
      "generador de aviso de privacidad",
      "aviso de privacidad consultorio dental",
      "aviso de privacidad LFPDPPP",
      "datos personales pacientes",
      "plantilla aviso de privacidad dentista",
    ],
    relatedBlogSlugs: [
      "normativas-clinicas-dentales-mexico",
      "expediente-clinico-electronico-dental",
      "whatsapp-clinicas-dentales-guia",
    ],
  },
  {
    slug: "generador-consentimiento-informado",
    name: "Generador de consentimiento informado",
    headline: "Generador de consentimiento informado",
    purpose:
      "Elige el procedimiento y obtén un formato base con riesgos frecuentes, alternativas y campos de firma para que el doctor lo complete.",
    icon: "consentimiento",
    metaTitle: "Generador de consentimiento informado dental",
    metaDescription:
      "Genera gratis un formato base de consentimiento informado dental por procedimiento, con riesgos, alternativas y firmas. Todo en tu navegador.",
    keywords: [
      "generador de consentimiento informado",
      "consentimiento informado odontología",
      "formato consentimiento informado dental",
      "consentimiento extracción dental",
      "documentos legales consultorio dental",
    ],
    relatedBlogSlugs: [
      "normativas-clinicas-dentales-mexico",
      "expediente-clinico-electronico-dental",
      "primera-visita-paciente-dental",
    ],
  },
  {
    slug: "calculadora-precio-tratamiento",
    name: "Calculadora de precio por tratamiento",
    headline: "¿Cuánto cobrar por un tratamiento?",
    purpose:
      "Suma insumos, tiempo de sillón y laboratorio, elige tu margen y obtén el precio sugerido con una comparativa de escenarios.",
    icon: "precio-tratamiento",
    metaTitle: "Calculadora de precio por tratamiento dental",
    metaDescription:
      "Calcula gratis cuánto cobrar por un tratamiento dental: insumos, minutos de sillón, laboratorio y margen. Corre en tu navegador, sin registro.",
    keywords: [
      "cuánto cobrar por un tratamiento dental",
      "calculadora de precios dentales",
      "costo hora de sillón",
      "margen tratamiento dental",
      "tarifas consultorio dental",
    ],
    relatedBlogSlugs: [
      "precios-tratamientos-dentales-rentables",
      "finanzas-clinica-dental-guia",
      "punto-equilibrio-consultorio-dental",
    ],
  },
];

export function getHerramientaBySlug(slug: string): Herramienta | undefined {
  return HERRAMIENTAS.find((h) => h.slug === slug);
}

/** Las otras herramientas — para el bloque de enlaces internos de cada ficha. */
export function getOtherHerramientas(slug: string, limit = 4): Herramienta[] {
  return HERRAMIENTAS.filter((h) => h.slug !== slug).slice(0, limit);
}
