import { origenPublicoDe } from "@/lib/url-publica";
import { NextRequest, NextResponse } from "next/server";
import { clearActiveClinicCookie } from "@/lib/active-clinic";
import { clearVerComoCookie } from "@/lib/auth/two-factor-cookie";
import { createClient } from "@/lib/supabase/server";
import { cerrarSuplantacion, estadoSuplantacionDe } from "@/lib/admin/suplantacion";

/**
 * «Salir y volver a /admin» de la barra de «Ver como clínica» (ws1-t11).
 *
 * Cierra SOLO la sesión de suplantación de este navegador: la marca cerrada en
 * admin_impersonation_sessions y hace signOut con scope "local" (el "global" de
 * por defecto echaría al dueño real de todos sus dispositivos). Si la sesión de
 * este navegador no es una suplantación —un usuario de verdad—, no se toca nada.
 * El middleware exige Origin de esta web (POST bajo /api/admin).
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const estado = await estadoSuplantacionDe(supabase);
  let destino = "/admin";
  if (estado.tipo !== "normal") {
    if (estado.tipo === "activa") await cerrarSuplantacion(estado.fila.id, "salida");
    destino = `/admin/clinics/${encodeURIComponent(estado.fila.clinicId)}`;
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ya cerrada */ }
  }
  const res = NextResponse.redirect(`${origenPublicoDe(req, req.url)}${destino}`, 303);
  if (estado.tipo !== "normal") {
    clearActiveClinicCookie(res);
    clearVerComoCookie(res);
  }
  return res;
}
