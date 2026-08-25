import type { Metadata } from "next";
import "@/app/inmobiliaria/realty-theme.css";
import "@/components/realty/portal/realty-portal.css";

/* ═══════════════════════════════════════════════════════════════════════
   /i/portal — EL PORTAL DEL CLIENTE FINAL (inquilino y propietario).

   Convive con la web pública de cada inmobiliaria, que vive en /i/[slug].
   No chocan: "portal" es un segmento ESTÁTICO y Next resuelve lo estático
   antes que lo dinámico. Si algún día /i/ gana un layout propio con la
   piel de la mini-web, este layout seguirá pintando su propio armazón de
   pantalla completa por debajo — pero conviene saberlo antes de que pase.

   Aquí solo van la piel y el noindex. NO hay guard: /i/portal (el login)
   es público a la fuerza. El guard vive en el grupo (sesion), así el login
   se queda fuera sin un solo `if`.

   El tema verde pino + arena sale de .realty-shell (realty-theme.css, del
   panel). La clase `dark` solo se aplica en /dashboard y /admin, así que
   este portal es SIEMPRE claro — que es lo correcto para algo que se abre
   a mediodía en la calle.
   ═══════════════════════════════════════════════════════════════════════ */

export const metadata: Metadata = {
  title: "Mi portal",
  description: "Tu contrato, tus pagos y tus reportes en un solo lugar.",
  // Datos personales: fuera de los buscadores, siempre.
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="realty-shell">{children}</div>;
}
