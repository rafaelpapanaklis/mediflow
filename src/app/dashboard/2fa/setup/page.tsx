import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasValidTwoFactorCookie } from "@/lib/auth/two-factor-cookie";
import { TwoFactorSetup } from "@/components/dashboard/security/two-factor-setup";

export const dynamic = "force-dynamic";

// Enrolamiento forzado (clinic.require2fa) o acceso directo a la configuración.
// Renderizado con layout mínimo (el dashboard layout exenta /dashboard/2fa*).
export default async function TwoFactorSetupPage() {
  const user = await getCurrentUser();

  // Ya tiene 2FA: no hay nada que configurar → reto pendiente o panel.
  if ((user as { totpEnabled?: boolean }).totpEnabled) {
    if (hasValidTwoFactorCookie(user.supabaseId, user.clinicId)) redirect("/dashboard");
    redirect("/dashboard/2fa");
  }

  const forced = !!(user.clinic as { require2fa?: boolean })?.require2fa;
  return (
    <div className="w-full max-w-md">
      <TwoFactorSetup forced={forced} />
    </div>
  );
}
