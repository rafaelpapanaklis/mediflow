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
import { RefClickTracker } from "@/components/afiliados/ref-click-tracker";
import { SavingsCalculator } from "@/components/socio/savings-calculator";
import "@/components/public/landing/sales/sales.css";

// Página hosteada del socio/afiliado: una landing de venta de DaleControl donde
// TODOS los CTA apuntan a /signup?ref=<referralCode> (+ &c=<campaña> si llegó
// un ?c= válido, para atribuir el alta a la campaña del socio).
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
    select: { id: true, name: true, slug: true, referralCode: true },
  });
}

interface Props {
  params: { slug: string };
  // ?c=<campaña> para click tracking; generateMetadata NO lo usa (el canonical
  // queda limpio, sin ?c).
  searchParams?: { [key: string]: string | string[] | undefined };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const affiliate = await getApprovedAffiliate(params.slug);
  if (!affiliate) return { title: "Socio no encontrado · DaleControl" };
  return {
    title: `${affiliate.name} te recomienda DaleControl`,
    description:
      "Software dental todo-en-uno para clínicas en México: agenda con WhatsApp, expediente con odontograma, radiografías con IA y facturación CFDI 4.0.",
    // Las páginas de socio son variantes del home; las dejamos fuera del índice
    // para no competir por SEO, pero permitimos seguir los enlaces.
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/socio/${affiliate.slug}` },
  };
}

export default async function PartnerLandingPage({ params, searchParams }: Props) {
  const affiliate = await getApprovedAffiliate(params.slug);
  if (!affiliate) notFound();

  // Campaña opcional (?c=instagram-bio, ?c=qr-consultorio…). Solo se acepta
  // un slug seguro; cualquier otra cosa se ignora por completo.
  const rawCampaign = searchParams?.c;
  const c =
    typeof rawCampaign === "string" && /^[a-z0-9-]{1,40}$/.test(rawCampaign)
      ? rawCampaign
      : undefined;

  // Click tracking de la campaña. updateMany (no update) ⇒ una campaña no
  // registrada simplemente actualiza 0 filas sin tronar; y si la tabla aún no
  // existe en la BD, el catch lo silencia: el tracking nunca tumba la landing.
  if (c) {
    try {
      await prisma.affiliateLink.updateMany({
        where: { affiliateId: affiliate.id, campaign: c },
        data: { clicks: { increment: 1 } },
      });
    } catch {}
  }

  // Único punto donde se arma el href de alta: TODOS los CTAs (header, hero,
  // calculadora, CTA final y footer) lo reusan y propagan la campaña al signup.
  const signupHref = `/signup?ref=${affiliate.referralCode}${c ? `&c=${c}` : ""}`;

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <a href="#mfh-main" className="mf-skip-link">Saltar al contenido</a>
      <RefClickTracker refCode={affiliate.referralCode} />

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

        {/* Calculadora de ahorro — última parada antes del CTA final */}
        <section className="mfh-section mfh-band--violet" aria-label="Calculadora de ahorro">
          <div className="mfh-container">
            <div className="mfh-head mfh-center mfh-reveal">
              <span className="mfh-kicker">Calculadora</span>
              <h2 className="mfh-h2 mfh-balance">
                ¿Cuánto vale el tiempo administrativo de tu clínica?
              </h2>
              <p className="mfh-lede">
                Mueve los controles y estima cuánto tiempo administrativo podría
                recuperar tu equipo al concentrar agenda, expedientes y facturación
                en una sola plataforma.
              </p>
            </div>
            <div className="mfh-reveal" style={{ maxWidth: 920, margin: "44px auto 0" }}>
              <SavingsCalculator signupHref={signupHref} />
            </div>
          </div>
        </section>

        {/* CTA final — vuelve a /signup?ref */}
        <section className="mfh-section mfh-band">
          <div className="mfh-container">
            <div className="mfh-cta">
              <div className="mfh-cta__glow" aria-hidden="true" />
              <div className="mfh-cta__grid" aria-hidden="true" />
              <div className="mfh-cta__inner">
                <h2 className="mfh-cta__h mfh-balance">Empieza hoy con DaleControl</h2>
                <p className="mfh-cta__p">
                  {affiliate.name} te recomienda DaleControl. Crea tu cuenta y lleva agenda, expedientes,
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
            DaleControl © {new Date().getFullYear()}
          </p>
          <Link href={signupHref} style={{ color: "var(--mfh-brand, #a78bfa)", fontWeight: 600, textDecoration: "none" }}>
            Crear cuenta gratis →
          </Link>
        </div>
      </footer>
    </div>
  );
}
