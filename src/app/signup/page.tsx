import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { SignupVisual } from "@/components/public/auth/signup/signup-visual";
import { SignupForm } from "@/components/public/auth/signup/signup-form";

export const metadata: Metadata = {
  title: "Prueba gratis 14 días · MediFlow",
  description:
    "Crea tu cuenta en MediFlow — 14 días gratis, cancela cuando quieras. Software médico mexicano con CFDI, WhatsApp e IA.",
  robots: { index: true, follow: true },
};

function FormFallback() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ld-fg-muted)", fontSize: 13 }}>
      Cargando formulario…
    </div>
  );
}

export default function SignupPage() {
  return (
    <AuthShell
      split="60/40"
      visual={<SignupVisual />}
      form={
        <Suspense fallback={<FormFallback />}>
          <SignupForm />
        </Suspense>
      }
    />
  );
}
