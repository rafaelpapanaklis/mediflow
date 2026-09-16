import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasValidTwoFactorCookie } from "@/lib/auth/two-factor-cookie";
import { TwoFactorSetup } from "@/components/dashboard/security/two-factor-setup";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";

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

  // REDISEÑO — mismo interruptor por clínica que el menú de dos niveles (ver
  // ../page.tsx): el layout mínimo no lo lee, se lee aquí con su caché de 60 s.
  // El enrolamiento es el mismo componente encendido o apagado; la raíz solo
  // lo viste (mismo ancho que el max-w-md de siempre).
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  if (rediseno) {
    return (
      <RaizCuenta barrera>
        <TwoFactorSetup forced={forced} />
      </RaizCuenta>
    );
  }
  return (
    <div className="w-full max-w-md">
      <TwoFactorSetup forced={forced} />
    </div>
  );
}
