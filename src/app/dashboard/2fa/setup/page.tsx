import { redirect } from "next/navigation";
import { getCurrentUserSinDosPasos } from "@/lib/auth";
import { decidirDosPasos } from "@/lib/auth/two-factor-decision";
import { TwoFactorSetup } from "@/components/dashboard/security/two-factor-setup";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";

export const dynamic = "force-dynamic";

// Enrolamiento forzado (clinic.require2fa) o acceso directo a la configuración.
// Renderizado con layout mínimo (el dashboard layout exenta /dashboard/2fa*).
export default async function TwoFactorSetupPage() {
  // Sin el gate de 2FA: esta pantalla ES la salida del bloqueo «setup», así
  // que tiene que pintarse con él puesto (ws1-t8: nunca un callejón sin salida).
  const user = await getCurrentUserSinDosPasos();
  const { decision, dueno } = decidirDosPasos(user);

  // Ya tiene 2FA: no hay nada que configurar → reto pendiente o panel.
  if ((user as { totpEnabled?: boolean }).totpEnabled) {
    if (decision === "challenge") redirect("/dashboard/2fa");
    redirect("/dashboard");
  }

  // Obligado (la clínica lo exige o es dueño con la gracia vencida) o viniendo
  // del aviso de la gracia: arranca solo y al terminar vuelve al panel.
  const requiereClinica = !!(user.clinic as { require2fa?: boolean })?.require2fa;
  const forced = requiereClinica || decision === "setup" || decision === "aviso";
  const motivo: "clinica" | "dueno" | undefined = requiereClinica
    ? "clinica"
    : dueno.estado !== "no-aplica"
      ? "dueno"
      : undefined;

  // REDISEÑO — mismo interruptor por clínica que el menú de dos niveles (ver
  // ../page.tsx): el layout mínimo no lo lee, se lee aquí con su caché de 60 s.
  // El enrolamiento es el mismo componente encendido o apagado; la raíz solo
  // lo viste (mismo ancho que el max-w-md de siempre).
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  if (rediseno) {
    return (
      <RaizCuenta barrera>
        <TwoFactorSetup forced={forced} motivo={motivo} />
      </RaizCuenta>
    );
  }
  return (
    <div className="w-full max-w-md">
      <TwoFactorSetup forced={forced} motivo={motivo} />
    </div>
  );
}
