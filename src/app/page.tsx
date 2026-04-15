import { Header } from "@/components/public/landing/header";
import { Hero } from "@/components/public/landing/hero";
import { LogosCarousel } from "@/components/public/landing/logos-carousel";
import { Specialties } from "@/components/public/landing/specialties";
import { Features } from "@/components/public/landing/features";
import { WhatsAppSection } from "@/components/public/landing/whatsapp-section";
import { Steps } from "@/components/public/landing/steps";
import { Pricing } from "@/components/public/landing/pricing";
import { Testimonials } from "@/components/public/landing/testimonials";
import { FinalCTA } from "@/components/public/landing/final-cta";
import { Footer } from "@/components/public/landing/footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0B0F1E]">
      <Header />
      <main>
        <Hero />
        <LogosCarousel />
        <Specialties />
        <Features />
        <WhatsAppSection />
        <Steps />
        <Pricing />
        <Testimonials />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
