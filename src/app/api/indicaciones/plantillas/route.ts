import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { anotarFilaDeModulo } from "@/lib/movimientos-paciente/modulos";
import { catalogoLigable, repoHojasVigente } from "@/lib/indicaciones/db";
import { crearHoja } from "@/lib/indicaciones/servicio";

export const dynamic = "force-dynamic";

// POST /api/indicaciones/plantillas — crea una hoja de la clínica (indicaciones o
// constancia), o una copia de otra (`copiaDe`). Mismo permiso que el resto de
// Administración → Plantillas; `clinicId` sale de la sesión, nunca del cuerpo.
// Sin el SQL pegado contesta 503 SIN_TABLA (la pantalla ni enseña el botón).
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, TEMPLATES_WRITE_PERMISSION);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  try {
    const catalogo = await catalogoLigable(ctx.clinicId);
    const r = await crearHoja(
      repoHojasVigente,
      ctx.clinicId,
      ctx.userId,
      { tipo: body.tipo, nombre: body.nombre, cuerpo: body.cuerpo, procedureIds: body.procedureIds, copiaDe: body.copiaDe },
      catalogo,
    );
    if (r.ok === false) return NextResponse.json({ code: r.codigo }, { status: r.status });
    try {
      await anotarFilaDeModulo({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        entityType: "handout-template",
        entityId: r.hoja.id,
        action: "create",
        changes: {
          _created: {
            before: null,
            after: { tipo: r.hoja.tipo, nombre: r.hoja.nombre, copiaDe: typeof body.copiaDe === "string" ? body.copiaDe : null },
          },
        },
      });
    } catch (e) {
      console.error("[indicaciones] bitácora (crear):", e);
    }
    return NextResponse.json(r.hoja, { status: 201 });
  } catch (err) {
    console.error("Crear hoja de indicaciones:", err);
    return NextResponse.json({ error: "Error al crear la plantilla" }, { status: 500 });
  }
}
