import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { parseEduBoolean } from "@/lib/edu/padron-core";
import { setEduTeamMemberActive } from "@/lib/edu/equipo";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/equipo/[id] — da de baja o reactiva una cuenta.
 *
 * 🔴 NO HAY DELETE, y no lo va a haber: sus notas clínicas, sus casos, sus
 * citas y sus cobros apuntan a este id. Dar de baja es escribir
 * `isActive: false`, y con eso getEduContext deja de resolver su sesión —
 * no entra al panel — sin borrar una línea de lo que hizo.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const isActive = parseEduBoolean(body.isActive);
    if (isActive === null) {
      return NextResponse.json(
        { error: "Di si la cuenta queda activa o dada de baja." },
        { status: 400 },
      );
    }
    const out = await setEduTeamMemberActive(g.ctx, params.id, isActive);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/equipo/[id]");
  }
}
