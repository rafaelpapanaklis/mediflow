// ─────────────────────────────────────────────────────────────────────────────
// Titulos de los articulos del blog a los que enlazan los casos de uso.
//
// Por que existe este mapa: /casos-de-uso/[slug] se genera en build con
// generateStaticParams y el blog vive en la BD, que no esta garantizada en build
// time (mismo motivo por el que /blog/[slug] no usa generateStaticParams). La
// ficha intenta primero resolver los relacionados contra la BD -- con excerpt y
// fecha -- y si no hay BD cae a este mapa para que los 3 enlaces internos
// existan siempre.
//
// Los slugs estan verificados contra el sitemap y el RSS publicos. Si alguna vez
// se renombra un articulo, la BD manda: aqui solo se pierde la etiqueta bonita
// del fallback, nunca el enlace.
// ─────────────────────────────────────────────────────────────────────────────

export const BLOG_LINK_TITLES: Record<string, string> = {
  "agenda-dental-organizar-citas":
    "Agenda dental: cómo organizar las citas de tu clínica para no perder dinero",
  "branding-consultorio-dental":
    "La marca de tu consultorio dental: mucho más que un logo",
  "clinica-dental-digital-tecnologia":
    "Clínica dental digital: tecnología que sí vale la pena en 2026",
  "como-abrir-consultorio-dental-mexico":
    "Cómo abrir un consultorio dental en México: guía completa 2026",
  "como-administrar-clinica-dental":
    "Cómo administrar una clínica dental: guía de operación completa",
  "como-conseguir-mas-pacientes-clinica-dental":
    "Cómo conseguir más pacientes para tu clínica dental: guía completa",
  "confirmacion-citas-whatsapp":
    "Confirmación de citas por WhatsApp: guía práctica para clínicas",
  "convenios-empresas-pacientes":
    "Convenios con empresas locales: una fuente de pacientes que muchas clínicas dentales ignoran",
  "cuanto-invertir-marketing-dental":
    "Cuánto invertir en marketing dental según la etapa de tu clínica",
  "email-marketing-clinicas":
    "Email marketing para clínicas dentales: cuándo sí funciona",
  "expediente-clinico-electronico-dental":
    "Expediente clínico electrónico dental: guía completa 2026",
  "experiencia-paciente-dental":
    "Experiencia del paciente dental: guía para clínicas que fidelizan",
  "facturacion-dentistas-mexico-cfdi":
    "Facturación para dentistas en México: guía CFDI completa",
  "financiamiento-dental-pacientes-mexico":
    "Financiamiento dental: opciones para ofrecer a tus pacientes en México",
  "finanzas-clinica-dental-guia":
    "Finanzas para clínicas dentales: guía de control y rentabilidad",
  "gestion-especialidades-dentales":
    "Gestión por especialidad dental: lo que cambia en cada consulta",
  "ia-marketing-clinicas-limites":
    "IA en el marketing de tu clínica dental: hasta dónde puede llegar",
  "inteligencia-artificial-odontologia":
    "Inteligencia artificial en odontología: usos reales hoy",
  "lista-espera-pacientes-dental":
    "Lista de espera de pacientes: cómo implementarla y llenar cancelaciones",
  "marketing-dental-mexico-guia":
    "Marketing dental en México: guía completa para atraer pacientes",
  "normativas-clinicas-dentales-mexico":
    "Normativas para clínicas dentales en México: guía 2026",
  "por-que-no-aceptan-presupuesto-dental":
    "Por qué los pacientes no aceptan el presupuesto (y cómo cambiarlo)",
  "precios-tratamientos-dentales-rentables":
    "Cuánto cobrar por tratamiento: método para fijar precios rentables",
  "primera-visita-paciente-dental":
    "Primera visita perfecta: protocolo para convertir valoraciones en tratamientos",
  "punto-equilibrio-consultorio-dental":
    "Cómo calcular el punto de equilibrio de tu consultorio dental",
  "reactivacion-pacientes-inactivos":
    "Reactivación de pacientes inactivos: campañas de recall que funcionan",
  "reducir-no-shows-clinica-dental":
    "Cómo reducir las citas perdidas (no-shows) en tu clínica dental",
  "seguimiento-presupuestos-pendientes-dental":
    "Seguimiento de presupuestos pendientes: cuándo y cómo insistir",
  "software-consultorio-dental-guia":
    "Software para consultorio dental: guía completa para elegir en 2026",
  "whatsapp-clinicas-dentales-guia":
    "WhatsApp para clínicas dentales: guía completa de uso profesional",
};

/** Slugs de blog validos para enlazar desde un caso de uso. */
export const BLOG_LINK_SLUGS: string[] = Object.keys(BLOG_LINK_TITLES);

export function blogLinkTitle(slug: string): string {
  return BLOG_LINK_TITLES[slug] ?? slug.replace(/-/g, " ");
}
