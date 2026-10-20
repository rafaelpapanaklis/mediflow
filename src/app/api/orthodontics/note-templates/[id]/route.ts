import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import { ORTHO_DEFAULT_TEMPLATES } from "@/lib/clinical-shared/evolution-templates/seed-orthodontics";
import { editarPlantillaNota, volverAFabricaNota } from "@/lib/orthodontics/plantillas-nota-service";
import { repoVersiones } from "@/lib/plantillas-fabrica/db";

export const dynamic = "force-dynamic";

const FABRICA = ORTHO_DEFAULT_TEMPLATES.map((t) => t.name);

// PATCH /api/orthodontics/note-templates/:id — edita nombre y texto, o la
// apaga/enciende (`activa`). En las de fábrica el nombre no cambia y el texto se
// guarda como versión de ESTA clínica (las demás siguen con la de fábrica);
// `volverAFabrica: true` archiva esa versión. No hay DELETE: apagar es
// reversible y nada se borra.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    const versiones = { versiones: repoVersiones, userId: ctx.userId };
    if (body?.volverAFabrica === true) {
      const v = await volverAFabricaNota(prisma, ctx.clinicId, params.id, FABRICA, versiones);
      if (v.ok === false) return NextResponse.json({ code: v.codigo }, { status: v.status });
      // Ya estaba de fábrica (pestaña vieja): no cambió nada, no se deja rastro de una restauración que no ocurrió.
      if (v.yaEstabaDeFabrica) return NextResponse.json(v.plantilla);
      await auditClinicalShared({
        ctx,
        action: "clinical-shared.evolution-template.factory-restored",
        entityType: "clinical-evolution-template",
        entityId: v.plantilla.id,
        changes: { module: "orthodontics", name: v.plantilla.name },
      });
      return NextResponse.json(v.plantilla);
    }
    const r = await editarPlantillaNota(
      prisma,
      ctx.clinicId,
      params.id,
      { name: body?.name, soap: body?.soap, activa: body?.activa },
      FABRICA,
      versiones,
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
      changes: { module: "orthodontics", name: r.plantilla.name, ...(r.plantilla.versionDeClinica ? { versionDeClinica: true } : {}) },
    });
    return NextResponse.json(r.plantilla);
  } catch (err) {
    console.error("Update ortho note template error:", err);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}
