import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { LoginForm } from "@/components/public/auth/login/login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión · MediFlow",
  description: "Accede a tu panel de MediFlow — software médico mexicano con CFDI, WhatsApp e IA para radiografías.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <AuthShell split="50/50" visual={<LoginVisual />} form={<LoginForm />} />;
}
