import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { AffiliateRegistroForm } from "@/components/afiliados/affiliate-registro-form";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conviértete en afiliado · MediFlow",
  description: "Recomienda MediFlow y gana comisión recurrente por cada clínica que se suscriba.",
  robots: { index: false, follow: false },
};

export default function AffiliateRegistroPage() {
  return <AuthShell split="60/40" visual={<LoginVisual />} form={<AffiliateRegistroForm />} />;
}
