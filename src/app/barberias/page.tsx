import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { makeBarberT } from "@/lib/barber/i18n";
import { getBarberPlans } from "@/lib/barber/plans";
import { BARBER_FEATURES, isBarberUnlimited } from "@/lib/barber/plan-shared";
import { SITE_URL } from "@/lib/seo";
import {
  BARBER_LANDING_EXAMPLE_VISITS,
  BARBER_LANDING_FAQ_KEYS,
  BARBER_LANDING_PATH,
  BARBER_PRODUCT_NAME,
  BARBER_REGISTER_PATH,
  activeBarberPlans,
  barberFromPriceLabel,
  barberPlanRequiredFor,
  buildBarberPlanCards,
  cheapestBarberPlan,
  estimateBarberReminderCost,
  formatUsd,
  serializeBarberJsonLd,
} from "@/lib/barber/marketing";
import { BarberLandingNav } from "@/components/public/barberias/nav";
import { BarberHero } from "@/components/public/barberias/hero";
import { BarberProblem } from "@/components/public/barberias/problem";
import { BarberFeatures } from "@/components/public/barberias/features";
import { BarberWhatsappBand } from "@/components/public/barberias/whatsapp-band";
import { BarberPricing } from "@/components/public/barberias/pricing";
import { BarberFaq, type BarberFaqItem } from "@/components/public/barberias/faq";
import { BarberFinalCta } from "@/components/public/barberias/final-cta";
import { BarberFooter } from "@/components/public/barberias/footer";
import { BarberReveal } from "@/components/public/barberias/reveal";
import "@/components/public/barberias/barberias.css";

/* ═══════════════════════════════════════════════════════════════════════
   /barberias — la landing que convierte a una barbería en cliente.

   ── CADA LÍNEA SE VERIFICÓ CONTRA EL PANEL ────────────────────────────
   Las promesas viven en src/lib/barber/marketing.ts con los archivos donde
   se comprobaron; el copy en src/i18n/dictionaries/barber/landing.es.json.
   Lo que el panel no hace hoy (cobro del anticipo en línea, CFDI, app
   nativa, marketplace, terminal física) NO se anuncia.

   ── PRECIOS: DE LA TABLA, SIEMPRE ─────────────────────────────────────
   getBarberPlans() lee barber_plan_configs (caché 60 s + fallback al seed).
   Rafael cambia un precio editando la fila y esta página lo recoge sola:
   es ESTÁTICA con ISR de 10 min, igual que la landing dental. Por eso no
   lee cookies ni searchParams (volvería dinámica la ruta y perdería el HTML
   pre-renderizado que le da el LCP y el CLS 0).

   ── TIPOGRAFÍA: LA MISMA QUE EL RESTO DEL SITIO PÚBLICO ───────────────
   La landing dental (src/app/page.tsx) y todas las páginas públicas cargan
   Inter por página con next/font y la fijan en su raíz; el layout raíz
   solo aporta IBM Plex (el panel) y Hanken (el wordmark). Aquí se hace lo
   mismo: Inter en los mismos pesos que el home (400–800, mismos archivos →
   misma caché) y, como voz propia del vertical, Bebas Neue para letreros e
   insignias. Los archivos se autoalojan en /_next/static/media y se
   precargan; display: fallback (ver abajo por qué no swap).

   ── IDIOMA ────────────────────────────────────────────────────────────
   El diccionario existe en es y en (barber.landing.*), pero la página pinta
   es-MX: una superficie pública no tiene de dónde leer el locale (no hay
   sesión) y leer Accept-Language la volvería dinámica. Mismo criterio que
   las páginas públicas del dental.
   ═══════════════════════════════════════════════════════════════════════ */

// display: "fallback" y no "swap": 100 ms de bloqueo y luego, si la fuente
// no llegó, el respaldo ajustado. En la práctica el archivo (precargado,
// 50 KB) ya está cuando se pinta el primer frame y el H1 nace en Inter: sin
// el re-layout del swap ni el salto de líneas que daba CLS 0.18 en móvil.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-inter",
  display: "fallback",
});

// Letrero de barbería: un solo peso, solo para etiquetas e insignias.
const sign = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-sign",
  display: "fallback",
});

export const revalidate = 600;

const LOCALE = "es";

function landingT() {
  return makeBarberT(getBarberDict(LOCALE), "barber.landing");
}

export async function generateMetadata(): Promise<Metadata> {
  const t = landingT();
  const plans = await getBarberPlans();
  const from = barberFromPriceLabel(plans);
  const title = t("meta.title");
  const description = t("meta.description", { from });
  const url = `${SITE_URL}${BARBER_LANDING_PATH}`;
  return {
    title: { absolute: title },
    description,
    keywords: [
      "software para barberías",
      "agenda para barbería",
      "WhatsApp para barberías",
      "sistema para barbería",
      "fila virtual barbería",
      "caja para barbería",
      "comisiones de barberos",
      "reservas en línea barbería",
    ],
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    // La imagen la aporta opengraph-image.tsx / twitter-image.tsx (convención
    // de archivo de Next): no se declara aquí para no duplicarla.
    openGraph: {
      type: "website",
      locale: "es_MX",
      url,
      siteName: BARBER_PRODUCT_NAME,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BarberiasLandingPage() {
  const t = landingT();
  const plans = await getBarberPlans();
  const active = activeBarberPlans(plans);
  const cards = buildBarberPlanCards(plans);
  const from = barberFromPriceLabel(plans);
  const cheapest = cheapestBarberPlan(plans);
  const cost = estimateBarberReminderCost(BARBER_LANDING_EXAMPLE_VISITS);
  const inboxPlan = barberPlanRequiredFor(plans, "whatsappInbox");
  const botPlan = barberPlanRequiredFor(plans, "whatsappBot");
  const url = `${SITE_URL}${BARBER_LANDING_PATH}`;

  // Variables de las respuestas del FAQ: todas derivadas de la tabla o de
  // las constantes del panel, ninguna escrita aquí.
  const basicQuota = cheapest
    ? isBarberUnlimited(cheapest.messageQuota)
      ? t("pricing.limits.messagesUnlimited")
      : t("pricing.limits.messages", { count: cheapest.messageQuota })
    : "";
  const basicLimit = cheapest
    ? isBarberUnlimited(cheapest.maxBarbers)
      ? t("pricing.limits.barbersUnlimited")
      : t("pricing.limits.barbers", { count: cheapest.maxBarbers })
    : "";
  const faqVars = {
    basicPlan: cheapest ? cheapest.name : "",
    basicQuota,
    basicLimit,
    usd: formatUsd(cost.perMessageUsd),
    visits: cost.visits,
    mxn: cost.mxn,
  };

  const faqItems: BarberFaqItem[] = BARBER_LANDING_FAQ_KEYS.map((key) => {
    const base = `faq.items.${key}`;
    let a = t(`${base}.a`, faqVars);
    if (key === "whatsapp") {
      if (inboxPlan) a += ` ${t(`${base}.aInbox`, { inboxPlan: inboxPlan.name })}`;
      if (botPlan) a += ` ${t(`${base}.aBot`, { botPlan: botPlan.name })}`;
    }
    return { key, q: t(`${base}.q`), a };
  });

  // JSON-LD: el producto con sus tres ofertas (de la tabla) + el FAQ con
  // EXACTAMENTE los textos que se pintan. Nunca nada médico.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#software`,
        name: BARBER_PRODUCT_NAME,
        url,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "es-MX",
        description: t("meta.description", { from }),
        featureList: BARBER_FEATURES.map((f) => t(`pricing.features.${f.key}`)),
        offers: active.map((p) => ({
          "@type": "Offer",
          name: p.name,
          price: String(p.priceMonthly),
          priceCurrency: "MXN",
          category: t("meta.offerCategory"),
          availability: "https://schema.org/InStock",
          url: `${SITE_URL}${BARBER_REGISTER_PATH}`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeBarberJsonLd(jsonLd) }}
      />
      <div className={`dcbl ${inter.variable} ${sign.variable}`}>
        <BarberLandingNav t={t} />
        <main>
          <BarberHero t={t} from={from} />
          <BarberProblem t={t} />
          <BarberFeatures t={t} plans={plans} />
          <BarberWhatsappBand t={t} plans={plans} cost={cost} />
          <BarberPricing t={t} cards={cards} />
          <BarberFaq t={t} items={faqItems} />
          <BarberFinalCta t={t} />
        </main>
        <BarberFooter t={t} year={new Date().getFullYear()} />
        <BarberReveal />
      </div>
    </>
  );
}
