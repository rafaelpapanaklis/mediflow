import { NextRequest, NextResponse } from "next/server";
import { origenPublicoDe } from "@/lib/url-publica";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_VER_COMO_PREVIA } from "@/lib/barber/ver-como-core";
import { cookiesDeSalidaVerComo, estadoVerComoDe, fichaDeAdmin, salirDeVerComo } from "@/lib/barber/ver-como";

/**
 * «Salir y volver a /admin» de la barra de «Ver como barbería» (ws6-t1).
 *
 * Cierra SOLO la sesión de inspección de este navegador (la marca cerrada en
 * barber_admin_impersonation_sessions y la revoca con scope "local") y, si
 * antes de entrar había otra sesión, vuelve a ella. Si la sesión no es un
 * «Ver como barbería» —un usuario de verdad—, no toca nada. El middleware
 * exige Origin de esta web (POST bajo /api/admin).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const estado = await estadoVerComoDe(supabase);
  if (estado.tipo === "normal") {
    return NextResponse.redirect(`${origenPublicoDe(req, req.url)}/admin/barberias`, 303);
  }
  const salida = await salirDeVerComo(supabase, estado, req.cookies.get(COOKIE_VER_COMO_PREVIA)?.value);
  const res = NextResponse.redirect(`${origenPublicoDe(req, req.url)}${fichaDeAdmin(estado.fila.barbershopId)}`, 303);
  cookiesDeSalidaVerComo(res, salida);
  return res;
}
