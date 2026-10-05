import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { SignupVisual } from "@/components/public/auth/signup/signup-visual";
import { SignupForm } from "@/components/public/auth/signup/signup-form";
import { getSession } from "@/lib/auth";
import { planDeRuta } from "@/lib/billing/contratar";

// Enlace de contratación (pedido de Rafael, 5-oct-2026): dalecontrol.com/contratar/basico,
// /profesional y /clinica. El MISMO registro de /signup con el plan fijo, mensual y SIN la
// promo del primer mes: precio de lista + IVA desde el primer cobro. La URL se queda limpia
// (sin ?plan ni ?promo): la marca viaja en una cookie y se guarda en el servidor al darse de
// alta (lib/billing/contratar.ts). Al ser una carpeta propia, el comodín [slug] no la toca.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contrata tu plan · DaleControl",
  description: "Crea tu cuenta en DaleControl y activa tu plan.",
  // Enlace que se manda a mano: no se indexa.
  robots: { index: false, follow: false },
};

function FormFallback() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ld-fg-muted)", fontSize: 13 }}>
      Cargando formulario…
    </div>
  );
}

export default async function ContratarPage({ params }: { params: { plan: string } }) {
  const plan = planDeRuta(params.plan);
  if (!plan) notFound();
  const user = await getSession();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      split="45/55"
      visualVariant="navy"
      visual={<SignupVisual soloTarjeta />}
      form={
        <Suspense fallback={<FormFallback />}>
          <SignupForm planDeEnlace={plan} />
        </Suspense>
      }
    />
  );
}
