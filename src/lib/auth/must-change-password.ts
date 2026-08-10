// Contraseña temporal pendiente de cambio — fuente única del flujo.
//
// NO es edge-safe (arrastra prisma + supabase-js): lo importan el layout de
// /dashboard, la página del cambio y los route handlers, todos en runtime Node.
// El middleware NO debe importar de aquí (para eso está two-factor-constants,
// que sí es edge-safe).

import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Ruta del cambio forzado. EXENTA del gate (si no, loop) y renderizada con
// layout mínimo — sin sidebar ni topbar — para que no se pueda usar el panel.
export const MUST_CHANGE_PASSWORD_PATH = "/dashboard/cambiar-contrasena";

// Service-role client. Mismo patrón que /api/team/[id]/reset-password —
// SUPABASE_SERVICE_ROLE_KEY NUNCA se expone al cliente.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function hasServiceRole(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * ¿La cuenta de Supabase Auth entra con correo + contraseña?
 *
 * El riesgo serio de este flujo son los usuarios de GOOGLE: no tienen
 * contraseña propia, así que exigirles una es pedirles que inventen una
 * credencial que su login no usa. El caso se detecta por las `identities` de
 * Auth (los proveedores vinculados a la cuenta) y NO se les marca.
 *
 * Ante la duda devuelve true (= tratar como usuario de contraseña):
 *   • En el punto de MARCA el caso normal por lejos es contraseña — y los tres
 *     puntos que marcan acaban de escribir una con createUser/updateUserById.
 *   • En el ESCAPE del gate, true sólo significa mostrar la pantalla, que
 *     funciona igual para cualquier cuenta (el cambio va por Admin API) y desde
 *     la que siempre se puede cerrar sesión. Nunca deja a nadie atrapado.
 */
export async function hasPasswordIdentity(supabaseId: string): Promise<boolean> {
  if (!supabaseId || !hasServiceRole()) return true;
  try {
    const { data, error } = await getAdminClient().auth.admin.getUserById(supabaseId);
    if (error || !data?.user) return true;
    const identities = data.user.identities ?? [];
    // Sin identities (cuentas viejas de GoTrue) no hay nada que concluir.
    if (identities.length === 0) return true;
    return identities.some((i) => i.provider === "email");
  } catch {
    return true;
  }
}

/**
 * Pone/quita la marca en TODAS las filas User del mismo supabaseId.
 *
 * El schema es @@unique([supabaseId, clinicId]): una persona tiene UNA fila User
 * POR clínica y /api/clinics crea cada sucursal con el supabaseId del dueño. La
 * contraseña, en cambio, vive en Supabase Auth y es GLOBAL — una sola para todas
 * sus sedes. Si sólo tocáramos la fila de la clínica activa, el gate del layout
 * (que lee la fila de la clínica en la que estás) dejaría pasar por una sede lo
 * que bloquea en otra: bastaría cambiar de clínica en el switcher para saltárselo
 * en un sentido, o pediría cambiar de nuevo una contraseña ya cambiada en el
 * otro. Mismo criterio que el cambio de correo del commit 10fc1b52.
 *
 * Sin filtro de clinicId A PROPÓSITO: la contraseña es global, así que la marca
 * también. El aislamiento multi-tenant lo garantiza quien llama, que ya validó
 * que el target es de su clínica antes de resolver su supabaseId.
 */
async function setMustChangePassword(supabaseId: string, value: boolean): Promise<number> {
  const { count } = await prisma.user.updateMany({
    where: { supabaseId },
    data:  { mustChangePassword: value },
  });
  return count;
}

/**
 * Exige contraseña propia. Llamar SÓLO después de que Supabase Auth haya
 * aceptado la contraseña temporal — si Auth falló, no hay nada que exigir.
 * Las cuentas de Google quedan exentas (ver hasPasswordIdentity).
 */
export async function markMustChangePassword(supabaseId: string): Promise<void> {
  if (!supabaseId) return;
  if (!(await hasPasswordIdentity(supabaseId))) {
    console.log(JSON.stringify({
      type: "auth.mustChangePassword.skippedOAuth",
      supabaseId,
    }));
    return;
  }
  await setMustChangePassword(supabaseId, true);
}

/** Levanta la exigencia. Sólo tras un cambio de contraseña confirmado por Auth. */
export async function clearMustChangePassword(supabaseId: string): Promise<void> {
  if (!supabaseId) return;
  await setMustChangePassword(supabaseId, false);
}
