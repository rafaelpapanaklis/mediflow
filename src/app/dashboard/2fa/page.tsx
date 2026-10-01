import { redirect } from "next/navigation";
import { getCurrentUserSinDosPasos } from "@/lib/auth";
import { decidirDosPasos } from "@/lib/auth/two-factor-decision";
import { TwoFactorChallenge } from "@/components/dashboard/security/two-factor-challenge";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";

export const dynamic = "force-dynamic";

// Reto de login (segundo factor). El layout del dashboard exenta /dashboard/2fa*
// del gate y lo renderiza con layout mínimo (sin sidebar/topbar). Aquí solo
// enrutamos los casos borde; el reto en sí lo maneja el componente cliente.
export default async function TwoFactorChallengePage() {
  // Sin el gate de 2FA: esta pantalla ES el reto (ws1-t8, ver
  // getCurrentUserSinDosPasos). La decisión es la misma del gate.
  const user = await getCurrentUserSinDosPasos();
  const { decision } = decidirDosPasos(user);

  // Sin 2FA activo: o hay que enrolarse (la clínica lo exige) o no hay nada
  // que retar (→ panel). Ya superado en esta
  // ventana, o «Ver como clínica» → al panel (evita pedir el código de nuevo).
  if (decision === "setup") redirect("/dashboard/2fa/setup");
  if (decision !== "challenge") redirect("/dashboard");

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
