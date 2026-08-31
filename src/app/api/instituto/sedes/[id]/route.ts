import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduCampus } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/sedes/[id] — nombre, clave, dirección, zona horaria,
 * orden y abrir/cerrar.
 *
 * ⚠️ CERRAR UNA SEDE NO CANCELA SUS CITAS ni mueve sus sillones: sería
 * decidir por la escuela dónde va a sentar a cuarenta pacientes. La saca
 * del selector y de los desplegables de alta; lo agendado se sigue viendo y
 * se reagenda a mano. La pantalla avisa cuántas citas futuras hay antes.
 *
 * 🔴 NO HAY DELETE, y esta vez no es solo por la historia: las filas de
 * acceso (edu_user_campus_access) cuelgan de la sede en CASCADE, y "sin
 * filas" significa "entra a TODAS las sedes". Borrar una sede le abriría el
 * instituto entero a quien solo entraba ahí.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("sedes.manage");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduCampus(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/sedes/[id]");
  }
}
