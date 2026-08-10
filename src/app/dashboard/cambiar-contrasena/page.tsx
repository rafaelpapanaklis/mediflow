import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { clearMustChangePassword, hasPasswordIdentity } from "@/lib/auth/must-change-password";
import { ChangePasswordClient } from "./change-password-client";

export const dynamic = "force-dynamic";

// Cambio forzado de contraseña temporal. El layout de /dashboard exenta esta
// ruta del gate y la renderiza con layout mínimo (sin sidebar/topbar). Aquí sólo
// se enrutan los casos borde; el formulario lo maneja el componente cliente.
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();

  // Nadie que no deba estar aquí se queda aquí: sin la marca, al panel. Cubre
  // tanto al usuario normal que escribe la URL a mano como al que ya la cambió
  // y vuelve con el botón de atrás.
  if (!(user as { mustChangePassword?: boolean }).mustChangePassword) {
    redirect("/dashboard");
  }

  // ESCAPE para cuentas de Google (OAuth). markMustChangePassword ya evita
  // marcarlas, pero esto cierra el caso por el otro extremo: una fila marcada
  // por cualquier vía (una marca anterior a este chequeo, una cuenta que dejó de
  // tener identidad de correo) dejaría a esa persona rebotando contra una
  // pantalla que le pide una credencial que su login no usa. Si no hay identidad
  // de contraseña, se limpia la marca y entra al panel.
  //
  // El coste (una llamada al Admin API) sólo se paga en esta página, que sólo se
  // renderiza cuando la marca está puesta — no en cada render del dashboard.
  if (!(await hasPasswordIdentity(user.supabaseId))) {
    await clearMustChangePassword(user.supabaseId);
    redirect("/dashboard");
  }

  return <ChangePasswordClient />;
}
