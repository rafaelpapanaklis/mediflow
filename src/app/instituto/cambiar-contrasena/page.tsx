export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { EduAuthShell } from "@/components/edu/edu-auth-shell";
import { EduCambiarContrasenaForm } from "@/components/edu/edu-cambiar-contrasena-form";
import { EDU_BRAND } from "@/lib/edu/types";
import "../edu-theme.css";

export const metadata: Metadata = {
  title: `Cambiar contraseña · ${EDU_BRAND.full}`,
  robots: { index: false, follow: false },
};

/**
 * /instituto/cambiar-contrasena — la persona define SU contraseña.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 P2-9 · LA PANTALLA QUE `mustChangePassword` ESPERABA DESDE LA OLA 1B.
 *
 * El alta de equipo genera una contraseña temporal y quien da el alta LA
 * CONOCE: la dirección de una escuela se quedaba, indefinidamente, con la
 * contraseña de cada alumno que inscribió — y la persona no tenía ninguna
 * forma de cambiarla desde el producto (el /api/auth/change-password del
 * dental exige una fila `User` de clínica y a un EduUser le contesta 401).
 *
 * Vive FUERA del grupo (panel) —hermana del login— a propósito: el layout
 * del panel redirige aquí a quien trae la marca, y si esta página viviera
 * dentro del grupo, ese redirect la alcanzaría a ella misma y sería un
 * bucle. Consecuencia deliberada: quien está obligado a cambiarla no ve NI
 * UNA pantalla del panel hasta que la cambia.
 *
 * También se llega SIN estar obligado (el enlace del menú): cambiar tu
 * contraseña cuando quieras es la otra mitad de lo que faltaba.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function InstitutoCambiarContrasenaPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  return (
    <EduAuthShell>
      <EduCambiarContrasenaForm
        forzado={ctx.user.mustChangePassword}
        email={ctx.user.email}
      />
    </EduAuthShell>
  );
}
