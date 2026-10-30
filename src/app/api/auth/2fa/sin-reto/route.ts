import { NextRequest, NextResponse } from "next/server";
import { clearTwoFactorPending } from "@/lib/auth/two-factor-cookie";
import { destinoSeguro } from "@/lib/sede-clave/core";

export const dynamic = "force-dynamic";

// GET /api/auth/2fa/sin-reto?next=/dashboard… — la salida de /dashboard/2fa (y
// de /dashboard/2fa/setup) cuando ya no hay reto que hacer (repaso iPad ws1-t1,
// M2).
//
// df_2fa_pending es el atajo del middleware: mientras exista, todo /dashboard
// va al reto. Si la persona ya no necesita 2FA —se lo quitaron con la sesión
// abierta, la clínica dejó de exigirlo con ella en el reto, o lo enroló en una
// sede que luego se archivó—, la página del reto mandaba a /dashboard sin
// borrarla y el middleware la devolvía: un bucle de 12 h, sin botón. Aquí se
// borra y se manda al panel.
//
// Sin sesión ni consultas: borrar la cookie no abre nada. Es solo el atajo; el
// gate de verdad (firma de df_2fa + base) vive en el layout y en
// getAuthContext/getCurrentUser, así que quien la borre sin tener derecho cae
// en el reto igual. `next` solo vale dentro de /dashboard (sin open redirect).
export async function GET(req: NextRequest) {
  const destino = destinoSeguro(req.nextUrl.searchParams.get("next"));
  // Location relativa: tras Caddy, req.url trae el host interno.
  const res = new NextResponse(null, { status: 307, headers: { Location: destino } });
  clearTwoFactorPending(res);
  return res;
}
