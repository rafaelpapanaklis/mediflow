import { Header } from "@/components/public/landing/header";
import { Hero } from "@/components/public/landing/hero";
import { Features } from "@/components/public/landing/features";
import { Steps } from "@/components/public/landing/steps";
import { Specialties } from "@/components/public/landing/specialties";
import { Testimonials } from "@/components/public/landing/testimonials";
import { Pricing } from "@/components/public/landing/pricing";
import { FinalCTA } from "@/components/public/landing/final-cta";
import { Footer } from "@/components/public/landing/footer";

export default function HomePage() {
  return (
    <div className="landing-theme" data-mode="dark" style={{ minHeight: "100vh" }}>
      <Header />
      <main>
        <Hero />
        <Features />
        <Steps />
        <Specialties />
        <Testimonials />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
