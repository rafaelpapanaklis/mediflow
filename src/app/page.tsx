import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AnnouncementBar } from "@/components/public/landing/announcement-bar";
import { Header } from "@/components/public/landing/header";
import { Hero } from "@/components/public/landing/hero";
import { SocialProof } from "@/components/public/landing/social-proof";
import { Features } from "@/components/public/landing/features";
import { Steps } from "@/components/public/landing/steps";
import { Comparison } from "@/components/public/landing/comparison";
import { Testimonials } from "@/components/public/landing/testimonials";
import { Pricing } from "@/components/public/landing/pricing";
import { Trust } from "@/components/public/landing/trust";
import { FAQ } from "@/components/public/landing/faq";
import { FinalCTA } from "@/components/public/landing/final-cta";
import { Footer } from "@/components/public/landing/footer";
import { HOME_FAQS } from "@/components/public/landing/faq-data";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import { getSession } from "@/lib/auth";

// Fuentes de la HOME (solo aquí, sin tocar el layout raíz que usa el panel):
// Inter para todo y JetBrains Mono para eyebrows/labels. Se exponen como
// variables CSS y se mapean a --font-sans/--font-mono bajo data-mode="dovetail".
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter-home", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-jbm-home", display: "swap" });

// getSession lee cookies → la landing pasa a dynamic. El contenido renderizado
// es idéntico para SEO (los bots sin cookies ven el flujo no-logueado).
export const dynamic = "force-dynamic";

const HOME_TITLE = "MediFlow — Software para clínicas dentales en México";
const HOME_DESC =
  "Deja de hacer malabares con otros software, WhatsApp, Excel y un facturador aparte. MediFlow reúne agenda, expediente con odontograma, radiografías con IA, facturación CFDI 4.0 y WhatsApp en una sola plataforma para clínicas dentales mexicanas.";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESC,
  keywords: [
    "software dental",
    "software para dentistas México",
    "expediente dental con odontograma",
    "radiografías dentales con IA",
    "facturación CFDI 4.0 dental",
    "agenda dental con WhatsApp",
    "software para consultorio dental",
  ],
  alternates: { canonical: SITE_URL + "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "es_MX",
    url: SITE_URL + "/",
    siteName: SITE_NAME,
    title: HOME_TITLE,
    description: HOME_DESC,
  },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESC },
};

// JSON-LD: Organization + WebSite + SoftwareApplication (AggregateOffer MXN que
// refleja los 3 planes visibles) + FAQPage (mismo contenido que el acordeón).
function jsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": SITE_URL + "/#organization",
        name: SITE_NAME,
        url: SITE_URL + "/",
        description: HOME_DESC,
        slogan: "El software todo-en-uno para clínicas dentales mexicanas",
        areaServed: { "@type": "Country", name: "México" },
      },
      {
        "@type": "WebSite",
        "@id": SITE_URL + "/#website",
        url: SITE_URL + "/",
        name: SITE_NAME,
        inLanguage: "es-MX",
        publisher: { "@id": SITE_URL + "/#organization" },
      },
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: SITE_URL + "/",
        description: HOME_DESC,
        inLanguage: "es-MX",
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "MXN",
          lowPrice: "499",
          highPrice: "1999",
          offerCount: "3",
          availability: "https://schema.org/InStock",
        },
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "812" },
      },
      {
        "@type": "FAQPage",
        "@id": SITE_URL + "/#faq",
        mainEntity: HOME_FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}

export default async function HomePage() {
  const user = await getSession();
  const isLoggedIn = user !== null && user !== undefined;

  return (
    <div
      className={`landing-theme ${inter.variable} ${jbmono.variable}`}
      data-mode="dovetail"
      style={{ minHeight: "100vh" }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
      />
      <AnnouncementBar />
      <Header isLoggedIn={isLoggedIn} />
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <Steps />
        <Comparison />
        <Testimonials />
        <Pricing />
        <Trust />
        <FAQ />
      </main>
      <FinalCTA />
      <Footer />
    </div>
  );
}
