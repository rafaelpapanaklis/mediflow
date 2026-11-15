import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { BARBER_LOGIN_PATH } from "@/lib/barber/marketing";
import { BarberRecuperarForm } from "./recuperar-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña · DaleControl Barber",
  description: "Recupera el acceso al panel de tu barbería.",
  robots: { index: false, follow: false },
};

/**
 * /barber/recuperar — «Olvidé mi contraseña» con la cara de Barber (la misma
 * de /barber/entrar). Antes el enlace iba a /forgot-password, que tiene la
 * cara de las clínicas y al terminar deja en su inicio de sesión
 * (auditoría 14-nov, M1). No es del panel: sin candado de pago ni menú.
 */
export default function BarberRecuperarPage() {
  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={<BarberRecuperarForm loginHref={BARBER_LOGIN_PATH} apiUrl="/api/barber/auth/recuperar" />}
    />
  );
}
