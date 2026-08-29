export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { EduAuthShell } from "@/components/edu/edu-auth-shell";
import { EduLoginForm } from "@/components/edu/edu-login-form";
import { EDU_BRAND } from "@/lib/edu/types";
import "../edu-theme.css";

export const metadata: Metadata = {
  title: `Entrar · ${EDU_BRAND.full}`,
  description:
    "Acceso al panel de DaleControl Institucional para escuelas de especialidades odontológicas.",
  robots: { index: false, follow: false },
};

/**
 * Login DEDICADO del vertical.
 *
 * El shell y el formulario son PROPIOS (src/components/edu/): esta pantalla
 * no importa nada de src/components/public/**, que es del producto dental.
 *
 * Si ya hay sesión de instituto, no tiene sentido pedirla otra vez.
 */
export default async function InstitutoLoginPage() {
  const ctx = await getEduContext();
  if (ctx) redirect("/instituto/inicio");

  return (
    <EduAuthShell>
      <EduLoginForm />
    </EduAuthShell>
  );
}
