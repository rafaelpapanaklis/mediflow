import type { Metadata } from "next";
import { Inter } from "next/font/google";
import {
  Hero, SocialProofBar, Funciones, PricingSection, WhatsappCta, ModulesTrio, FeaturesGrid,
  ModulePages, Comparison, Testimonials, TrustFaq, FinalCta, ScrollReveal, TawkChat,
} from "@/components/public/landing/sales/v2";
import { buildPlanCards, cheapestFirstMonthLabel, headlineYearlyDiscount } from "@/components/public/landing/sales/v2/plan-cards";
import { FAQ_ITEMS } from "@/components/public/landing/sales/v2/landing-data";
import { SalesFooter } from "@/components/public/landing/sales/footer";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { getResolvedPlans } from "@/lib/plans";
import "@/components/public/landing/sales/v2/landing-v2.css";

// Solo los pesos que la landing usa de verdad: un grep de fontWeight sobre
// v2 + footer + nav no encuentra ni un 900 (el máximo es 800), así que ese
// @font-face sobraba.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

export const metadata: Metadata = {
  title: { absolute: "DaleControl · El software dental más completo de México" },
  description:
    "Dale control total a tu clínica: 30+ funciones en un solo lugar — agenda, WhatsApp, radiografías con IA y modelos 3D. Desde $419 al mes — y tu primer mes por solo $19.",
  keywords: [
    "software dental",
    "software para dentistas",
    "software para clínicas dentales México",
    "agenda dental",
    "expediente dental con odontograma",
    "radiografías con IA",
    "facturación CFDI 4.0 dental",
    "odontograma digital",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_MX",
    url: SITE_URL,
    siteName: "DaleControl",
    title: "DaleControl · El software dental más completo de México",
    description:
      "Dale control total a tu clínica: 30+ funciones en un solo lugar — agenda, WhatsApp, radiografías con IA y modelos 3D. Desde $419 al mes — y tu primer mes por solo $19.",
    images: [{ url: "/og/home", width: 1200, height: 630, alt: "DaleControl — software dental todo-en-uno" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DaleControl · El software dental más completo de México",
    description:
      "Dale control total a tu clínica: 30+ funciones en un solo lugar — agenda, WhatsApp, radiografías con IA y modelos 3D. Desde $419 al mes — y tu primer mes por solo $19.",
    images: ["/og/home"],
  },
};

/**
 * La página sigue siendo ESTÁTICA (SSG): la sesión sólo afecta al nav y se
 * detecta en cliente tras hidratar (nav-session.tsx). No llamar getSession()
 * aquí — leer cookies en el server volvería dynamic toda la landing.
 *
 * `revalidate`: los precios salen de `plan_configs`, que el admin edita sin
 * redeploy. Con ISR el HTML se regenera cada 10 minutos y la landing recoge el
 * cambio sola, sin perder el HTML estático que le da el CLS 0 y el LCP actual.
 */
export const revalidate = 600;

export default async function HomePage() {
  // FUENTE ÚNICA de precios/cupos: tabla plan_configs (caché 60s + fallback al
  // seed de plan-shared.ts). En la landing NO se escribe ninguna cifra a mano.
  const cards = buildPlanCards(await getResolvedPlans());
  const firstMonthFrom = cheapestFirstMonthLabel(cards);
  const yearlyDiscountPct = headlineYearlyDiscount(cards);

  // JSON-LD: Organización + producto SaaS con planes en MXN + FAQ.
  // Se conserva tal cual estaba; lo único que cambia es de DÓNDE salen los
  // datos — las ofertas leen plan_configs y el FAQPage se genera del MISMO
  // array que pinta el acordeón, para que el marcado nunca declare preguntas
  // que no estén visibles en la página (requisito de Google para FAQPage).
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "DaleControl",
        url: SITE_URL,
        description: "Software de gestión para clínicas dentales en México.",
        areaServed: "MX",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "DaleControl",
        inLanguage: "es-MX",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        name: "DaleControl",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "es-MX",
        // La IA solo analiza radiografías 2D; el CBCT 3D es visor (sin IA).
        description:
          "Plataforma todo-en-uno para clínicas dentales: agenda con WhatsApp, expediente con odontograma, CBCT 3D, análisis de radiografías con IA y facturación.",
        offers: cards.map((c) => ({
          "@type": "Offer",
          name: c.name,
          price: String(c.monthly),
          priceCurrency: "MXN",
          category: "Suscripción mensual",
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ_ITEMS.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: typeof item.a === "function" ? item.a(firstMonthFrom) : item.a,
          },
        })),
      },
    ],
  };

  return (
    <div
      className={`dcv4-root ${inter.variable}`}
      style={{
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, -apple-system, sans-serif",
        color: "#0f172a",
        background: "#fff",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <a href="#mfh-main" className="mf-skip-link">Saltar al contenido</a>
      <SalesNavSession />
      <main id="mfh-main">
        <Hero firstMonthFrom={firstMonthFrom} />
        <SocialProofBar />
        <Funciones />
        <PricingSection cards={cards} firstMonthFrom={firstMonthFrom} yearlyDiscountPct={yearlyDiscountPct} />
        <WhatsappCta />
        <ModulesTrio />
        <FeaturesGrid />
        <ModulePages />
        <Comparison />
        <Testimonials />
        <TrustFaq firstMonthFrom={firstMonthFrom} />
        <FinalCta firstMonthFrom={firstMonthFrom} />
      </main>
      <SalesFooter />
      <ScrollReveal />
      <TawkChat />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
