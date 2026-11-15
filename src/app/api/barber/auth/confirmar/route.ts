import { NextRequest, NextResponse } from "next/server";
import { origenPublicoDe } from "@/lib/url-publica";
import { createClient } from "@/lib/supabase/server";
import { borrarDesbloqueos } from "@/lib/sede-clave/core";
import { BARBER_RESET_PATH } from "@/lib/barber/contrasena";
import {
  BARBER_RECOVERY_COOKIE,
  BARBER_RECOVERY_COOKIE_BORRAR,
  BARBER_RECOVERY_COOKIE_OPTS,
  firmarRecuperacion,
} from "@/lib/barber/recuperacion-cookie";

export const dynamic = "force-dynamic";

/**
 * GET /api/barber/auth/confirmar — aterrizaje del enlace del correo de
 * «Olvidé mi contraseña» de Barber.
 *
 * Copia de /auth/confirm (que no se toca) con el destino FIJO: no lee `next`
 * de la URL, así que no hay redirección abierta que vigilar. Mismo canje:
 *  · plantilla con token_hash/type (verifyOtp), que sirve en otro dispositivo;
 *  · plantilla por defecto ({{ .ConfirmationURL }}, PKCE) con ?code=
 *    (exchangeCodeForSession; el verificador es la cookie que dejó
 *    /api/barber/auth/recuperar en este navegador).
 *
 * Bien → /barber/restablecer con la sesión de recuperación puesta y la
 * cookie firmada «vienes de un enlace» (ver @/lib/barber/recuperacion-cookie),
 * que es lo único que abre el restablecer.
 * Mal (caducado, ya usado, otro navegador) → /barber/restablecer con
 * ?error=link_invalido, que ofrece pedir otro. La de allá, en el caso «mal»
 * sin type=recovery, mandaba al inicio de sesión de las clínicas.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = origenPublicoDe(request, request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const fallo = () => {
    const res = NextResponse.redirect(`${origin}${BARBER_RESET_PATH}?error=link_invalido`);
    // Un enlace malo no deja viva la constancia de uno bueno anterior.
    res.cookies.set(BARBER_RECOVERY_COOKIE, "", BARBER_RECOVERY_COOKIE_BORRAR);
    return res;
  };
  /**
   * El enlace era bueno: la constancia «vienes de un enlace de recuperación»
   * para ESTE usuario (ronda 7, M1). Sin ella /barber/restablecer no deja
   * cambiar nada. Sin secreto para firmarla, falla cerrado.
   */
  const listo = (supabaseId: string | null | undefined) => {
    const constancia = supabaseId ? firmarRecuperacion(supabaseId) : null;
    if (!constancia) return fallo();
    const res = NextResponse.redirect(`${origin}${BARBER_RESET_PATH}`);
    res.cookies.set(BARBER_RECOVERY_COOKIE, constancia, BARBER_RECOVERY_COOKIE_OPTS);
    // Sesión nueva: igual que /auth/confirm, fuera los desbloqueos de la
    // clave de sede de una sesión anterior en este navegador.
    borrarDesbloqueos(res, request.headers.get("cookie"));
    return res;
  };

  if (searchParams.get("error")) return fallo();

  try {
    const supabase = await createClient();
    if (tokenHash && type === "recovery") {
      const { data, error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
      return error ? fallo() : listo(data?.user?.id ?? data?.session?.user?.id);
    }
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return error ? fallo() : listo(data?.user?.id ?? data?.session?.user?.id);
    }
  } catch {
    return fallo();
  }
  return fallo();
}
