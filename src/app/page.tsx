import { Header } from "@/components/public/landing/header";
import { Hero } from "@/components/public/landing/hero";
import { Features } from "@/components/public/landing/features";
import { Steps } from "@/components/public/landing/steps";
import { Specialties } from "@/components/public/landing/specialties";
import { Testimonials } from "@/components/public/landing/testimonials";
import { Pricing } from "@/components/public/landing/pricing";
import { FinalCTA } from "@/components/public/landing/final-cta";
import { Footer } from "@/components/public/landing/footer";
import { getSession } from "@/lib/auth";

// getSession lee cookies → la landing pasa a dynamic. El contenido renderizado
// es idéntico para SEO (los bots sin cookies ven el flujo no-logueado).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Detecta si el usuario tiene sesión Supabase activa para que el Header
  // muestre "Ir al dashboard" en vez de "Iniciar sesión".
  const user = await getSession();
  const isLoggedIn = user !== null && user !== undefined;

  return (
    <div className="landing-theme" data-mode="dark" style={{ minHeight: "100vh" }}>
      <Header isLoggedIn={isLoggedIn} />
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
