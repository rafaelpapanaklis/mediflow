// Barrel de la landing de ventas.
// La HOME usa los componentes nuevos de ./v2 (handoff landing v2).
// Estos exports viejos siguen vivos porque /socio/[slug] y /descubre/* los
// montan: SocialProof, FeaturesGrid, Spotlights, Comparison, Testimonials,
// TrustFaq (socio) y SalesFooter (descubre, ya con el diseño nuevo).
export { SalesNav } from "./nav";
export { SocialProof } from "./social-proof";
export { FeaturesGrid } from "./features-grid";
export { Spotlights } from "./spotlights";
export { Comparison } from "./comparison";
export { Testimonials } from "./testimonials";
export { TrustFaq } from "./trust-faq";
export { SalesFooter } from "./footer";
