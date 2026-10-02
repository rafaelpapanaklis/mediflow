import { urlPublicaDe } from "@/lib/url-publica";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TWO_FA_COOKIE, TWO_FA_PENDING_COOKIE, TWO_FA_ADMIN_COOKIE } from "@/lib/auth/two-factor-constants";
import { cerrarSuplantacion, estadoSuplantacionDe } from "@/lib/admin/suplantacion";

export async function POST(request: Request) {
  const supabase = createClient();
  // ws1-t11: «Cerrar sesión» dentro de «Ver como clínica» cierra SOLO la sesión
  // de suplantación (scope "local"). El signOut de siempre es "global" y echaría
  // al dueño real de todos sus dispositivos: la clínica lo notaría.
  const suplantacion = await estadoSuplantacionDe(supabase);
  if (suplantacion.tipo === "normal") {
    await supabase.auth.signOut();
  } else {
    if (suplantacion.tipo === "activa") await cerrarSuplantacion(suplantacion.fila.id, "salida");
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ya cerrada */ }
  }

  const res = NextResponse.redirect(urlPublicaDe(request, "/login"));
  // Limpiar cookies custom del dashboard para evitar que sobrevivan a la sesión.
  res.cookies.set("activeClinicId", "", { path: "/", maxAge: 0 });
  res.cookies.set("notifLastSeen", "", { path: "/", maxAge: 0 });
  // 2FA: la prueba y el flag pendiente no deben sobrevivir al cierre de sesión.
  res.cookies.set(TWO_FA_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(TWO_FA_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  // ws1-t8: ni la prueba de «Ver como clínica».
  res.cookies.set(TWO_FA_ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
