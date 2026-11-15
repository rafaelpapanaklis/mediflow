import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { getBarberContext } from "@/lib/barber-auth";
import { BARBER_LOGIN_PATH } from "@/lib/barber/marketing";
import { BARBER_PASSWORD_API } from "@/lib/barber/contrasena";
import { BarberCambioObligatorioForm } from "./cambio-obligatorio-form";

// Lee la sesión: nunca se prerenderiza.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pon tu contraseña · DaleControl Barber",
  robots: { index: false, follow: false },
};

/**
 * /barber/cambiar-contrasena — el cambio OBLIGATORIO de la contraseña
 * temporal que le dio a la persona quien la dio de alta en Equipo (espejo de
 * /dashboard/cambiar-contrasena del dental).
 *
 * Vive FUERA de (panel) a propósito: el layout del panel manda aquí a quien
 * tiene la marca pendiente, y si esta pantalla estuviera dentro sería un
 * bucle. Sin menú, sin candado de pago: con la temporal no se usa el panel.
 */
export default async function BarberCambioObligatorioPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect(BARBER_LOGIN_PATH);
  // Ya la cambió (o nunca tuvo temporal): nada que hacer aquí.
  if (!ctx.mustChangePassword) redirect("/barber");

  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={
        <BarberCambioObligatorioForm
          nombre={ctx.user.firstName}
          apiUrl={BARBER_PASSWORD_API}
          correo={ctx.user.email ?? ""}
          loginHref={BARBER_LOGIN_PATH}
        />
      }
    />
  );
}
