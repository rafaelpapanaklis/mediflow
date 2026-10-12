import { origenPublicoDe } from "@/lib/url-publica";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { estadoSuplantacionDe } from "@/lib/admin/suplantacion";
import { COOKIE_SESION_PREVIA } from "@/lib/admin/suplantacion-core";
import { cookiesDeSalida, salirDeSuplantacion } from "@/lib/admin/suplantacion-salida";

/**
 * «Salir y volver a /admin» de la barra de «Ver como clínica» (ws1-t11).
 *
 * Cierra SOLO la sesión de suplantación de este navegador: la marca cerrada en
 * admin_impersonation_sessions y la revoca con scope "local" (el "global" de
 * por defecto echaría al dueño real de todos sus dispositivos). Si antes de
 * entrar el navegador tenía su propia sesión del panel, vuelve a ella
 * (revisión del 2-oct: antes quedaba sin sesión y /dashboard mandaba a /login).
 * Si la sesión de este navegador no es una suplantación —un usuario de verdad—,
 * no se toca nada. El middleware exige Origin de esta web (POST bajo /api/admin).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const estado = await estadoSuplantacionDe(supabase);
  if (estado.tipo === "normal") {
    return NextResponse.redirect(`${origenPublicoDe(req, req.url)}/admin`, 303);
  }
  const salida = await salirDeSuplantacion(supabase, estado, req.cookies.get(COOKIE_SESION_PREVIA)?.value);
  const destino = `/admin/clinics/${encodeURIComponent(estado.fila.clinicId)}`;
  const res = NextResponse.redirect(`${origenPublicoDe(req, req.url)}${destino}`, 303);
  cookiesDeSalida(res, salida);
  return res;
}
