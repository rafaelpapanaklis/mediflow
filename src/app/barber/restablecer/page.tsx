import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { BARBER_LOGIN_PATH } from "@/lib/barber/marketing";
import { BARBER_PASSWORD_READY_PARAM, BARBER_RECOVER_PATH } from "@/lib/barber/contrasena";
import { BarberRestablecerForm } from "./restablecer-form";

// Lee ?error= de la URL: nunca se prerenderiza.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contraseña nueva · DaleControl Barber",
  description: "Pon una contraseña nueva para entrar a tu barbería.",
  robots: { index: false, follow: false },
};

/**
 * /barber/restablecer — adonde regresa el enlace del correo de «Olvidé mi
 * contraseña» (vía /api/barber/auth/confirmar). Cara de Barber; al terminar,
 * /barber/entrar con «Listo, ya puedes entrar».
 */
export default async function BarberRestablecerPage(props: {
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const { name, value } = BARBER_PASSWORD_READY_PARAM;
  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={
        <BarberRestablecerForm
          errorEnUrl={!!sp.error}
          recuperarHref={BARBER_RECOVER_PATH}
          loginHref={BARBER_LOGIN_PATH}
          loginListoHref={`${BARBER_LOGIN_PATH}?${name}=${value}`}
        />
      }
    />
  );
}
