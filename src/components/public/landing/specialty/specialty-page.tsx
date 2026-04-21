import { notFound } from "next/navigation";
import { getSpecialty } from "@/lib/specialty-data";
import { Footer } from "../footer";
import { SpecFAQ } from "./spec-faq";
import { SpecFeatures } from "./spec-features";
import { SpecFinalCTA } from "./spec-final-cta";
import { SpecHero } from "./spec-hero";
import { SpecMockupShowcase } from "./spec-mockup-showcase";
import { SpecNav } from "./spec-nav";
import { SpecPricing } from "./spec-pricing";
import { SpecRelated } from "./spec-related";
import { SpecTestimonial } from "./spec-testimonial";

export function SpecialtyPage({ slug }: { slug: string }) {
  const spec = getSpecialty(slug);
  if (!spec) notFound();
  return (
    <div
      className="landing-theme"
      data-mode="dark"
      style={{ minHeight: "100vh" }}
    >
      <SpecNav currentSlug={slug} />
      <SpecHero spec={spec} />
      <SpecFeatures spec={spec} />
      <SpecMockupShowcase spec={spec} />
      <SpecTestimonial spec={spec} />
      <SpecPricing spec={spec} />
      <SpecFAQ spec={spec} />
      <SpecFinalCTA spec={spec} />
      <SpecRelated currentSlug={slug} />
      <Footer />
    </div>
  );
}
