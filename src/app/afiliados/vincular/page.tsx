import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { AffiliateVincularForm } from "@/components/afiliados/affiliate-vincular-form";
import { getAffiliateLinkState } from "@/lib/affiliates/link-state";

// Dynamic: depende de la sesión de Supabase, no se puede prerenderizar.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activa tu cuenta de afiliado · DaleControl",
  description:
    "Ya tienes cuenta en DaleControl: activa tu cuenta de afiliado sin crear otra.",
  robots: { index: false, follow: false },
};

/**
 * Vinculación de una cuenta EXISTENTE de DaleControl con el programa de
 * afiliados. Ser cliente y ser afiliado son roles independientes: esta pantalla
 * suma el rol de afiliado a la cuenta que la persona ya usa, sin crear un
 * usuario nuevo ni tocar su contraseña.
 *
 * Aquí llegan dos perfiles:
 *  · Con sesión abierta (enlace desde Configuración del panel) → un clic.
 *  · Sin sesión, rebotado del registro con 409 needsLogin → escribe su
 *    contraseña de siempre y se activa.
 */
export default async function AffiliateVincularPage({
  searchParams,
}: {
  searchParams?: { email?: string };
}) {
  const { sessionEmail, alreadyAffiliate } = await getAffiliateLinkState();

  // Ya es afiliado: nada que vincular. El layout del panel lo manda a
  // /afiliados/pendiente si su status todavía no es APPROVED.
  if (alreadyAffiliate) redirect("/afiliados/inicio");

  // Sólo prellena el input; la identidad real la decide la sesión en el server.
  const initialEmail =
    typeof searchParams?.email === "string" ? searchParams.email.trim().slice(0, 160) : "";

  return (
    <AuthShell
      split="50/50"
      visual={<LoginVisual />}
      form={<AffiliateVincularForm sessionEmail={sessionEmail} initialEmail={initialEmail} />}
    />
  );
}
