import type { Metadata } from "next";
import { Hero }         from "@/components/public/hero";
import { Benefits }     from "@/components/public/benefits";
import { Specialties }  from "@/components/public/specialties";
import { Testimonials } from "@/components/public/testimonials";
import { PricingCards } from "@/components/public/pricing-cards";
import { FAQ }          from "@/components/public/faq";
import { CTABanner }    from "@/components/public/cta-banner";
import { SectionHeader } from "@/components/shared/section-header";

export const metadata: Metadata = {
  title: "MediFlow — El sistema operativo de tu clínica",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <Benefits />
      <Specialties />
      <Testimonials />

      {/* Pricing preview */}
      <section className="section-pad bg-white">
        <div className="container-tight">
          <SectionHeader
            eyebrow="Planes y precios"
            title="Simple y transparente"
            subtitle="Sin costos ocultos. Empieza gratis 14 días, sin tarjeta de crédito."
            centered
            className="mb-10"
          />
          <PricingCards compact />
        </div>
      </section>

      <FAQ />
      <CTABanner />
    </>
  );
}
