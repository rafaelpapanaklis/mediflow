import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { AffiliateLoginForm } from "@/components/afiliados/affiliate-login-form";

// Dynamic: el login no debe prerenderizarse (interactúa con sesión Supabase).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal de afiliados · DaleControl",
  description: "Accede a tu panel de afiliado de DaleControl para seguir tus referidos y comisiones.",
  robots: { index: false, follow: false },
};

export default function AffiliateLoginPage() {
  // visualVariant="dark": misma piel que /login de clínicas — fondo casi negro y
  // el wrapper con flex:1 que deja a la escena 3D llenar el panel.
  return <AuthShell split="50/50" visualVariant="dark" visual={<LoginVisual />} form={<AffiliateLoginForm />} />;
}
