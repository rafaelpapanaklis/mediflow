import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { MapPin, ShieldCheck, Headphones, ArrowRight, Star, Check } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  SocialProof,
  FeaturesGrid,
  Spotlights,
  Comparison,
  Testimonials,
  TrustFaq,
} from "@/components/public/landing/sales";
import { ProductWindow } from "@/components/public/landing/sales/product-window";
import { SalesLogo } from "@/components/public/landing/sales/logo";
import "@/components/public/landing/sales/sales.css";

// Página hosteada del socio/afiliado: una landing de venta de MediFlow donde
// TODOS los CTA apuntan a /signup?ref=<referralCode> para atribuir el alta.
// Dynamic: depende del slug + estado del afiliado (no SSG).
export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mediflow-pi.vercel.app";

async function getApprovedAffiliate(slug: string) {
  return prisma.affiliate.findFirst({
    where: { slug, status: "APPROVED" },
    select: { name: true, slug: true, referralCode: true },
  });
}

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const affiliate = await getApprovedAffiliate(params.slug);
  if (!affiliate) return { title: "Socio no encontrado · MediFlow" };
  return {
    title: `${affiliate.name} te recomienda MediFlow`,
    description:
      "Software dental todo-en-uno para clínicas en México: agenda con WhatsApp, expediente con odontograma, radiografías con IA y facturación CFDI 4.0.",
    // Las páginas de socio son variantes del home; las dejamos fuera del índice
    // para no competir por SEO, pero permitimos seguir los enlaces.
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/socio/${affiliate.slug}` },
  };
}

export default async function PartnerLandingPage({ params }: Props) {
  const affiliate = await getApprovedAffiliate(params.slug);
  if (!affiliate) notFound();

  const signupHref = `/signup?ref=${affiliate.referralCode}`;

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <a href="#mfh-main" className="mf-skip-link">Saltar al contenido</a>

      {/* Nav del socio — logo + CTA de registro con ref */}
      <header className="mfh-nav" data-scrolled="true">
        <div className="mfh-container mfh-nav__inner">
          <SalesLogo />
          <div className="mfh-nav__right">
            <Link href={signupHref} className="mfh-btn mfh-btn--primary mfh-nav__signup-desktop">
              Crear cuenta <ArrowRight />
            </Link>
          </div>
        </div>
      </header>

      <main id="mfh-main">
        {/* Hero personalizado con el nombre del socio */}
        <section className="mfh-hero" id="producto">
          <div className="mfh-hero__bg" aria-hidden="true">
            <div className="mfh-hero__grid" />
            <div className="mfh-hero__blob mfh-hero__blob--1" />
            <div className="mfh-hero__blob mfh-hero__blob--2" />
          </div>

          <div className="mfh-container mfh-hero__inner">
            <div className="mfh-hero__copy">
              <span className="mfh-eyebrow">
                <Star style={{ color: "#f59e0b" }} /> Recomendado por {affiliate.name}
              </span>

              <h1 className="mfh-h1 mfh-balance">
                Toda tu clínica dental en <span className="mfh-grad">una sola plataforma</span>
              </h1>

              <p className="mfh-lede" style={{ maxWidth: 520 }}>
                Agenda, expedientes con odontograma, radiografías con IA y facturación CFDI 4.0
                en un mismo lugar. Menos software suelto, menos faltas y más tiempo para tus pacientes.
              </p>

              <div className="mfh-hero__cta">
                <Link href={signupHref} className="mfh-btn mfh-btn--primary mfh-btn--lg">
                  Crear cuenta <ArrowRight />
                </Link>
                <a href="#funciones" className="mfh-btn mfh-btn--ghost mfh-btn--lg">
                  Ver funciones
                </a>
              </div>

              <div className="mfh-hero__trust">
                <span className="mfh-pill"><MapPin /> Hecho en México</span>
                <span className="mfh-pill"><ShieldCheck /> CFDI 4.0 · NOM-024</span>
                <span className="mfh-pill"><Headphones /> Soporte en español</span>
              </div>
            </div>

            <div className="mfh-hero__stage">
              <ProductWindow />
            </div>
          </div>
        </section>

        {/* Secciones presentacionales reutilizadas del home (sin CTA propios) */}
        <SocialProof />
        <FeaturesGrid />
        <Spotlights />
        <Comparison />
        <Testimonials />
        <TrustFaq />

        {/* CTA final — vuelve a /signup?ref */}
        <section className="mfh-section mfh-band">
          <div className="mfh-container">
            <div className="mfh-cta">
              <div className="mfh-cta__glow" aria-hidden="true" />
              <div className="mfh-cta__grid" aria-hidden="true" />
              <div className="mfh-cta__inner">
                <h2 className="mfh-cta__h mfh-balance">Empieza hoy con MediFlow</h2>
                <p className="mfh-cta__p">
                  {affiliate.name} te recomienda MediFlow. Crea tu cuenta y lleva agenda, expedientes,
                  radiografías con IA y facturación CFDI 4.0 a una sola plataforma.
                </p>
                <div className="mfh-cta__row">
                  <Link href={signupHref} className="mfh-btn mfh-btn--lg mfh-btn--white">
                    Crear cuenta <ArrowRight />
                  </Link>
                </div>
                <div className="mfh-cta__note">
                  <span><Check /> Sin permanencia</span>
                  <span><Check /> CFDI 4.0 · NOM-024</span>
                  <span><Check /> Soporte en español</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer mínimo del socio */}
      <footer
        style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "28px 0",
          textAlign: "center",
          color: "rgba(255,255,255,0.6)",
          fontSize: 13,
        }}
      >
        <div className="mfh-container" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
          <SalesLogo />
          <p style={{ margin: 0 }}>
            Recomendado por <strong style={{ color: "rgba(255,255,255,0.85)" }}>{affiliate.name}</strong> ·
            MediFlow © {new Date().getFullYear()}
          </p>
          <Link href={signupHref} style={{ color: "var(--mfh-brand, #a78bfa)", fontWeight: 600, textDecoration: "none" }}>
            Crear cuenta gratis →
          </Link>
        </div>
      </footer>
    </div>
  );
}
