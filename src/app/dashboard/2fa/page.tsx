import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasValidTwoFactorCookie } from "@/lib/auth/two-factor-cookie";
import { TwoFactorChallenge } from "@/components/dashboard/security/two-factor-challenge";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";

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

  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`). Esta ruta
  // sale por el layout mínimo, que no lo lee, así que se lee aquí; el
  // interruptor guarda la respuesta 60 s por clínica (una consulta por clínica
  // por minuto, no una por carga) y falla cerrado: apagado, sin tabla o con
  // error → el reto de siempre, tal cual.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);

  // El reto es el mismo componente con la bandera encendida o apagada: ni un
  // flujo, ni una validación, ni un mensaje cambian. La raíz solo lo viste.
  if (rediseno) {
    return (
      <RaizCuenta barrera>
        <TwoFactorChallenge />
      </RaizCuenta>
    );
  }
  return <TwoFactorChallenge />;
}
