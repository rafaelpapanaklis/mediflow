/* ============================================================
   EQUIPO — escribir una contraseña en la cuenta de acceso de un miembro.

   Lo comparten POST /api/team/[id]/reset-password (temporal que genera el
   panel) y POST /api/team/[id]/set-password (la que escribe el dueño). Los
   PERMISOS no viven aquí: quien llama ya comprobó que es el SUPER_ADMIN de la
   clínica del miembro, que no es él mismo ni otro SUPER_ADMIN.

   Supabase Auth, al cambiar la contraseña por la API de administración
   (PUT /admin/users/{id}), llama a `user.UpdatePassword(tx, nil)`, que con
   sessionID nil hace `Logout(tx, u.ID)`: TODAS las sesiones del miembro se
   cierran en el mismo paso (supabase/auth, internal/models/user.go).

   Si la fila apunta a una cuenta de Auth que ya no existe (o nunca existió),
   se le CREA con el correo de su ficha y esa contraseña, y la fila (y sus
   hermanas del mismo id muerto) pasa a apuntar a ella.
   ============================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { clasificarErrorAuth, esCorreoMarcador, esUuid, ERROR_SIN_CUENTA } from "@/lib/team/auth-errors";

export interface MiembroConCuenta {
  supabaseId: string;
  email: string;
}

export type ResultadoContrasena =
  | { ok: true; supabaseId: string; cuentaCreada: boolean }
  | { ok: false; status: number; error: string; code?: string };

function esContrasenaDebil(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string };
  return e.code === "weak_password" || /weak.?password|password should/i.test(String(e.message ?? ""));
}

export async function aplicarContrasenaAlMiembro(opts: {
  admin: SupabaseClient;
  miembro: MiembroConCuenta;
  contrasena: string;
  /** Botón que el admin tiene que volver a pulsar tras corregir el correo. */
  nombreBoton: string;
  /** Prefijo de los console.error (nunca se registra la contraseña). */
  origen: string;
}): Promise<ResultadoContrasena> {
  const { admin, miembro, contrasena, nombreBoton, origen } = opts;

  // Un supabaseId que no es UUID (demo, muestra de QA) haría LANZAR a supabase-js.
  const updateError: any = !esUuid(miembro.supabaseId)
    ? ERROR_SIN_CUENTA
    : (await admin.auth.admin.updateUserById(miembro.supabaseId, { password: contrasena })).error;

  if (!updateError) return { ok: true, supabaseId: miembro.supabaseId, cuentaCreada: false };

  if (esContrasenaDebil(updateError)) {
    return { ok: false, status: 400, error: "Supabase rechazó la contraseña por débil. Elige otra más larga o menos común.", code: "CONTRASENA_DEBIL" };
  }
  if (clasificarErrorAuth(updateError) !== "cuenta-no-existe") {
    console.error(`[${origen}] supabase update failed:`, updateError);
    return { ok: false, status: 500, error: "No se pudo actualizar la contraseña en Supabase" };
  }

  // El miembro NO tiene cuenta de acceso: su fila apunta a un usuario de Auth
  // que ya no existe (BEVADENT, 28-sep-2026: el reinicio de la clínica la borró
  // y dejó la fila con un correo de relleno). Lo que el admin quiere es que esa
  // persona pueda entrar: se le crea la cuenta.
  if (esCorreoMarcador(miembro.email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(miembro.email)) {
    return {
      ok: false,
      status: 400,
      error: `Este miembro no tiene cuenta de acceso y su correo no es uno real. Edítalo, escribe su correo verdadero, guarda, y vuelve a pulsar «${nombreBoton}» para crearle el acceso.`,
      code: "SIN_CUENTA_SIN_CORREO",
    };
  }

  const { data: creada, error: createError } = await admin.auth.admin.createUser({
    email: miembro.email.trim().toLowerCase(),
    password: contrasena,
    email_confirm: true,
  });
  if (createError || !creada?.user) {
    if (createError && esContrasenaDebil(createError)) {
      return { ok: false, status: 400, error: "Supabase rechazó la contraseña por débil. Elige otra más larga o menos común.", code: "CONTRASENA_DEBIL" };
    }
    if (createError && clasificarErrorAuth(createError) === "correo-ya-registrado") {
      return {
        ok: false,
        status: 400,
        error: "Ese correo ya tiene cuenta en DaleControl (de otra persona o de otra clínica). Cámbialo por otro distinto y vuelve a intentar.",
      };
    }
    console.error(`[${origen}] no se pudo crear la cuenta de acceso:`, createError);
    return { ok: false, status: 500, error: "No se pudo crear la cuenta de acceso de este miembro" };
  }

  try {
    // Todas las filas que compartían el id muerto (una persona = una fila por
    // sucursal): todas quedan con la cuenta nueva o ninguna.
    await prisma.user.updateMany({
      where: { supabaseId: miembro.supabaseId },
      data: { supabaseId: creada.user.id },
    });
  } catch (e) {
    // La cuenta recién creada no sirve de nada sin la fila enlazada, y dejarla
    // ocuparía el correo. Se deshace para poder reintentar limpio.
    await admin.auth.admin.deleteUser(creada.user.id).catch(() => {});
    console.error(`[${origen}] no se pudo enlazar la cuenta nueva:`, e);
    return { ok: false, status: 500, error: "No se pudo enlazar la cuenta de acceso nueva. No se cambió nada; vuelve a intentar." };
  }
  return { ok: true, supabaseId: creada.user.id, cuentaCreada: true };
}
