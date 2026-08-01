import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { AffiliateRegistroForm } from "@/components/afiliados/affiliate-registro-form";
import { getPublicOffer } from "@/lib/affiliates/public-offer";

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
  const offer = await getPublicOffer();

  return (
    <AuthShell
      split="60/40"
      visual={<LoginVisual />}
      form={
        <AffiliateRegistroForm
          topRecurringMxn={offer.topRecurringMxn}
          topOneTimeMxn={offer.topOneTimeMxn}
        />
      }
    />
  );
}
