import type { Metadata } from "next";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";
export const SITE_NAME = "DaleControl";

export type BuildMetadataOptions = {
  title: string;
  description: string;
  path: string;          // ej. "/dental" — debe iniciar con "/"
  ogImage?: string;      // ruta absoluta o relativa al sitio
  keywords?: string[];
};

export function buildMetadata(opts: BuildMetadataOptions): Metadata {
  const path = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const url = `${SITE_URL}${path}`;
  const ogImage = opts.ogImage ?? "/og/default.png";

  return {
    title: opts.title,
    description: opts.description,
    keywords: opts.keywords,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      siteName: SITE_NAME,
      locale: "es_MX",
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630, alt: opts.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [ogImage],
    },
  };
}

/* JSON-LD helpers */

export type SoftwareApplicationLd = {
  name: string;
  description: string;
  url: string;
  category: string;        // ej. "BusinessApplication"
};

export function softwareApplicationLd(opts: SoftwareApplicationLd) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    applicationCategory: opts.category,
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "419",
      priceCurrency: "MXN",
      availability: "https://schema.org/InStock",
    },
  };
}

export type MedicalBusinessLd = {
  name: string;
  description: string;
  url: string;
  medicalSpecialty?: string;  // ej. "Dentistry"
};

export function medicalBusinessLd(opts: MedicalBusinessLd) {
  return {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    ...(opts.medicalSpecialty ? { medicalSpecialty: opts.medicalSpecialty } : {}),
  };
}

export type LocalBusinessLd = {
  name: string;
  description: string;
  url: string;
  image?: string | null;
  telephone?: string | null;
  address?: { street?: string | null; city?: string | null; state?: string | null; country?: string };
  /** Promedio + total de reseñas → AggregateRating (solo si count > 0). */
  rating?: { value: number; count: number } | null;
  priceRange?: string;
};

/** LocalBusiness con AggregateRating opcional — para el perfil público de clínica. */
export function localBusinessLd(opts: LocalBusinessLd) {
  const a = opts.address;
  const hasAddress = Boolean(a && (a.street || a.city || a.state));
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    ...(opts.image ? { image: opts.image } : {}),
    ...(opts.telephone ? { telephone: opts.telephone } : {}),
    ...(opts.priceRange ? { priceRange: opts.priceRange } : {}),
    ...(hasAddress
      ? {
          address: {
            "@type": "PostalAddress",
            ...(a?.street ? { streetAddress: a.street } : {}),
            ...(a?.city ? { addressLocality: a.city } : {}),
            ...(a?.state ? { addressRegion: a.state } : {}),
            addressCountry: a?.country ?? "MX",
          },
        }
      : {}),
    ...(opts.rating && opts.rating.count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: opts.rating.value,
            reviewCount: opts.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}
