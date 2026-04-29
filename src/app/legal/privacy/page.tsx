import { permanentRedirect } from "next/navigation";

/**
 * Redirect 308 → /privacidad. Los links históricos (footer, login,
 * signup) apuntan a /legal/privacy. Mantener este redirect garantiza
 * que no haya 404s en producción.
 */
export default function LegalPrivacyRedirect() {
  permanentRedirect("/privacidad");
}
