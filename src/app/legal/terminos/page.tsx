import { permanentRedirect } from "next/navigation";

/**
 * Redirect 308 → /terminos. El checkbox de aceptación del registro
 * apunta a /legal/terminos; este redirect evita el 404.
 */
export default function LegalTerminosRedirect() {
  permanentRedirect("/terminos");
}
