// Vista previa «sin módulo» (ws1-t3) — SOLO fuera de producción.
//
// La clínica de prueba de dev.108 TIENE Ortodoncia, así que el candado del
// menú y la página de contratar no se podían ver. Esto pone (o quita) una
// cookie que hace que ESTE navegador vea la clínica como si no la tuviera:
//
//   /dashboard/orthodontics/contratar/vista-previa            → entra
//   /dashboard/orthodontics/contratar/vista-previa?salir=1    → sale
//
// No toca la base ni el acceso de nadie. Solo puede QUITAR el módulo a la
// vista, nunca darlo. En producción responde 404 y la cookie, aunque alguien
// la ponga a mano, se ignora (`vistaPreviaSinModulo`).
import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  RUTA_CONTRATAR_ORTODONCIA,
  RUTA_MODULO_ORTODONCIA,
} from "@/lib/orthodontics/contratar";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const salir = req.nextUrl.searchParams.get("salir") === "1";
  // `Location` relativa: detrás del proxy, `req.url` trae el host interno.
  const res = new NextResponse(null, {
    status: 307,
    headers: { Location: salir ? RUTA_MODULO_ORTODONCIA : RUTA_CONTRATAR_ORTODONCIA },
  });
  res.cookies.set(COOKIE_VISTA_PREVIA_SIN_MODULO, salir ? "" : "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: salir ? 0 : 60 * 60 * 4,
  });
  return res;
}
