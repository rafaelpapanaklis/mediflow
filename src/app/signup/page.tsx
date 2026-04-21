import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { SignupVisual } from "@/components/public/auth/signup/signup-visual";
import { SignupForm } from "@/components/public/auth/signup/signup-form";

export const metadata: Metadata = {
  title: "Prueba gratis 14 días · MediFlow",
  description:
    "Crea tu cuenta en MediFlow — 14 días gratis, cancela cuando quieras. Software médico mexicano con CFDI, WhatsApp e IA.",
  robots: { index: true, follow: true },
};

export default function SignupPage() {
  return <AuthShell split="60/40" visual={<SignupVisual />} form={<SignupForm />} />;
}
