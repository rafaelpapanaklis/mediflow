import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { LoginForm } from "@/components/public/auth/login/login-form";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Forzar dynamic: getSession() lee cookies, así que la página no es estática.
// Sin esto Next intentaría prerender y se saltaría el chequeo de sesión.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Iniciar sesión · DaleControl",
  description: "Accede a tu panel de DaleControl — software médico mexicano con CFDI, WhatsApp e IA para radiografías.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Este es el login de CLÍNICA. Solo saltamos al dashboard si la sesión de
  // Supabase corresponde a un User de clínica activo. Si la sesión es de un
  // laboratorio/proveedor (o huérfana), RENDERIZAMOS el formulario en lugar de
  // redirigir: así el usuario puede iniciar sesión como clínica. El LoginForm
  // hace signOut() de la sesión previa antes de entrar, evitando el login
  // cruzado entre actores que comparten una misma sesión de Supabase.
  const user = await getSession();
  if (user) {
    const clinicUser = await prisma.user.findFirst({
      where: { supabaseId: user.id, isActive: true },
      select: { id: true },
    });
    if (clinicUser) redirect("/dashboard");
    // sesión de lab/proveedor (o huérfana): mostrar el form (no redirigir)
  }
  return <AuthShell split="50/50" visual={<LoginVisual />} form={<LoginForm />} />;
}
