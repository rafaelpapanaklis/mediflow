import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { BARBER_LOGIN_PATH } from "@/lib/barber/marketing";
import { BARBER_PASSWORD_READY_PARAM, BARBER_RECOVER_PATH, BARBER_RESET_PATH } from "@/lib/barber/contrasena";
import { BARBER_RECOVERY_COOKIE, recuperacionValidaPara } from "@/lib/barber/recuperacion-cookie";
import { createClient } from "@/lib/supabase/server";
import { BarberRestablecerForm } from "./restablecer-form";

// Lee la sesión, la cookie y ?error=: nunca se prerenderiza.
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
 *
 * Solo se abre viniendo de un enlace de recuperación (revisión ronda 7, M1):
 * hace falta la cookie firmada que deja /api/barber/auth/confirmar, del MISMO
 * usuario de la sesión. Una sesión normal (la del dueño en la tableta del
 * mostrador) no basta: sin cookie, a pedir el enlace. El cambio lo hace el
 * servidor (POST /barber/restablecer/guardar), que vuelve a exigirla.
 */
export default async function BarberRestablecerPage(props: {
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const sp = (await props.searchParams) ?? {};
  // El enlace caducado o ya usado: se explica y se ofrece otro.
  const enlaceMalo = !!sp.error;

  if (!enlaceMalo) {
    let valida = false;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const constancia = (await cookies()).get(BARBER_RECOVERY_COOKIE)?.value;
      valida = !!user && recuperacionValidaPara(constancia, user.id);
    } catch {
      valida = false;
    }
    if (!valida) redirect(BARBER_RECOVER_PATH);
  }

  const { name, value } = BARBER_PASSWORD_READY_PARAM;
  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={
        <BarberRestablecerForm
          enlaceValido={!enlaceMalo}
          guardarUrl={`${BARBER_RESET_PATH}/guardar`}
          recuperarHref={BARBER_RECOVER_PATH}
          loginHref={BARBER_LOGIN_PATH}
          loginListoHref={`${BARBER_LOGIN_PATH}?${name}=${value}`}
        />
      }
    />
  );
}
