import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { SignupVisual } from "@/components/public/auth/signup/signup-visual";
import { SignupForm } from "@/components/public/auth/signup/signup-form";
import { getSession } from "@/lib/auth";

// Dynamic porque chequea cookies de sesión.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crea tu cuenta · DaleControl",
  description:
    "Crea tu cuenta en DaleControl — software médico mexicano con CFDI, WhatsApp e IA. Elige tu plan y empieza hoy.",
  robots: { index: true, follow: true },
};

function FormFallback() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ld-fg-muted)", fontSize: 13 }}>
      Cargando formulario…
    </div>
  );
}

export default async function SignupPage() {
  // Sesión activa → ir directo al dashboard. No tiene sentido crear una
  // cuenta nueva si el usuario ya está logueado en otra clínica/sesión.
  const user = await getSession();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      split="45/55"
      visual={<SignupVisual />}
      form={
        <Suspense fallback={<FormFallback />}>
          <SignupForm />
        </Suspense>
      }
    />
  );
}
