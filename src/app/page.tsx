import type { Metadata } from "next";
import { Inter } from "next/font/google";
import {
  SalesHero, SocialProof, FeaturesGrid, Spotlights,
  Comparison, Testimonials, Pricing, TrustFaq, FinalCta, SalesFooter,
} from "@/components/public/landing/sales";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import "@/components/public/landing/sales/sales.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mediflow-pi.vercel.app";

export const metadata: Metadata = {
  title: { absolute: "MediFlow — Software dental todo-en-uno para clínicas en México" },
  description:
    "Agenda con WhatsApp, expediente con odontograma, radiografías con IA y facturación CFDI 4.0 para clínicas dentales en México. Todo en una sola plataforma.",
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
    siteName: "MediFlow",
    title: "MediFlow — Software dental todo-en-uno para clínicas en México",
    description:
      "Agenda, expediente con odontograma, radiografías con IA y facturación CFDI 4.0 para clínicas dentales en México.",
    images: [{ url: "/og-home.png", width: 1200, height: 630, alt: "MediFlow — software dental todo-en-uno" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MediFlow — Software dental para clínicas en México",
    description:
      "Agenda con WhatsApp, odontograma, radiografías con IA y CFDI 4.0. Todo en una sola plataforma.",
    images: ["/og-home.png"],
  },
};

// JSON-LD: Organización + producto SaaS con planes en MXN + FAQ.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "MediFlow",
      url: SITE_URL,
      description: "Software de gestión para clínicas dentales en México.",
      areaServed: "MX",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "MediFlow",
      inLanguage: "es-MX",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "MediFlow",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "es-MX",
      description:
        "Plataforma todo-en-uno para clínicas dentales: agenda con WhatsApp, expediente con odontograma, radiografías con IA y facturación CFDI 4.0.",
      offers: [
        { "@type": "Offer", name: "Basic", price: "499", priceCurrency: "MXN", category: "Suscripción mensual" },
        { "@type": "Offer", name: "Pro", price: "999", priceCurrency: "MXN", category: "Suscripción mensual" },
        { "@type": "Offer", name: "Clinic", price: "1999", priceCurrency: "MXN", category: "Suscripción mensual" },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "¿Las facturas son CFDI 4.0 válidas ante el SAT?",
          acceptedAnswer: { "@type": "Answer", text: "Sí. Generas y timbras CFDI 4.0 directamente desde el cobro, con RFC, uso de CFDI y método de pago." },
        },
        {
          "@type": "Question",
          name: "¿Pueden migrar mis datos de Excel o de otro sistema?",
          acceptedAnswer: { "@type": "Answer", text: "Sí. Te acompañamos en la migración de pacientes, citas e historial sin costo adicional." },
        },
        {
          "@type": "Question",
          name: "¿Hay permanencia o contrato forzoso?",
          acceptedAnswer: { "@type": "Answer", text: "No. Trabajamos sin permanencia: puedes cambiar de plan o cancelar cuando quieras." },
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
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <a href="#mfh-main" className="mf-skip-link">Saltar al contenido</a>
      <SalesNavSession />
      <main id="mfh-main">
        <SalesHero />
        <SocialProof />
        <FeaturesGrid />
        <Spotlights />
        <Comparison />
        <Testimonials />
        <Pricing />
        <TrustFaq />
        <FinalCta />
      </main>
      <SalesFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
    </div>
  );
}
