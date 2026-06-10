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
  return <AuthShell split="50/50" visual={<LoginVisual />} form={<AffiliateLoginForm />} />;
}
