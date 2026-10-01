import { redirect } from "next/navigation";
import { getCurrentUserSinDosPasos } from "@/lib/auth";
import { decidirDosPasos } from "@/lib/auth/two-factor-decision";
import { AvisoDosPasos } from "@/components/dashboard/security/aviso-dos-pasos";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";
import { localeFromClinic } from "@/i18n/server";

export const dynamic = "force-dynamic";

// ws1-t8 · M2 — «Activa la verificación en dos pasos», el aviso al DUEÑO sin
// 2FA mientras dura la gracia. Bajo /dashboard/2fa*: layout mínimo, sin el
// gate de 2FA. Fuera de la gracia no hay nada que avisar: cada caso, a su sitio.
export default async function AvisoDosPasosPage() {
  const user = await getCurrentUserSinDosPasos();
  const { decision, dueno } = decidirDosPasos(user);

  if (decision === "challenge") redirect("/dashboard/2fa");
  if (decision === "setup") redirect("/dashboard/2fa/setup");
  if (decision !== "aviso" || dueno.estado !== "gracia") redirect("/dashboard");

  const locale = localeFromClinic(user.clinic);
  const fechaLimite = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "America/Mexico_City",
  }).format(new Date(dueno.venceMs));

  const aviso = (
    <AvisoDosPasos
      clinicName={user.clinic.name}
      fechaLimite={fechaLimite}
      diasRestantes={dueno.diasRestantes}
    />
  );

  // Mismo interruptor por clínica que viste el reto y el enrolamiento.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  if (rediseno) return <RaizCuenta barrera>{aviso}</RaizCuenta>;
  return aviso;
}
