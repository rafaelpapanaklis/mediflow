import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { ResetPasswordForm } from "@/components/public/auth/recovery/reset-password-form";

export const metadata: Metadata = {
  title: "Restablecer contraseña · DaleControl",
  description: "Define una nueva contraseña para tu cuenta de DaleControl.",
  robots: { index: false, follow: false },
};

function FormFallback() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ld-fg-muted)", fontSize: 13 }}>
      Cargando…
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      split="50/50"
      visual={<LoginVisual />}
      form={
        <Suspense fallback={<FormFallback />}>
          <ResetPasswordForm />
        </Suspense>
      }
    />
  );
}
