// ─────────────────────────────────────────────────────────────────────────────
// Categorías del blog — lista FIJA (no vive en BD).
//
// Es el mismo enfoque que DIRECTORY_CATEGORIES (src/lib/directory/types.ts):
// una constante compartida por el importador, el admin, las rutas públicas y
// el sitemap. Así /blog/categoria/<slug> puede ser 404 determinista para
// cualquier slug fuera de la lista, sin pegarle a la BD.
//
// El `slug` es parte de la URL pública y del contrato JSON del importador:
// NO renombrar uno ya publicado sin redirección.
// ─────────────────────────────────────────────────────────────────────────────

export interface BlogCategory {
  slug: string;
  /** Nombre visible en chips, tarjetas y breadcrumbs. */
  label: string;
  /** Frase para el hero y la meta description del índice de categoría. */
  description: string;
}

export const BLOG_CATEGORIES: BlogCategory[] = [
  {
    slug: "gestion-clinica",
    label: "Gestión de clínica",
    description:
      "Agenda, equipo, procesos y todo lo que hace que una clínica funcione sin caos.",
  },
  {
    slug: "pacientes-marketing",
    label: "Pacientes y marketing",
    description:
      "Cómo atraer pacientes nuevos, reducir ausencias y hacer que los que ya tienes regresen.",
  },
  {
    slug: "finanzas-facturacion",
    label: "Finanzas y facturación",
    description:
      "Cobranza, caja, precios y facturación electrónica explicados para dueños de clínica.",
  },
  {
    slug: "whatsapp-comunicacion",
    label: "WhatsApp y comunicación",
    description:
      "Recordatorios, confirmaciones y atención por WhatsApp sin volverte esclavo del celular.",
  },
  {
    slug: "tecnologia-ia",
    label: "Tecnología e IA",
    description:
      "Software, automatización e inteligencia artificial aplicados al día a día clínico.",
  },
  {
    slug: "normativas-mexico",
    label: "Normativas en México",
    description:
      "NOM-004, NOM-024, CFDI, COFEPRIS y protección de datos, en español claro.",
  },
  {
    slug: "especialidades",
    label: "Especialidades",
    description:
      "Guías por especialidad: dental, nutrición, fisioterapia, estética y más.",
  },
  {
    slug: "guias-comparativas",
    label: "Guías y comparativas",
    description:
      "Comparativas de herramientas y guías paso a paso para decidir con datos.",
  },
];

/** Slugs válidos — el importador y las rutas públicas validan contra esto. */
export const BLOG_CATEGORY_SLUGS: string[] = BLOG_CATEGORIES.map((c) => c.slug);

const BY_SLUG: Record<string, BlogCategory> = {};
for (let i = 0; i < BLOG_CATEGORIES.length; i++) {
  BY_SLUG[BLOG_CATEGORIES[i].slug] = BLOG_CATEGORIES[i];
}

/** Categoría por slug, o null si no está en la lista fija (→ 404 público). */
export function getBlogCategory(slug: string | null | undefined): BlogCategory | null {
  if (!slug) return null;
  return BY_SLUG[slug] ?? null;
}

/** Nombre visible; cae al propio slug si la categoría fue retirada de la lista. */
export function blogCategoryLabel(slug: string | null | undefined): string {
  if (!slug) return "General";
  return BY_SLUG[slug]?.label ?? slug;
}

export function isBlogCategory(slug: string | null | undefined): boolean {
  return !!slug && !!BY_SLUG[slug];
}
