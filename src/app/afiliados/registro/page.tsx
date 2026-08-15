import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { AffiliateRegistroForm } from "@/components/afiliados/affiliate-registro-form";
import { getPublicOffer } from "@/lib/affiliates/public-offer";
import { getAffiliateLinkState, getInvitePreview } from "@/lib/affiliates/link-state";
import { INVITE_PARAM } from "@/lib/affiliates/invites";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conviértete en afiliado · DaleControl",
  description: "Recomienda DaleControl y gana comisión recurrente por cada clínica que se suscriba.",
  robots: { index: false, follow: false },
};

export default async function AffiliateRegistroPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // Los montos salen de la config en vivo (getPublicOffer nunca lanza) y viajan
  // como props: el formulario es "use client" y no puede tocar Prisma.
  //
  // El estado de sesión habilita el camino corto: quien llega desde el enlace
  // de Configuración de su clínica ya está autenticado, así que en vez de
  // pedirle un correo que Supabase va a rechazar (mismo Auth para clínicas y
  // afiliados) se le ofrece activar el rol de afiliado en un clic. Ambas
  // llamadas son independientes → en paralelo.
  const [offer, linkState] = await Promise.all([getPublicOffer(), getAffiliateLinkState()]);

  // ¿Llegó por la invitación de otro afiliado? Sólo para mostrar de quién es la
  // invitación; el vínculo lo escribe el POST del alta al resolver el mismo
  // código. Si no resuelve, no se muestra nada y el registro sigue idéntico:
  // una invitación rota jamás bloquea un alta.
  const invite = await getInvitePreview(searchParams?.[INVITE_PARAM], linkState.sessionEmail);

  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<LoginVisual />}
      form={
        <AffiliateRegistroForm
          topRecurringMxn={offer.topRecurringMxn}
          topOneTimeMxn={offer.topOneTimeMxn}
          sessionEmail={linkState.sessionEmail}
          alreadyAffiliate={linkState.alreadyAffiliate}
          inviteCode={invite?.code ?? ""}
          inviterName={invite?.name ?? ""}
        />
      }
    />
  );
}
