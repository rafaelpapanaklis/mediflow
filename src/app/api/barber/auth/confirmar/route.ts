import { NextRequest, NextResponse } from "next/server";
import { origenPublicoDe } from "@/lib/url-publica";
import { createClient } from "@/lib/supabase/server";
import { borrarDesbloqueos } from "@/lib/sede-clave/core";
import { BARBER_RESET_PATH } from "@/lib/barber/contrasena";

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
 * Bien → /barber/restablecer con la sesión de recuperación puesta.
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

  const fallo = () => NextResponse.redirect(`${origin}${BARBER_RESET_PATH}?error=link_invalido`);
  const listo = () => {
    const res = NextResponse.redirect(`${origin}${BARBER_RESET_PATH}`);
    // Sesión nueva: igual que /auth/confirm, fuera los desbloqueos de la
    // clave de sede de una sesión anterior en este navegador.
    borrarDesbloqueos(res, request.headers.get("cookie"));
    return res;
  };

  if (searchParams.get("error")) return fallo();

  try {
    const supabase = await createClient();
    if (tokenHash && type === "recovery") {
      const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
      return error ? fallo() : listo();
    }
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return error ? fallo() : listo();
    }
  } catch {
    return fallo();
  }
  return fallo();
}
