import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduTeamMember, createEduTeamMembers } from "@/lib/edu/equipo";

export const dynamic = "force-dynamic";

/**
 * ⚠️ NO HAY GET aquí, y no es un olvido: la lista la pinta el servidor en
 * /instituto/equipo, y después de un alta la pantalla llama a
 * router.refresh(), que vuelve a pedir ESE árbol. Un GET que nadie llama es
 * superficie de ataque sin lector — la misma regla que el catálogo de
 * permisos aplica a las keys, aplicada a los endpoints.
 */

/**
 * POST /api/instituto/equipo — da de alta una cuenta, o un trozo de lista.
 *
 * Dos formas en un solo endpoint porque hacen exactamente lo mismo y la
 * masiva es la individual repetida:
 *   · `{ firstName, lastName, email, role, phone? }`  → una persona
 *   · `{ rows: [ {…}, {…} ] }`                        → hasta 25 personas
 *
 * 🔴 SE VUELVE A VALIDAR TODO. El navegador ya enseñó una vista previa con
 * los renglones buenos y los malos, pero esa vista previa la hizo el
 * cliente: aquí cada fila pasa otra vez por `eduTeamMemberInput` antes de
 * tocar Supabase.
 *
 * 🔴 La respuesta lleva la CONTRASEÑA TEMPORAL, y es la única vez que
 * existe: no se guarda en ninguna parte. Sale en el cuerpo a propósito,
 * igual que en el alta de equipo del dental, y la pantalla la enseña con un
 * botón de copiar. Si se pierde, hay que restablecerla desde Supabase.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const nombreInstituto = g.ctx.institution.name;

    if (Array.isArray(body.rows)) {
      const results = await createEduTeamMembers(g.ctx, body.rows, nombreInstituto);
      const creadas = results.filter((r) => r.ok).length;
      // 200 y no 201 aunque haya creaciones: en un alta masiva lo normal es
      // que unas pasen y otras no, y un 201 diría que se creó "el recurso",
      // que aquí no es uno.
      return NextResponse.json({ results, creadas, total: results.length });
    }

    const result = await createEduTeamMember(g.ctx, body, nombreInstituto);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/equipo");
  }
}
