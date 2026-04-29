import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { LoginForm } from "@/components/public/auth/login/login-form";
import { getSession } from "@/lib/auth";

// Forzar dynamic: getSession() lee cookies, así que la página no es estática.
// Sin esto Next intentaría prerender y se saltaría el chequeo de sesión.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Iniciar sesión · MediFlow",
  description: "Accede a tu panel de MediFlow — software médico mexicano con CFDI, WhatsApp e IA para radiografías.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Si ya hay sesión activa de Supabase, saltar al dashboard. Si el usuario
  // no tiene aún Prisma.User (signup orphano), getCurrentUser() en /dashboard
  // ya redirige a /onboarding — manejamos un solo punto de routing.
  const user = await getSession();
  if (user) redirect("/dashboard");
  return <AuthShell split="50/50" visual={<LoginVisual />} form={<LoginForm />} />;
}
