import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { ForgotPasswordForm } from "@/components/public/auth/recovery/forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña · DaleControl",
  description: "Recupera el acceso a tu panel de DaleControl.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <AuthShell split="50/50" visual={<LoginVisual />} form={<ForgotPasswordForm />} />;
}
