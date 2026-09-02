import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import {
  EDU_LANDING_DINERO,
  EDU_LANDING_EXPEDIENTE,
  EDU_LANDING_FAQ,
  EDU_LANDING_SEDES,
  EDU_LANDING_SEO,
  EDU_PRODUCT_NAME,
  serializeEduJsonLd,
} from "@/lib/edu/marketing";
import { eduLandingUrl } from "@/lib/edu/seo";
import { EduNav } from "@/components/public/instituciones/nav";
import { EduHero } from "@/components/public/instituciones/hero";
import {
  SeccionDinero,
  SeccionExpediente,
  SeccionFlujo,
  SeccionProblema,
  SeccionRoles,
  SeccionSedes,
} from "@/components/public/instituciones/secciones";
import { SeccionCierre, SeccionFaq, SeccionPlan } from "@/components/public/instituciones/plan";
import { EduFooter } from "@/components/public/instituciones/footer";
import { EduReveal } from "@/components/public/instituciones/reveal";
import "@/components/public/instituciones/instituciones.css";

/* ═══════════════════════════════════════════════════════════════════════
   /instituciones — la landing de DaleControl Institucional.

   ── CADA AFIRMACIÓN SE VERIFICÓ CONTRA EL PANEL ───────────────────────
   Las promesas y TODO el texto viven en src/lib/edu/marketing.ts, cada una
   con los archivos donde se comprobó (`verifiedIn`). La prueba
   src/lib/edu/__tests__/edu-landing.test.ts exige que esos archivos
   existan, que ninguna promesa sin código deje de declararse como término
   de contrato, y que la página no diga ninguna de las cosas que este
   producto no puede sostener.

   ── CERO PRECIOS ──────────────────────────────────────────────────────
   La licencia es ANUAL POR INSTITUCIÓN y se cotiza según el tamaño de la
   escuela. Ese número lo dice el manager asignado, no una página que lee
   cualquiera: la prueba busca cualquier cifra de dinero en todos los
   archivos de la landing y falla si aparece.

   ── ESTÁTICA ──────────────────────────────────────────────────────────
   No lee base de datos, ni cookies, ni searchParams (leer cualquiera de
   las dos últimas volvería dinámica la ruta y perdería el HTML
   pre-renderizado que le da el LCP y el CLS 0). Se revalida cada 24 h
   nada más para que el año del pie no se quede clavado en el del último
   despliegue.

   ── TIPOGRAFÍA ────────────────────────────────────────────────────────
   Inter en tres de los cinco pesos que ya carga el home del sitio (400,
   600 y 700): mismos archivos, misma caché. Y como voz propia del
   vertical, Source Serif 4 en los titulares — una romana de lectura, que
   es lo que distingue a una escuela de una barbería y de un consultorio.
   Las dos se autoalojan en /_next/static/media.

   `display: "fallback"` y no "swap": 100 ms de bloqueo y luego el respaldo
   ajustado. En la práctica el archivo precargado ya está cuando se pinta
   el primer cuadro y el H1 nace en su tipografía, sin el re-cálculo de
   líneas del swap.

   ── IDIOMA ────────────────────────────────────────────────────────────
   es-MX y nada más: es una superficie pública sin sesión de la que leer un
   idioma, y leer Accept-Language la volvería dinámica. Mismo criterio que
   el resto de las páginas públicas.
   ═══════════════════════════════════════════════════════════════════════ */

const inter = Inter({
  subsets: ["latin"],
  // Tres pesos y no cuatro: cada peso es un archivo que hay que descargar
  // antes de que el texto se asiente, y el 800 se usaba en un solo sitio.
  weight: ["400", "600", "700"],
  variable: "--font-inter-edu",
  display: "fallback",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["600"],
  style: ["normal", "italic"],
  variable: "--font-serif-edu",
  display: "fallback",
});

export const revalidate = 86400;

export function generateMetadata(): Metadata {
  const url = eduLandingUrl();
  return {
    title: { absolute: EDU_LANDING_SEO.title },
    description: EDU_LANDING_SEO.description,
    keywords: [...EDU_LANDING_SEO.keywords],
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    // La imagen la aportan opengraph-image.tsx / twitter-image.tsx
    // (convención de archivo de Next): no se declara aquí para no duplicarla.
    openGraph: {
      type: "website",
      locale: "es_MX",
      url,
      siteName: EDU_PRODUCT_NAME,
      title: EDU_LANDING_SEO.title,
      description: EDU_LANDING_SEO.description,
    },
    twitter: {
      card: "summary_large_image",
      title: EDU_LANDING_SEO.title,
      description: EDU_LANDING_SEO.description,
    },
  };
}

export default function InstitucionesLandingPage() {
  const url = eduLandingUrl();

  /**
   * Datos estructurados: el producto y el bloque de preguntas.
   *
   * · SoftwareApplication SIN `offers`: una oferta obliga a declarar precio
   *   y aquí no hay ninguno que declarar. Inventar uno para que el marcado
   *   se vea completo sería exactamente la mentira que esta página evita.
   * · FAQPage con EXACTAMENTE los textos que se pintan — los dos leen la
   *   misma lista, que es lo que Google exige.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#software`,
        name: EDU_PRODUCT_NAME,
        url,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Software para clínica universitaria de odontología",
        operatingSystem: "Web",
        inLanguage: "es-MX",
        description: EDU_LANDING_SEO.description,
        audience: {
          "@type": "EducationalAudience",
          educationalRole: "Escuela de especialidades odontológicas",
        },
        featureList: [
          ...EDU_LANDING_EXPEDIENTE.items,
          ...EDU_LANDING_DINERO.items,
          ...EDU_LANDING_SEDES.items,
        ].map((i) => i.titulo),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: EDU_LANDING_FAQ.map((item) => ({
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
        dangerouslySetInnerHTML={{ __html: serializeEduJsonLd(jsonLd) }}
      />
      <div className={`dcei ${inter.variable} ${serif.variable}`}>
        <EduNav />
        <main>
          <EduHero />
          <SeccionProblema />
          <SeccionFlujo />
          <SeccionRoles />
          <SeccionExpediente />
          <SeccionDinero />
          <SeccionSedes />
          <SeccionPlan />
          <SeccionFaq />
          <SeccionCierre />
        </main>
        <EduFooter year={new Date().getFullYear()} />
        <EduReveal />
      </div>
    </>
  );
}
