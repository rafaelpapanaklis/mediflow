import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { anotarFilaDeModulo } from "@/lib/movimientos-paciente/modulos";
import { catalogoLigable, repoHojas } from "@/lib/indicaciones/db";
import { editarHoja } from "@/lib/indicaciones/servicio";

export const dynamic = "force-dynamic";

// PATCH /api/indicaciones/plantillas/[id] — nombre, texto, procedimientos ligados
// y «en uso». Las de fábrica solo cambian liga y «en uso» (409 FABRICA_NO_SE_EDITA
// si se intenta el texto). Nada se borra: se apaga.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, TEMPLATES_WRITE_PERMISSION);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  try {
    const catalogo = await catalogoLigable(ctx.clinicId);
    const r = await editarHoja(
      repoHojas,
      ctx.clinicId,
      params.id,
      { nombre: body.nombre, cuerpo: body.cuerpo, procedureIds: body.procedureIds, activa: body.activa },
      catalogo,
    );
    if (r.ok === false) return NextResponse.json({ code: r.codigo }, { status: r.status });
    const antes = r.antes;
    const cambio = (k: "nombre" | "cuerpo" | "activa" | "procedureIds") =>
      antes && JSON.stringify(antes[k]) !== JSON.stringify(r.hoja[k]);
    const campos = (["nombre", "cuerpo", "activa", "procedureIds"] as const).filter(cambio);
    if (campos.length > 0) {
      try {
        await anotarFilaDeModulo({
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          entityType: "handout-template",
          entityId: r.hoja.id,
          action: "update",
          // Nombres de lo que cambió y el antes/después de lo corto; el texto completo no se copia a la bitácora.
          changes: {
            campos: { before: null, after: campos },
            ...(cambio("nombre") ? { nombre: { before: antes!.nombre, after: r.hoja.nombre } } : {}),
            ...(cambio("activa") ? { activa: { before: antes!.activa, after: r.hoja.activa } } : {}),
            ...(cambio("procedureIds") ? { procedureIds: { before: antes!.procedureIds, after: r.hoja.procedureIds } } : {}),
          },
        });
      } catch (e) {
        console.error("[indicaciones] bitácora (editar):", e);
      }
    }
    return NextResponse.json(r.hoja);
  } catch (err) {
    console.error("Editar hoja de indicaciones:", err);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}
