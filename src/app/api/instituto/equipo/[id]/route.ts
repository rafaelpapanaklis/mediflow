import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { parseEduBoolean } from "@/lib/edu/padron-core";
import { setEduTeamMemberActive, setEduTeamMemberPermissions } from "@/lib/edu/equipo";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/equipo/[id] — da de baja / reactiva una cuenta, o
 * (cierre, P2-8) guarda sus permisos personalizados.
 *
 * 🔴 NO HAY DELETE, y no lo va a haber: sus notas clínicas, sus casos, sus
 * citas y sus cobros apuntan a este id. Dar de baja es escribir
 * `isActive: false`, y con eso getEduContext deja de resolver su sesión —
 * no entra al panel — sin borrar una línea de lo que hizo.
 *
 * 🔴 P2-8 · `permissionsOverride` en el body:
 *   · una LISTA de keys → se sanea (sanitizeEduPermissionKeys) y REEMPLAZA
 *     al default del rol;
 *   · `null` → restaurar el rol (override vacío);
 *   · ausente → los permisos no se tocan.
 * Nadie edita los suyos, y una lista que quede vacía tras sanear rebota —
 * las reglas viven en setEduTeamMemberPermissions y ahí están explicadas.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);

    const tocaEstado = body.isActive !== undefined;
    const tocaPermisos = "permissionsOverride" in body;
    if (!tocaEstado && !tocaPermisos) {
      return NextResponse.json({ error: "No mandaste ningún cambio." }, { status: 400 });
    }

    let permisos: { permissionsOverride: string[] } | null = null;
    if (tocaPermisos) {
      permisos = await setEduTeamMemberPermissions(g.ctx, params.id, body.permissionsOverride);
    }

    let estado: { isActive: boolean } | null = null;
    if (tocaEstado) {
      const isActive = parseEduBoolean(body.isActive);
      if (isActive === null) {
        return NextResponse.json(
          { error: "Di si la cuenta queda activa o dada de baja." },
          { status: 400 },
        );
      }
      estado = await setEduTeamMemberActive(g.ctx, params.id, isActive);
    }

    return NextResponse.json({
      ok: true,
      id: params.id,
      ...(estado ?? {}),
      ...(permisos ?? {}),
    });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/equipo/[id]");
  }
}
