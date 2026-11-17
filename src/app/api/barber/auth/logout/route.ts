import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_VER_COMO_PREVIA } from "@/lib/barber/ver-como-core";
import { cookiesDeSalidaVerComo, estadoVerComoDe, fichaDeAdmin, salirDeVerComo } from "@/lib/barber/ver-como";

// Cierra la sesión Supabase del usuario de barbería (espejo de
// /api/laboratorios/auth/logout). El sidebar redirige después a /login.
//
// «Ver como barbería» (ws6-t1): ahí «Cerrar sesión» cierra SOLO la sesión de
// inspección (scope "local") y vuelve a la sesión que el admin tenía antes,
// igual que «Salir y volver a /admin». El signOut de siempre es "global" y
// echaría al dueño real de todos sus dispositivos. Responde `redirect` para
// que el sidebar lleve al admin a la ficha y no a la entrada del panel.
export async function POST(request: Request) {
  const supabase = await createClient();
  const verComo = await estadoVerComoDe(supabase);
  if (verComo.tipo !== "normal") {
    const cookiePrevia = request.headers.get("cookie")?.split(/;\s*/)
      .find((c) => c.startsWith(`${COOKIE_VER_COMO_PREVIA}=`))?.slice(COOKIE_VER_COMO_PREVIA.length + 1);
    const salida = await salirDeVerComo(supabase, verComo, cookiePrevia);
    const res = NextResponse.json({ ok: true, redirect: fichaDeAdmin(verComo.fila.barbershopId) });
    cookiesDeSalidaVerComo(res, salida);
    return res;
  }
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
