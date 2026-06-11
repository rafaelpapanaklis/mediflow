import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClinicLandingServer } from "./clinic-landing-server";
import type { Metadata } from "next";
import {
  getSpecialty,
  SPECIALTY_SLUGS,
} from "@/lib/specialty-data";
import { SpecNavSession } from "@/components/public/landing/nav-session";
import { SpecFAQ } from "@/components/public/landing/specialty/spec-faq";
import { SpecFeatures } from "@/components/public/landing/specialty/spec-features";
import { SpecFinalCTA } from "@/components/public/landing/specialty/spec-final-cta";
import { SpecHero } from "@/components/public/landing/specialty/spec-hero";
import { SpecMockupShowcase } from "@/components/public/landing/specialty/spec-mockup-showcase";
import { SpecPricing } from "@/components/public/landing/specialty/spec-pricing";
import { SpecRelated } from "@/components/public/landing/specialty/spec-related";
import { SpecTestimonial } from "@/components/public/landing/specialty/spec-testimonial";
import { Footer } from "@/components/public/landing/footer";
import {
  buildMetadata,
  softwareApplicationLd,
  medicalBusinessLd,
  SITE_URL,
} from "@/lib/seo";
// Las 17 landings de especialidad se pre-renderizan en build
// (generateStaticParams) y revalidan cada 5 min (ISR). La sesión ya no se lee
// en el server: el nav la detecta client-side (nav-session.tsx). Las landings
// de clínica también son ISR — por eso esta ruta NO lee searchParams (leerlos
// durante la regeneración estática lanza DYNAMIC_SERVER_USAGE → 500). La
// vista previa de plantillas (?preview=) vive en /landing-preview/[slug].
export const revalidate = 300;

/** Slugs reservados top-level que [slug] nunca intenta resolver. */
const NON_SPECIALTY_RESERVED = [
  "dashboard","admin","api","auth","login","register",
  "pricing","features","contact","consentimiento","portal",
  "reservar","pago","consent","clinicas","teleconsulta","roadmap",
  "socio","afiliados","laboratorios","proveedores","signup",
  "paciente","landing-preview",
];

interface Props { params: { slug: string } }

export function generateStaticParams() {
  return SPECIALTY_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // 1) Specialty landing (Claude Design — 17 especialidades)
  const specialty = getSpecialty(params.slug);
  if (specialty) {
    return buildMetadata({
      title: `${specialty.name} · DaleControl`,
      description: specialty.heroSub,
      path: `/${specialty.slug}`,
      ogImage: `/og/${specialty.slug}`,
      keywords: [specialty.name, specialty.category, "software clínica México", "CFDI", "expediente electrónico"],
    });
  }

  // 2) Clínica
  const clinic = await prisma.clinic.findUnique({
    where: { slug: params.slug },
    select: { name: true, description: true, logoUrl: true },
  });
  if (!clinic) return { title: "Clínica no encontrada" };
  return {
    title: `${clinic.name} — Agenda tu cita en línea`,
    description: clinic.description ?? `Agenda tu cita en ${clinic.name}`,
    openGraph: { images: clinic.logoUrl ? [clinic.logoUrl] : [] },
  };
}

export default async function ClinicLandingPage({ params }: Props) {
  // 1) Reserved slugs
  if (NON_SPECIALTY_RESERVED.includes(params.slug)) notFound();

  // 2) Specialty landing (Claude Design)
  const specialty = getSpecialty(params.slug);
  if (specialty) {
    const url = `${SITE_URL}/${specialty.slug}`;
    const ldBlocks: object[] = [
      softwareApplicationLd({
        name: `DaleControl para ${specialty.name}`,
        description: specialty.heroSub,
        url,
        category: "HealthApplication",
      }),
      medicalBusinessLd({
        name: `DaleControl — software para ${specialty.name.toLowerCase()}`,
        description: specialty.heroSub,
        url,
        medicalSpecialty: specialty.category,
      }),
    ];
    // Composición inline de SpecialtyPage con el nav client-aware: las
    // secciones siguen siendo server components (cero JS extra) y solo el
    // SpecNav decide su CTA leyendo la cookie sb-* tras hidratar.
    return (
      <>
        {ldBlocks.map((ld, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
          />
        ))}
        <div className="landing-theme" data-mode="dark" style={{ minHeight: "100vh" }}>
          <SpecNavSession currentSlug={specialty.slug} />
          <SpecHero spec={specialty} />
          <SpecFeatures spec={specialty} />
          <SpecMockupShowcase spec={specialty} />
          <SpecTestimonial spec={specialty} />
          <SpecPricing spec={specialty} />
          <SpecFAQ spec={specialty} />
          <SpecFinalCTA spec={specialty} />
          <SpecRelated currentSlug={specialty.slug} />
          <Footer />
        </div>
      </>
    );
  }

  // 3) Clínica (landing pública) — rama compartida con /landing-preview/[slug]
  return <ClinicLandingServer slug={params.slug} />;
}
