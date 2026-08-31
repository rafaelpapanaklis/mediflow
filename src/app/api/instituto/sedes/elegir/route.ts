import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { resolveEduCampusChoice } from "@/lib/edu/campus";
import { EDU_CAMPUS_COOKIE } from "@/lib/edu/campus-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/sedes/elegir — el SELECTOR de la barra superior.
 * Body: { campusId: "<id>" | "todas" }.
 *
 * 🔴 NO EXIGE `sedes.view` NI `sedes.manage`, y no es un olvido. Cambiar de
 * sede es moverse entre lo que el ACCESO (edu_user_campus_access) ya
 * autoriza: pedir un permiso para eso dejaría a un docente del campus norte
 * sin poder mirar su propia agenda hasta que alguien le encendiera un
 * interruptor. Lo que sí exige es SESIÓN y poder entrar al panel
 * (`inicio.view`) — que es el permiso que abre todas las pantallas donde
 * este selector se pinta.
 *
 * 🔴 LA COOKIE NO CONCEDE NADA. Lo que llega se pasa por
 * resolveEduCampusChoice, que lo valida contra las sedes de ESTE instituto
 * y de ESTA persona; una sede ajena se degrada a la vista consolidada de lo
 * suyo. Y se vuelve a validar en CADA lectura (getEduCampusScope), así que
 * una cookie que envejezca —a alguien le retiran un acceso— deja de valer
 * sola.
 *
 * `httpOnly`: la cookie no la lee ningún script del navegador, solo el
 * servidor; el selector ya sabe qué está viendo porque se lo dijo el
 * servidor al pintar.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("inicio.view");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const { value, scope } = await resolveEduCampusChoice(g.ctx, body.campusId);

    const res = NextResponse.json({ ok: true, campusId: value, activeId: scope.activeId });
    res.cookies.set(EDU_CAMPUS_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
    return res;
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/sedes/elegir");
  }
}
