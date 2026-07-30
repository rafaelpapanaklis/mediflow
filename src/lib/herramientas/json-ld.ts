import { SITE_URL } from "@/lib/seo";
import type { BlogFaqItem } from "@/lib/blog/types";
import { HERRAMIENTAS_PUBLISHED_AT, type Herramienta } from "./data";

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD de las herramientas gratuitas.
//
// Tres bloques por página, construidos aquí para que las 5 fichas no repitan el
// mismo objeto a mano (y para que un cambio de schema se haga en un solo lugar):
//
//   · WebApplication → es una app que corre en el navegador, gratis (price 0).
//   · FAQPage        → las 3 preguntas de la ficha.
//   · BreadcrumbList → Inicio › Herramientas gratuitas › la herramienta.
//
// No hay Product ni SoftwareApplication con precio: estas páginas no venden
// nada, y marcar una herramienta gratis con el precio del plan sería mentirle
// al rich result.
// ─────────────────────────────────────────────────────────────────────────────

export function toolUrl(tool: Herramienta): string {
  return `${SITE_URL}/herramientas/${tool.slug}`;
}

/** OG dinámica — la misma ruta que usan el blog y los casos de uso. */
export function toolOgUrl(title: string): string {
  return `${SITE_URL}/og/blog?title=${encodeURIComponent(title.slice(0, 110))}`;
}

export function toolWebAppLd(tool: Herramienta, featureList: string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.name,
    description: tool.metaDescription,
    url: toolUrl(tool),
    applicationCategory: "HealthApplication",
    operatingSystem: "Web",
    browserRequirements: "Requiere un navegador con JavaScript",
    inLanguage: "es-MX",
    isAccessibleForFree: true,
    datePublished: HERRAMIENTAS_PUBLISHED_AT,
    image: [toolOgUrl(tool.headline)],
    featureList,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "MXN",
      availability: "https://schema.org/InStock",
    },
    publisher: { "@type": "Organization", name: "DaleControl", url: SITE_URL },
  };
}

export function toolFaqLd(faq: BlogFaqItem[]) {
  if (faq.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function toolBreadcrumbLd(tool: Herramienta) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Herramientas gratuitas",
        item: `${SITE_URL}/herramientas`,
      },
      { "@type": "ListItem", position: 3, name: tool.name, item: toolUrl(tool) },
    ],
  };
}
