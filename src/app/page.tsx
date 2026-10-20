import type { Metadata } from "next";
import { inter } from "@/fonts/inter-400-800";
import {
  Hero, SocialProofBar, Funciones, PricingSection, WhatsappCta,
  Comparison, Testimonials, TrustFaq, FinalCta, ScrollReveal, WhatsappWidget,
  PanelVivoSection, WhatsappMpSection, FranjaSeguridad, BarraMovil,
} from "@/components/public/landing/sales/v2";
import { buildPlanCards, cheapestFirstMonthLabel, headlineYearlyDiscount } from "@/components/public/landing/sales/v2/plan-cards";
import { FAQ_ITEMS } from "@/components/public/landing/sales/v2/landing-data";
import { SalesFooter } from "@/components/public/landing/sales/footer";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { getResolvedPlans } from "@/lib/plans";
import { TodoElPanel } from "@/components/public/landing/sales/v2/todo-el-panel";
import "@/components/public/landing/sales/v2/landing-v2.css";
import { serializeJsonLd } from "@/lib/json-ld";
import { SAME_AS, TITULO_PORTADA, descripcionPortada } from "@/components/public/landing/sales/v2/portada-seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

/**
 * 12-oct-2026 (ws1-t4, encargo de ws7, punto 3c): la descripción pasó de 167 a
 * 140 caracteres y el precio del primer mes sale de plan_configs (antes iban
 * dos precios escritos a mano). getResolvedPlans cachea 60 s: la segunda
 * llamada (la de la página) no vuelve a la base.
 */
export async function generateMetadata(): Promise<Metadata> {
  const description = descripcionPortada(cheapestFirstMonthLabel(buildPlanCards(await getResolvedPlans())));
  return {
    ...metadataFija,
    description,
    openGraph: { ...metadataFija.openGraph, description },
    twitter: { ...metadataFija.twitter, description },
  };
}

const metadataFija = {
  title: { absolute: TITULO_PORTADA },
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
    title: TITULO_PORTADA,
    images: [{ url: "/og/home", width: 1200, height: 630, alt: "DaleControl — software dental todo-en-uno" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO_PORTADA,
    images: ["/og/home"],
  },
} satisfies Metadata;

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
        // 12-oct-2026 (ws7, punto 3f): perfiles oficiales — portada-seo.ts.
        sameAs: SAME_AS,
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
      <SalesNavSession portada />
      <main id="mfh-main">
        <Hero firstMonthFrom={firstMonthFrom} />
        <SocialProofBar />
        {/* Rediseño 24/25-sep-2026: lo que la portada no enseñaba. Alternan
            clara (el panel en vivo, grabado del panel real) → oscura
            (WhatsApp + Mercado Pago), y siguen las «Funciones» de siempre.
            La demo de Sabina y el recorrido del paciente quedaron fuera de la
            portada (ajuste 2); sus archivos siguen en el repo sin usar. */}
        <PanelVivoSection />
        <WhatsappMpSection />
        <Funciones />
        <PricingSection cards={cards} firstMonthFrom={firstMonthFrom} yearlyDiscountPct={yearlyDiscountPct} />
        {/* 7-oct-2026 (ws1-t10, pedido de Rafael): la banda «¿Tienes dudas?
            Escríbenos por WhatsApp» va JUSTO ARRIBA de la franja de seguridad.
            4-oct-2026 (ws1-t10): franja de seguridad en el sitio de las píldoras
            con palomita que cerraban Precios. Sección propia y de servidor: su
            marcado no entra al bundle de cliente de Precios. */}
        <WhatsappCta />
        <FranjaSeguridad />
        {/* Ajuste 1 (25-sep-2026, ws1-t4): el trío oscuro, «Y todo lo demás,
            incluido» y «Conoce cada módulo a fondo» se juntan en UNA sección
            (la laptop con el panel grabado). modules-trio, features-grid y
            module-pages siguen en el repo sin montar. */}
        <TodoElPanel />
        <Comparison firstMonthFrom={firstMonthFrom} />
        <Testimonials />
        <TrustFaq firstMonthFrom={firstMonthFrom} />
        <FinalCta firstMonthFrom={firstMonthFrom} />
      </main>
      <SalesFooter portada />
      {/* 11-oct-2026 (ws1-t4, encargo de ws7): barra fija «Empezar · WhatsApp»
          solo en celular; va después del footer para que su espaciador quede
          al final del flujo. El botón flotante de WhatsApp (WhatsappWidget) en móvil se
          asienta encima de ella. */}
      <BarraMovil />
      <ScrollReveal />
      <WhatsappWidget />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
    </div>
  );
}
