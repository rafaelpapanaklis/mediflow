import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { AffiliateRegistroForm } from "@/components/afiliados/affiliate-registro-form";
import { getPublicOffer } from "@/lib/affiliates/public-offer";
import { getAffiliateLinkState } from "@/lib/affiliates/link-state";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conviértete en afiliado · DaleControl",
  description: "Recomienda DaleControl y gana comisión recurrente por cada clínica que se suscriba.",
  robots: { index: false, follow: false },
};

export default async function AffiliateRegistroPage() {
  // Los montos salen de la config en vivo (getPublicOffer nunca lanza) y viajan
  // como props: el formulario es "use client" y no puede tocar Prisma.
  //
  // El estado de sesión habilita el camino corto: quien llega desde el enlace
  // de Configuración de su clínica ya está autenticado, así que en vez de
  // pedirle un correo que Supabase va a rechazar (mismo Auth para clínicas y
  // afiliados) se le ofrece activar el rol de afiliado en un clic. Ambas
  // llamadas son independientes → en paralelo.
  const [offer, linkState] = await Promise.all([getPublicOffer(), getAffiliateLinkState()]);

  return (
    <AuthShell
      split="60/40"
      visual={<LoginVisual />}
      form={
        <AffiliateRegistroForm
          topRecurringMxn={offer.topRecurringMxn}
          topOneTimeMxn={offer.topOneTimeMxn}
          sessionEmail={linkState.sessionEmail}
          alreadyAffiliate={linkState.alreadyAffiliate}
        />
      }
    />
  );
}
