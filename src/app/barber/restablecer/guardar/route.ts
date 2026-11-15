import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseJs } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { leerErrorContrasena } from "@/lib/auth/errores-contrasena";
import {
  BARBER_MUST_CHANGE_KEY,
  barberDebeCambiarContrasena,
  problemaContrasenaNueva,
} from "@/lib/barber/contrasena";
import {
  BARBER_RECOVERY_COOKIE,
  BARBER_RECOVERY_COOKIE_BORRAR,
  recuperacionValidaPara,
} from "@/lib/barber/recuperacion-cookie";

export const dynamic = "force-dynamic";

/**
 * POST /barber/restablecer/guardar — poner la contraseña nueva tras abrir el
 * enlace del correo (revisión ws6-t2 ronda 7, M1 y M3).
 *
 * Vive bajo /barber/restablecer para que la cookie firmada de recuperación
 * (Path=/barber/restablecer) solo viaje aquí y a la pantalla.
 *
 * Antes la pantalla cambiaba la contraseña desde el navegador con cualquier
 * sesión abierta. Ahora:
 *  1. Exige la cookie de /api/barber/auth/confirmar, firmada, viva y del
 *     MISMO usuario de la sesión. Sin ella: 401 y no se toca nada.
 *  2. Cambia la contraseña de ESE usuario con su propia sesión: el mismo
 *     updateUser del dental, con las reglas de GoTrue (p. ej. «distinta de la
 *     anterior») y la misma regla de fuerza.
 *  3. Apaga la marca «debes cambiar tu contraseña» si estaba puesta (M3): quien
 *     recupera ya eligió una suya y no tiene que poner otra al entrar.
 *  4. Borra la cookie (un solo uso) y cierra la sesión de recuperación, como
 *     el dental, para que se entre limpio por /barber/entrar.
 *
 * La cookie es SameSite=Lax: un POST desde otro sitio no la lleva.
 * Ninguna contraseña va al log.
 */

type Codigo = "enlace_invalido" | "debil" | "larga" | "no_coinciden" | "igual" | "filtrada" | "rechazada" | "error";

const TEXTO: Record<Codigo, string> = {
  enlace_invalido: "Este enlace ya no sirve. Pide otro y ábrelo en este mismo navegador.",
  debil: "Muy débil: usa al menos 8 caracteres y mezcla mayúsculas, minúsculas y números.",
  larga: "Usa 72 caracteres o menos.",
  no_coinciden: "Las contraseñas no coinciden.",
  igual: "La contraseña nueva tiene que ser distinta de la anterior.",
  filtrada: "Esa contraseña apareció en filtraciones públicas. Elige otra.",
  rechazada: "Esa contraseña no se acepta. Prueba con otra más larga y variada.",
  error: "No pudimos guardar la contraseña. Inténtalo de nuevo.",
};

function falla(code: Codigo, status: number, borrarCookie = false) {
  const res = NextResponse.json({ error: TEXTO[code], code }, { status });
  if (borrarCookie) res.cookies.set(BARBER_RECOVERY_COOKIE, "", BARBER_RECOVERY_COOKIE_BORRAR);
  return res;
}

export async function POST(req: NextRequest) {
  const sesion = await createSessionClient();
  const { data } = await sesion.auth.getUser();
  const usuario = data?.user ?? null;

  // 1. Solo con la constancia de un enlace de recuperación de ESTE usuario.
  const constancia = req.cookies.get(BARBER_RECOVERY_COOKIE)?.value;
  if (!usuario || !recuperacionValidaPara(constancia, usuario.id)) {
    return falla("enlace_invalido", 401, true);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return falla("error", 400);
  }
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmacion = typeof body?.confirmacion === "string" ? body.confirmacion : "";
  const problema = problemaContrasenaNueva(password);
  if (problema) return falla(problema, 400);
  if (confirmacion !== password) return falla("no_coinciden", 400);

  // 2. La contraseña, con la sesión de la persona (mecanismo del dental).
  const { error } = await sesion.auth.updateUser({ password });
  if (error) {
    const de = leerErrorContrasena(error);
    const code: Codigo = !de
      ? /session/i.test(error.message ?? "")
        ? "enlace_invalido"
        : "error"
      : de.motivo === "igual"
        ? "igual"
        : de.motivo === "filtrada"
          ? "filtrada"
          : de.motivo === "larga"
            ? "larga"
            : "rechazada";
    if (code === "error") console.error("[barber/restablecer/guardar] supabase falló:", error.message ?? "");
    return falla(code, code === "enlace_invalido" ? 401 : code === "error" ? 500 : 400, code === "enlace_invalido");
  }

  // 3. La marca de la temporal, si la había (M3). La contraseña ya cambió: si
  //    esto falla se registra y se sigue; lo peor es que al entrar se le pida
  //    otra una vez.
  if (barberDebeCambiarContrasena(usuario.app_metadata)) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      if (!url || !service) throw new Error("falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL");
      const admin = createSupabaseJs(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: errMarca } = await admin.auth.admin.updateUserById(usuario.id, {
        app_metadata: { [BARBER_MUST_CHANGE_KEY]: false },
      });
      if (errMarca) throw new Error(errMarca.message ?? "updateUserById");
    } catch (e) {
      console.error("[barber/restablecer/guardar] no se pudo quitar la marca de la temporal:", e instanceof Error ? e.message : e);
    }
  }

  // 4. Un solo uso, y fuera la sesión de recuperación (como el dental).
  try {
    await sesion.auth.signOut();
  } catch {
    /* la entrada pide la contraseña igual */
  }
  console.log(JSON.stringify({ type: "barber.password.recovered", supabaseId: usuario.id }));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(BARBER_RECOVERY_COOKIE, "", BARBER_RECOVERY_COOKIE_BORRAR);
  return res;
}
