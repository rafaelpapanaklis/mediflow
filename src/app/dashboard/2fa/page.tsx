import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasValidTwoFactorCookie } from "@/lib/auth/two-factor-cookie";
import { TwoFactorChallenge } from "@/components/dashboard/security/two-factor-challenge";

export const dynamic = "force-dynamic";

// Reto de login (segundo factor). El layout del dashboard exenta /dashboard/2fa*
// del gate y lo renderiza con layout mínimo (sin sidebar/topbar). Aquí solo
// enrutamos los casos borde; el reto en sí lo maneja el componente cliente.
export default async function TwoFactorChallengePage() {
  const user = await getCurrentUser();
  const clinic = user.clinic as { require2fa?: boolean };

  // Sin 2FA activo: o la clínica lo exige (→ enrolamiento) o no hay nada que
  // retar (→ panel).
  if (!(user as { totpEnabled?: boolean }).totpEnabled) {
    if (clinic?.require2fa) redirect("/dashboard/2fa/setup");
    redirect("/dashboard");
  }

  // Ya superado en esta ventana → al panel (evita pedir el código de nuevo).
  if (hasValidTwoFactorCookie(user.supabaseId, user.clinicId)) {
    redirect("/dashboard");
  }

  return <TwoFactorChallenge />;
}
