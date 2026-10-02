import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import { ORTHO_DEFAULT_TEMPLATES } from "@/lib/clinical-shared/evolution-templates/seed-orthodontics";
import { editarPlantillaNota } from "@/lib/orthodontics/plantillas-nota-service";

export const dynamic = "force-dynamic";

const FABRICA = ORTHO_DEFAULT_TEMPLATES.map((t) => t.name);

// PATCH /api/orthodontics/note-templates/:id — edita nombre y texto, o la
// apaga/enciende (`activa`). Las de fábrica solo admiten `activa`. No hay
// DELETE: apagar es reversible y la fila no se borra.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, TEMPLATES_WRITE_PERMISSION);
  if (denied) return denied;
  if (!(await hasActiveOrthodonticsModule(ctx.clinicId))) {
    return NextResponse.json({ code: "MODULE_REQUIRED", error: "Módulo de Ortodoncia no contratado" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  try {
    const r = await editarPlantillaNota(
      prisma,
      ctx.clinicId,
      params.id,
      { name: body?.name, soap: body?.soap, activa: body?.activa },
      FABRICA,
    );
    if (r.ok === false) return NextResponse.json({ code: r.codigo }, { status: r.status });
    const soloInterruptor = body?.name === undefined && body?.soap === undefined;
    await auditClinicalShared({
      ctx,
      action: soloInterruptor
        ? r.plantilla.activa
          ? "clinical-shared.evolution-template.activated"
          : "clinical-shared.evolution-template.deactivated"
        : "clinical-shared.evolution-template.updated",
      entityType: "clinical-evolution-template",
      entityId: r.plantilla.id,
      changes: { module: "orthodontics", name: r.plantilla.name },
    });
    return NextResponse.json(r.plantilla);
  } catch (err) {
    console.error("Update ortho note template error:", err);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}
