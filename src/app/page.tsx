import type { Metadata } from "next";
import { Inter } from "next/font/google";
import {
  Hero, SocialProofBar, Spotlights, ModulesTrio, FeaturesGrid,
  Comparison, Testimonials, PricingSection, TrustFaq, FinalCta, TawkChat,
} from "@/components/public/landing/sales/v2";
import { SalesFooter } from "@/components/public/landing/sales/footer";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import "@/components/public/landing/sales/v2/landing-v2.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

export const metadata: Metadata = {
  title: { absolute: "DaleControl — Software dental todo-en-uno para clínicas en México" },
  description:
    "Agenda con WhatsApp, expediente con odontograma, radiografías 3D con IA y facturación para clínicas dentales en México. Todo desde tu navegador, en español y en pesos.",
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
    title: "DaleControl — Software dental todo-en-uno para clínicas en México",
    description:
      "Agenda, expediente con odontograma, radiografías 3D con IA y WhatsApp para clínicas dentales en México.",
    images: [{ url: "/og-home.png", width: 1200, height: 630, alt: "DaleControl — software dental todo-en-uno" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DaleControl — Software dental para clínicas en México",
    description:
      "Agenda con WhatsApp, odontograma, radiografías 3D con IA y facturación. Todo en una sola plataforma.",
    images: ["/og-home.png"],
  },
};

// JSON-LD: Organización + producto SaaS con planes en MXN + FAQ (copy real de la landing).
const JSON_LD = {
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
      description:
        "Plataforma todo-en-uno para clínicas dentales: agenda con WhatsApp, expediente con odontograma, radiografías 3D con IA y facturación.",
      offers: [
        { "@type": "Offer", name: "Básico", price: "499", priceCurrency: "MXN", category: "Suscripción mensual" },
        { "@type": "Offer", name: "Profesional", price: "999", priceCurrency: "MXN", category: "Suscripción mensual" },
        { "@type": "Offer", name: "Clínica", price: "1999", priceCurrency: "MXN", category: "Suscripción mensual" },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "¿Mis datos y los de mis pacientes están seguros?",
          acceptedAnswer: { "@type": "Answer", text: "Sí. Toda la información viaja y se guarda cifrada, hacemos respaldos diarios automáticos y cada movimiento del staff queda registrado en una bitácora de auditoría. Además puedes activar verificación en dos pasos (2FA) para tu equipo." },
        },
        {
          "@type": "Question",
          name: "¿Puedo migrar desde mi sistema anterior o desde Excel?",
          acceptedAnswer: { "@type": "Answer", text: "Sí. Con \"Importar mi clínica\" traes tus pacientes, citas e historiales desde tu software anterior o desde hojas de Excel, con nuestro acompañamiento durante la migración." },
        },
        {
          "@type": "Question",
          name: "¿Hay permanencia o contrato anual?",
          acceptedAnswer: { "@type": "Answer", text: "No. Los planes son mes a mes y puedes cancelar cuando quieras. Si eliges el plan anual solo es para obtener el 30% de descuento, no por obligación contractual." },
        },
        {
          "@type": "Question",
          name: "¿Necesito instalar algo o comprar equipo?",
          acceptedAnswer: { "@type": "Answer", text: "No. DaleControl funciona 100% en el navegador — incluso el visor de radiografías CBCT y los modelos 3D. Solo necesitas internet y el equipo que ya tienes." },
        },
      ],
    },
  ],
};

// Página 100% estática (SSG): la sesión solo afecta al nav y se detecta
// client-side tras hidratar (nav-session.tsx). No llamar getSession() aquí —
// leer cookies en el server volvería dynamic toda la landing.
export default function HomePage() {
  return (
    <div
      className={inter.variable}
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
        <Hero />
        <SocialProofBar />
        <Spotlights />
        <ModulesTrio />
        <FeaturesGrid />
        <Comparison />
        <Testimonials />
        <PricingSection />
        <TrustFaq />
        <FinalCta />
      </main>
      <SalesFooter />
      <TawkChat />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
    </div>
  );
}
